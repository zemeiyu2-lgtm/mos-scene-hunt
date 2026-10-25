/**
 * Storage layer for published games.
 *
 * The game rules engine never touches this module: it speaks only in opaque
 * pack text in and out, so the backing store can be swapped (Vercel Blob,
 * Alibaba OSS, Tencent COS, ...) by implementing {@link PublishedGameStore}
 * and returning it from `getStore`. The default adapter is a filesystem
 * directory - zero new dependencies, works on any Node host, and keeps the
 * first serverization batch honest without cloud credentials.
 *
 * Immutability contract: {@link PublishedGameStore.publish} must never
 * overwrite an existing version object with different content. Identical
 * content is an idempotent no-op; different content under an existing
 * versionId throws {@link VersionConflictError} (the caller maps it to 409).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { GAME_ID_PATTERN, VERSION_ID_PATTERN } from "./version";
import { createVercelBlobStore } from "./blob-store";

export interface PublishedVersionMeta {
  versionId: string;
  title: string;
  sceneCount: number;
  publishedAt: string;
}

export interface PublishedGameMeta {
  gameId: string;
  latestVersionId: string;
  versions: PublishedVersionMeta[];
}

export interface PublishInput {
  gameId: string;
  versionId: string;
  title: string;
  sceneCount: number;
  /** Canonical serialisation of the validated game pack. */
  packJson: string;
}

export interface PublishResult {
  /** False when the identical version already existed (idempotent re-publish). */
  created: boolean;
  meta: PublishedGameMeta;
}

export interface PublishedGameStore {
  publish(input: PublishInput): Promise<PublishResult>;
  /** Raw pack JSON text for one immutable version, or null when absent. */
  readVersion(gameId: string, versionId: string): Promise<string | null>;
  /** Game metadata incl. the latest versionId, or null when never published. */
  readMeta(gameId: string): Promise<PublishedGameMeta | null>;
}

/** Thrown when an existing version object would be replaced by other content. */
export class VersionConflictError extends Error {
  constructor(gameId: string, versionId: string) {
    super(`版本 ${versionId} 已存在且内容不同，已发布版本不可覆盖（game: ${gameId}）`);
    this.name = "VersionConflictError";
  }
}

function assertSafeIds(gameId: string, versionId: string): void {
  if (!GAME_ID_PATTERN.test(gameId)) throw new Error(`gameId 不合法：${gameId}`);
  if (!VERSION_ID_PATTERN.test(versionId)) throw new Error(`versionId 不合法：${versionId}`);
}

/**
 * Serialises publishes per (store root, gameId) within this process.
 *
 * The meta update is a read-modify-write cycle; two concurrent publishes of
 * the same game could otherwise overwrite each other's meta and drop a valid
 * version entry. `getStore()` builds a fresh adapter per request, so the lock
 * must be keyed module-level, not per adapter instance. Cross-process /
 * cross-instance writes are still last-write-wins on the filesystem - the
 * blob adapter carries the same limitation, which is why version objects
 * themselves are content-addressed and can never be lost by a meta race.
 */
const publishLocks = new Map<string, Promise<unknown>>();

function withPublishLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = publishLocks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  publishLocks.set(key, settled);
  void settled.then(() => {
    if (publishLocks.get(key) === settled) publishLocks.delete(key);
  });
  return run;
}

/**
 * Filesystem adapter. Layout under `root`:
 *   <gameId>/meta.json            - PublishedGameMeta
 *   <gameId>/versions/<vId>.json  - the pack text
 * gameId/versionId are validated before they ever reach a path, so path
 * traversal cannot escape the store root.
 */
export function createFilesystemStore(root: string): PublishedGameStore {
  const versionPath = (gameId: string, versionId: string) =>
    path.join(root, gameId, "versions", `${versionId}.json`);
  const metaPath = (gameId: string) => path.join(root, gameId, "meta.json");

  const readMeta = async (gameId: string): Promise<PublishedGameMeta | null> => {
    try {
      const raw = await readFile(metaPath(gameId), "utf8");
      const parsed = JSON.parse(raw) as PublishedGameMeta;
      if (parsed?.gameId !== gameId || !VERSION_ID_PATTERN.test(parsed?.latestVersionId ?? "")) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const writeMetaAtomic = async (meta: PublishedGameMeta): Promise<void> => {
    const target = metaPath(meta.gameId);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
    await rename(tmp, target);
  };

  return {
    publish(input) {
      // One write at a time per game: the whole check-write-update-meta cycle
      // runs inside the lock so concurrent publishes cannot interleave.
      return withPublishLock(`${root}::${input.gameId}`, () => publishLocked(input));
    },

    async readVersion(gameId, versionId) {
      assertSafeIds(gameId, versionId);
      try {
        return await readFile(versionPath(gameId, versionId), "utf8");
      } catch {
        return null;
      }
    },

    readMeta,
  };

  async function publishLocked(input: PublishInput): Promise<PublishResult> {
    assertSafeIds(input.gameId, input.versionId);
    const versionFile = versionPath(input.gameId, input.versionId);
    let existing: string | null = null;
    try {
      existing = await readFile(versionFile, "utf8");
    } catch {
      existing = null;
    }
    if (existing !== null && existing !== input.packJson) {
      throw new VersionConflictError(input.gameId, input.versionId);
    }

    // Read meta fresh inside the lock: a previous publish in this process may
    // have advanced it after the caller's snapshot was taken.
    const meta = (await readMeta(input.gameId)) ?? {
      gameId: input.gameId,
      latestVersionId: input.versionId,
      versions: [],
    };
    const created = existing === null;
    if (created) {
      // Atomic write: a reader never observes a half-written version file.
      await mkdir(path.dirname(versionFile), { recursive: true });
      const tmp = `${versionFile}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await writeFile(tmp, input.packJson, "utf8");
      await rename(tmp, versionFile);
    }
    if (!meta.versions.some((v) => v.versionId === input.versionId)) {
      meta.versions.push({
        versionId: input.versionId,
        title: input.title,
        sceneCount: input.sceneCount,
        publishedAt: new Date().toISOString(),
      });
    }
    // Latest points at the newest publish by timestamp; an idempotent
    // re-publish of an older version keeps its original entry timestamp and
    // cannot drag the latest pointer backwards. `>=` breaks same-millisecond
    // ties in favour of the later publish (entries are in publish order).
    const newest = meta.versions.reduce((a, b) => (b.publishedAt >= a.publishedAt ? b : a));
    meta.latestVersionId = newest.versionId;
    await writeMetaAtomic(meta);
    return { created, meta };
  }
}

/**
 * Store selected for the current host.
 *
 * - `PUBLISHED_GAMES_STORE=blob` selects the Vercel Blob adapter, the only
 *   option that survives redeploys and is shared across serverless instances.
 *   It requires `BLOB_READ_WRITE_TOKEN` to be configured in the deployment
 *   environment (never in source control).
 * - Everything else uses the filesystem adapter below `PUBLISHED_GAMES_DIR`
 *   (a path, not a credential; default `.published-games` inside the project,
 *   git-ignored). Fine for local development and single Node hosts, but data
 *   is ephemeral on serverless platforms.
 */
export function getStore(): PublishedGameStore {
  const storeKind = process.env.PUBLISHED_GAMES_STORE?.trim().toLowerCase();
  if (storeKind === "blob") {
    return createVercelBlobStore();
  }
  const dir = process.env.PUBLISHED_GAMES_DIR?.trim() || path.join(process.cwd(), ".published-games");
  return createFilesystemStore(dir);
}
