/**
 * Legacy import: bring pre-registry published games into the registry.
 *
 * Why this exists: before the admin platform, `POST /api/publish` wrote game
 * packs straight to `published-games/<gameId>/...` with no owner, no review
 * and no state. Once public reads go through the registry, those files are
 * invisible — every existing share link would 404. This module adopts them
 * WITHOUT rewriting them.
 *
 * Safety rules baked into the design (worth reading before changing anything):
 *
 *  1. **Read-only on the legacy store.** Nothing here calls `put`, `del`,
 *     `copy` or `publish`. The original objects stay byte-identical, so a
 *     failed import is always recoverable by simply not using the registry.
 *  2. **Dry run by default.** `apply: false` returns the full plan and writes
 *     nothing. Applying requires an explicit flag from an admin.
 *  3. **Never overwrite a registry work.** If a `gameId` already exists it is
 *     reported as `skip_existing`, never merged or replaced.
 *  4. **Unverifiable content is quarantined, not published.** A pack that does
 *     not validate, or whose bytes no longer hash to its filename, is imported
 *     as a `draft` with no published pointer. History is preserved and marked,
 *     but nothing unverified becomes publicly readable.
 *  5. **Ownership is explicit.** Imported works belong to a dedicated
 *     `legacy-import` account that cannot log in. An admin reassigns each one
 *     to its real author via the transfer action — no silent ownership claim.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { deriveVersionId, isValidGameId } from "../publish/version";
import { getStore as getPublishStore } from "../publish/storage";
import { validateGame } from "../game/types";
import { getRegistry } from "./store";
import { REGISTRY_SCHEMA_VERSION, type VersionRecord, type WorkRecord } from "./types";

/** Account that owns unclaimed legacy works. Cannot be logged into. */
export const LEGACY_OWNER_EMAIL = "legacy-import@mos-scene-hunt.invalid";
export const LEGACY_OWNER_DISPLAY_NAME = "历史作品（未认领）";

const DEFAULT_BLOB_PREFIX = "published-games";

export interface LegacyVersionPlan {
  versionId: string;
  ok: boolean;
  title: string | null;
  sceneCount: number;
  sizeBytes: number;
  /** Populated only when `ok` is false — why this version is not publishable. */
  problem: string | null;
}

export interface LegacyGamePlan {
  gameId: string;
  /** The `meta.json` latest pointer, verbatim. */
  latestVersionId: string | null;
  /** True when the latest version validates AND is content-addressed. */
  latestPublishable: boolean;
  versions: LegacyVersionPlan[];
  /**
   * `import_published`  - safe to serve publicly as-is
   * `import_quarantined`- history kept as a draft, nothing public
   * `skip_existing`     - a registry work already owns this gameId
   * `skip_invalid_id`   - directory name is not a legal gameId
   */
  action: "import_published" | "import_quarantined" | "skip_existing" | "skip_invalid_id";
  note: string | null;
}

export interface LegacyImportReport {
  source: "blob" | "file";
  /** False when the listing itself could not be completed. */
  listingComplete: boolean;
  listingError: string | null;
  /** Where the listing looked (a path or a blob prefix — never a credential). */
  location: string;
  applied: boolean;
  totals: {
    games: number;
    importPublished: number;
    importQuarantined: number;
    skipExisting: number;
    skipInvalidId: number;
    versionsSeen: number;
  };
  games: LegacyGamePlan[];
}

/**
 * Enumerate legacy `gameId`s.
 *
 * Blob listing is explicitly paginated: `list()` returns at most 1000 keys per
 * call and a silent truncation here would quietly orphan every game past the
 * first page. Any listing failure is reported, not swallowed.
 */
async function listLegacyGameIds(): Promise<{
  source: "blob" | "file";
  location: string;
  gameIds: string[];
  complete: boolean;
  error: string | null;
}> {
  const storeKind = process.env.PUBLISHED_GAMES_STORE?.trim().toLowerCase();

  if (storeKind === "blob") {
    const prefix = (process.env.PUBLISHED_GAMES_BLOB_PREFIX?.trim() || DEFAULT_BLOB_PREFIX).replace(
      /^\/+|\/+$/g,
      "",
    );
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return {
        source: "blob",
        location: `${prefix}/`,
        gameIds: [],
        complete: false,
        error:
          "BLOB_READ_WRITE_TOKEN 未配置：无法列出线上对象。请在具备只读 Blob 凭据的环境中运行，或以文件存储模式运行。",
      };
    }
    try {
      const { list } = await import("@vercel/blob");
      const ids = new Set<string>();
      let cursor: string | undefined;
      let guard = 0;
      do {
        const page = await list({ prefix: `${prefix}/`, cursor, limit: 1000 });
        for (const blob of page.blobs) {
          const rest = blob.pathname.slice(prefix.length + 1);
          const [gameId] = rest.split("/");
          if (gameId) ids.add(gameId);
        }
        cursor = page.hasMore ? page.cursor : undefined;
        guard += 1;
        if (guard > 500) {
          return {
            source: "blob",
            location: `${prefix}/`,
            gameIds: [...ids].sort(),
            complete: false,
            error: "分页次数超过 500 页上限，已停止以避免无限循环；结果不完整。",
          };
        }
      } while (cursor);
      return { source: "blob", location: `${prefix}/`, gameIds: [...ids].sort(), complete: true, error: null };
    } catch (error) {
      return {
        source: "blob",
        location: `${prefix}/`,
        gameIds: [],
        complete: false,
        error: `列出 Blob 对象失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const dir = process.env.PUBLISHED_GAMES_DIR?.trim() || path.join(process.cwd(), ".published-games");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    return { source: "file", location: dir, gameIds: ids, complete: true, error: null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { source: "file", location: dir, gameIds: [], complete: true, error: null };
    }
    return {
      source: "file",
      location: dir,
      gameIds: [],
      complete: false,
      error: `读取目录失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Validate one legacy version object without modifying it. */
async function inspectVersion(
  gameId: string,
  versionId: string,
  raw: string | null,
): Promise<LegacyVersionPlan> {
  if (raw === null) {
    return {
      versionId,
      ok: false,
      title: null,
      sceneCount: 0,
      sizeBytes: 0,
      problem: "版本对象不存在或读取失败",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      versionId,
      ok: false,
      title: null,
      sceneCount: 0,
      sizeBytes: Buffer.byteLength(raw, "utf8"),
      problem: "不是合法 JSON",
    };
  }
  try {
    const { game } = validateGame(parsed);
    if (game.id !== gameId) {
      return {
        versionId,
        ok: false,
        title: game.title,
        sceneCount: game.scenes.length,
        sizeBytes: Buffer.byteLength(raw, "utf8"),
        problem: `包内 id (${game.id}) 与目录 id 不一致`,
      };
    }
    const recomputed = await deriveVersionId(game);
    return {
      versionId,
      ok: recomputed === versionId,
      title: game.title,
      sceneCount: game.scenes.length,
      sizeBytes: Buffer.byteLength(raw, "utf8"),
      problem: recomputed === versionId ? null : `内容哈希不符：应为 ${recomputed}`,
    };
  } catch (error) {
    return {
      versionId,
      ok: false,
      title: null,
      sceneCount: 0,
      sizeBytes: Buffer.byteLength(raw, "utf8"),
      problem: error instanceof Error ? error.message : "校验失败",
    };
  }
}

/**
 * `deriveVersionId` is async in the publish service; reusing it here keeps the
 * hash input in exactly one definition, so the imported record and the stored
 * bytes can never disagree about what a version id means.
 */

function toVersionRecord(plan: LegacyVersionPlan, ownerUserId: string, now: string): VersionRecord {
  return {
    versionId: plan.versionId,
    title: plan.title ?? plan.versionId,
    sceneCount: plan.sceneCount,
    sizeBytes: plan.sizeBytes,
    submittedBy: ownerUserId,
    createdAt: now,
    status: plan.ok ? "approved" : "pending",
    publishedAt: null,
  };
}

export interface RunLegacyImportOptions {
  /** When false (default) nothing is written. */
  apply?: boolean;
  /** Stop after this many games — a guard for a first look at a big store. */
  limit?: number;
}

export async function runLegacyImport(options: RunLegacyImportOptions = {}): Promise<LegacyImportReport> {
  const apply = options.apply === true;
  const listing = await listLegacyGameIds();
  const registry = getRegistry();
  const publishStore = getPublishStore();

  const plans: LegacyGamePlan[] = [];
  const limited = options.limit && options.limit > 0 ? listing.gameIds.slice(0, options.limit) : listing.gameIds;

  for (const gameId of limited) {
    if (!isValidGameId(gameId)) {
      plans.push({
        gameId,
        latestVersionId: null,
        latestPublishable: false,
        versions: [],
        action: "skip_invalid_id",
        note: "目录名不是合法 gameId，已跳过（对象保持原样）。",
      });
      continue;
    }

    const existing = await registry.getWork(gameId);
    if (existing) {
      plans.push({
        gameId,
        latestVersionId: existing.publishedVersionId,
        latestPublishable: false,
        versions: [],
        action: "skip_existing",
        note: `registry 已存在该作品（归属 ${existing.ownerUserId}），未做任何修改。`,
      });
      continue;
    }

    const meta = await publishStore.readMeta(gameId);
    if (!meta) {
      plans.push({
        gameId,
        latestVersionId: null,
        latestPublishable: false,
        versions: [],
        action: "import_quarantined",
        note: "meta.json 缺失或不可解析：无法确认线上版本，按草稿保留。",
      });
      continue;
    }

    const versionPlans: LegacyVersionPlan[] = [];
    for (const entry of meta.versions ?? []) {
      if (!entry || typeof entry.versionId !== "string") continue;
      const raw = await publishStore.readVersion(gameId, entry.versionId);
      versionPlans.push(await inspectVersion(gameId, entry.versionId, raw));
    }

    const latest = meta.latestVersionId;
    const latestPlan = versionPlans.find((v) => v.versionId === latest);
    const latestPublishable = Boolean(latest && latestPlan && latestPlan.ok);

    plans.push({
      gameId,
      latestVersionId: latest ?? null,
      latestPublishable,
      versions: versionPlans,
      action: latestPublishable ? "import_published" : "import_quarantined",
      note: latestPublishable
        ? null
        : latest
          ? `最新版本 ${latest} 无法校验，按草稿保留（不对外可读）。`
          : "meta.json 没有 latestVersionId，按草稿保留。",
    });
  }

  if (apply) {
    const ownerId = await ensureLegacyOwner();
    const now = new Date().toISOString();
    for (const plan of plans) {
      if (plan.action !== "import_published" && plan.action !== "import_quarantined") continue;
      const work: WorkRecord = {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        gameId: plan.gameId,
        ownerUserId: ownerId,
        title: plan.versions.find((v) => v.versionId === plan.latestVersionId)?.title ?? plan.gameId,
        language: "zh-CN",
        state: plan.action === "import_published" ? "published" : "draft",
        publishedVersionId: plan.action === "import_published" ? plan.latestVersionId : null,
        latestVersionId: plan.latestVersionId,
        versions: plan.versions.map((v) => ({
          ...toVersionRecord(v, ownerId, now),
          publishedAt:
            plan.action === "import_published" && v.versionId === plan.latestVersionId ? now : null,
        })),
        submissions: [],
        createdAt: now,
        updatedAt: now,
        revision: 0,
      };
      // createWork only ever creates: a concurrent real submission wins and
      // this import step is skipped, never overwritten.
      const created = await registry.createWork(work);
      if (!created.ok) {
        plan.action = "skip_existing";
        plan.note = "导入过程中该 gameId 已被占用（并发提交），已跳过，未覆盖。";
      } else {
        await registry.appendAudit({
          id: `legacy-${plan.gameId}-${Date.now()}`,
          actorUserId: null,
          actorRole: null,
          action: "work.import_legacy",
          targetType: "work",
          targetId: plan.gameId,
          before: null,
          after: { state: work.state, publishedVersionId: work.publishedVersionId },
          ipHash: "none",
          uaHash: "none",
          createdAt: now,
        });
      }
    }
  }

  const totals = {
    games: plans.length,
    importPublished: plans.filter((p) => p.action === "import_published").length,
    importQuarantined: plans.filter((p) => p.action === "import_quarantined").length,
    skipExisting: plans.filter((p) => p.action === "skip_existing").length,
    skipInvalidId: plans.filter((p) => p.action === "skip_invalid_id").length,
    versionsSeen: plans.reduce((sum, p) => sum + p.versions.length, 0),
  };

  return {
    source: listing.source,
    listingComplete: listing.complete,
    listingError: listing.error,
    location: listing.location,
    applied: apply,
    totals,
    games: plans,
  };
}

/** Create (once) the account that holds unclaimed legacy works. */
async function ensureLegacyOwner(): Promise<string> {
  const registry = getRegistry();
  const existing = await registry.getUserByEmail(LEGACY_OWNER_EMAIL);
  if (existing) return existing.id;

  const { randomUUID } = await import("node:crypto");
  const { hashPassword } = await import("../auth/password");
  // An unknown password is hashed and then discarded: this account must never
  // be usable to sign in, it exists only to hold ownership until an admin
  // transfers each work to a real creator.
  const secret = randomUUID() + randomUUID();
  const fields = await hashPassword(secret);
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    email: LEGACY_OWNER_EMAIL,
    passwordHash: fields.passwordHash,
    passwordSalt: fields.passwordSalt,
    displayName: LEGACY_OWNER_DISPLAY_NAME,
    role: "creator" as const,
    status: "suspended" as const,
    createdAt: now,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  };
  const created = await registry.putUser(user);
  if (created.ok) return user.id;
  const raced = await registry.getUserByEmail(LEGACY_OWNER_EMAIL);
  if (raced) return raced.id;
  throw new Error("无法创建历史作品归属账号。");
}
