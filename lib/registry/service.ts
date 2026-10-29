/**
 * Registry service — the only place that combines a state transition, a
 * persistence write and an audit record.
 *
 * Every mutation follows the same shape:
 *   1. authenticate (caller's job, in the route handler)
 *   2. read the work
 *   3. apply a pure transition
 *   4. write with optimistic revision check, retrying once on conflict
 *   5. append an audit record
 *
 * Audit failures are logged but never roll back a completed state change: the
 * work document is the authority, and losing one audit line must not make a
 * publish look failed when it actually happened.
 */

import { randomUUID } from "node:crypto";
import { canonicalJson, deriveVersionId, isValidGameId } from "../publish/version";
import { getStore as getPublishStore } from "../publish/storage";
import type { Game } from "../game/types";
import { getRegistry, type RegistryStore } from "./store";
import { applyWorkEvent, canClaimGameId, type WorkEvent } from "./state-machine";
import {
  REGISTRY_SCHEMA_VERSION,
  type AuditAction,
  type AuditRecord,
  type Role,
  type UserRecord,
  type WorkRecord,
} from "./types";
import { HttpError } from "../auth/guard";

export interface ActorContext {
  user: UserRecord;
  ipHash: string;
  uaHash: string;
}

export interface AuditInput {
  actor: ActorContext | null;
  action: AuditAction;
  targetType: AuditRecord["targetType"];
  targetId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Append one audit record.
 *
 * Returns `true` when the record was persisted. The caller decides what to do
 * with `false`: most mutations only log it, but a security-critical one (a
 * password change) reports it to the client instead of pretending the trail
 * is complete. The mutation itself is never rolled back here — by the time
 * this runs the state change has already happened.
 */
export async function recordAudit(
  store: RegistryStore,
  input: AuditInput,
): Promise<boolean> {
  const now = new Date().toISOString();
  const record: AuditRecord = {
    id: randomUUID(),
    actorUserId: input.actor?.user.id ?? null,
    actorRole: (input.actor?.user.role ?? null) as Role | null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: input.before ?? null,
    after: input.after ?? null,
    ipHash: input.actor?.ipHash ?? "none",
    uaHash: input.actor?.uaHash ?? "none",
    createdAt: now,
  };
  try {
    await store.appendAudit(record);
    return true;
  } catch (error) {
    console.error("[registry] 审计写入失败（状态已生效，不回滚）", error);
    return false;
  }
}

function emptyWork(input: {
  gameId: string;
  ownerUserId: string;
  title: string;
  language: string;
  now: string;
}): WorkRecord {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    gameId: input.gameId,
    ownerUserId: input.ownerUserId,
    title: input.title,
    language: input.language,
    state: "draft",
    publishedVersionId: null,
    latestVersionId: null,
    versions: [],
    submissions: [],
    createdAt: input.now,
    updatedAt: input.now,
    revision: 0,
  };
}

/**
 * Read-modify-write with one optimistic retry.
 *
 * The retry re-reads and re-applies the transition, so a concurrent reviewer
 * decision cannot silently overwrite this one. If it conflicts twice, the
 * caller gets a 409 and must refresh — never a lost update.
 */
async function mutateWork(
  store: RegistryStore,
  gameId: string,
  actor: ActorContext,
  event: WorkEvent,
): Promise<{ work: WorkRecord; changed: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await store.getWork(gameId);
    if (!existing) {
      throw new HttpError(404, "work_not_found", "作品不存在。");
    }
    const now = new Date().toISOString();
    const result = applyWorkEvent(existing, event, { now, submissionId: randomUUID() });
    if (!result.ok) {
      const status = result.code === "game_id_taken" || result.code === "not_owner" ? 403 : 409;
      throw new HttpError(status, result.code, result.message);
    }
    if (!result.changed) return { work: existing, changed: false };
    const write = await store.putWork(result.work, existing.revision);
    if (write.ok) return { work: result.work, changed: true };
    if (attempt === 1) {
      throw new HttpError(409, "write_conflict", "作品刚刚被其他人修改，请刷新后重试。");
    }
  }
  throw new HttpError(409, "write_conflict", "写入冲突，请重试。");
}

export interface SubmitResult {
  work: WorkRecord;
  versionId: string;
  created: boolean;
  idempotent: boolean;
}

/**
 * Submit a validated pack as a new version.
 *
 * Order matters: the immutable version object is written FIRST (content
 * addressed, so a retry is safe), then the registry records the submission. If
 * the registry write fails, the orphaned version object is unreachable through
 * any public path — it can never be mistaken for published content.
 */
export async function submitVersion(input: {
  actor: ActorContext;
  game: Game;
  packJson: string;
  noteFromAuthor: string | null;
}): Promise<SubmitResult> {
  const { actor, game } = input;
  if (!isValidGameId(game.id)) {
    throw new HttpError(400, "invalid_game_id", "游戏 id 不合法。");
  }

  const registry = getRegistry();
  const existing = await registry.getWork(game.id);
  if (!canClaimGameId(existing, actor.user.id)) {
    throw new HttpError(403, "game_id_taken", "该作品 id 已被其他作者占用。");
  }

  const canonical = canonicalJson(game);
  const versionId = await deriveVersionId(game);
  const sizeBytes = Buffer.byteLength(canonical, "utf8");

  const publishStore = getPublishStore();
  const stored = await publishStore.publish({
    gameId: game.id,
    versionId,
    title: game.title,
    sceneCount: game.scenes.length,
    packJson: canonical,
  });

  const now = new Date().toISOString();
  if (!existing) {
    const created = await registry.createWork(
      emptyWork({
        gameId: game.id,
        ownerUserId: actor.user.id,
        title: game.title,
        language: game.language,
        now,
      }),
    );
    if (!created.ok) {
      // Someone claimed the id between our read and our write. That is only a
      // refusal if the winner is a DIFFERENT account: two concurrent
      // submissions by the same author must not turn into a spurious 403.
      const winner = await registry.getWork(game.id);
      if (!winner || winner.ownerUserId !== actor.user.id) {
        throw new HttpError(403, "game_id_taken", "该作品 id 已被其他作者占用。");
      }
    }
  }

  try {
    const { work } = await mutateWork(registry, game.id, actor, {
      type: "submit",
      versionId,
      title: game.title,
      sceneCount: game.scenes.length,
      sizeBytes,
      actorUserId: actor.user.id,
      noteFromAuthor: input.noteFromAuthor,
    });
    await recordAudit(registry, {
      actor,
      action: "work.submit",
      targetType: "version",
      targetId: versionId,
      after: { gameId: game.id, versionId, state: work.state },
    });
    return { work, versionId, created: stored.created, idempotent: false };
  } catch (error) {
    if (error instanceof HttpError && error.code === "duplicate_version") {
      const current = await registry.getWork(game.id);
      if (current) {
        return { work: current, versionId, created: false, idempotent: true };
      }
    }
    throw error;
  }
}

export async function claimReview(actor: ActorContext, gameId: string): Promise<WorkRecord> {
  const registry = getRegistry();
  const before = await registry.getWork(gameId);
  const { work } = await mutateWork(registry, gameId, actor, {
    type: "claim_review",
    actorUserId: actor.user.id,
  });
  await recordAudit(registry, {
    actor,
    action: "work.claim_review",
    targetType: "work",
    targetId: gameId,
    before: before ? { state: before.state } : null,
    after: { state: work.state },
  });
  return work;
}

export async function decide(input: {
  actor: ActorContext;
  gameId: string;
  decision: "approve" | "request_changes" | "reject";
  reasonCodes: string[];
  reasonText: string;
  checklist: Record<string, boolean>;
}): Promise<WorkRecord> {
  const registry = getRegistry();
  const before = await registry.getWork(input.gameId);
  const { work } = await mutateWork(registry, input.gameId, input.actor, {
    type: "decide",
    decision: input.decision,
    reasonCodes: input.reasonCodes,
    reasonText: input.reasonText,
    checklist: input.checklist,
    actorUserId: input.actor.user.id,
  });
  await recordAudit(registry, {
    actor: input.actor,
    action: "review.decide",
    targetType: "work",
    targetId: input.gameId,
    before: before ? { state: before.state } : null,
    after: { state: work.state, decision: input.decision },
  });
  return work;
}

export async function publishWork(actor: ActorContext, gameId: string): Promise<WorkRecord> {
  const registry = getRegistry();
  const before = await registry.getWork(gameId);
  const { work } = await mutateWork(registry, gameId, actor, {
    type: "publish",
    actorUserId: actor.user.id,
  });
  await recordAudit(registry, {
    actor,
    action: "work.publish",
    targetType: "work",
    targetId: gameId,
    before: before
      ? { state: before.state, publishedVersionId: before.publishedVersionId }
      : null,
    after: { state: work.state, publishedVersionId: work.publishedVersionId },
  });
  return work;
}

/**
 * Reassign a work to another account (admin only, enforced by the route).
 *
 * Needed for two real cases: works imported from the pre-account era have no
 * human owner, and a mistaken claim has to be reversible. Content is not
 * touched — `state`, `publishedVersionId` and the version list stay identical,
 * so a transfer can never alter what the public reads.
 */
export async function transferOwner(
  actor: ActorContext,
  gameId: string,
  toUserId: string,
): Promise<WorkRecord> {
  const registry = getRegistry();
  const before = await registry.getWork(gameId);
  if (!before) {
    throw new HttpError(404, "work_not_found", "作品不存在。");
  }
  const target = await registry.getUser(toUserId);
  if (!target) {
    throw new HttpError(400, "unknown_user", "目标账号不存在。");
  }
  if (target.status !== "active") {
    throw new HttpError(409, "user_inactive", "目标账号已停用，无法承接作品。");
  }
  const { work } = await mutateWork(registry, gameId, actor, {
    type: "transfer_owner",
    toUserId,
    actorUserId: actor.user.id,
  });
  await recordAudit(registry, {
    actor,
    action: "work.transfer_owner",
    targetType: "work",
    targetId: gameId,
    before: { ownerUserId: before.ownerUserId },
    after: { ownerUserId: work.ownerUserId },
  });
  return work;
}

type SimpleAction = "withdraw" | "unlist" | "restore" | "archive";

const AUDIT_FOR: Record<SimpleAction, AuditAction> = {
  withdraw: "work.withdraw",
  unlist: "work.unlist",
  restore: "work.restore",
  archive: "work.archive",
};

export async function applySimpleAction(
  actor: ActorContext,
  gameId: string,
  action: SimpleAction,
): Promise<WorkRecord> {
  const registry = getRegistry();
  const before = await registry.getWork(gameId);
  const { work } = await mutateWork(registry, gameId, actor, {
    type: action,
    actorUserId: actor.user.id,
  });
  await recordAudit(registry, {
    actor,
    action: AUDIT_FOR[action],
    targetType: "work",
    targetId: gameId,
    before: before ? { state: before.state } : null,
    after: { state: work.state },
  });
  return work;
}

/* ------------------------------------------------------------------ */
/* Read models for the admin UI                                       */
/* ------------------------------------------------------------------ */

export interface QueueEntry {
  work: WorkRecord;
  waitingSince: string;
  waitingHours: number;
}

/**
 * Works with a submission awaiting action, oldest first.
 *
 * Keyed on SUBMISSION status rather than work state: an already-published work
 * whose next version is queued for review is just as much "waiting" as a
 * first-time submission, and omitting it would let updates rot silently.
 */
export async function reviewQueue(now: Date = new Date()): Promise<QueueEntry[]> {
  const works = await getRegistry().listWorks();
  const entries: QueueEntry[] = [];
  for (const work of works) {
    const waiting = [...work.submissions]
      .reverse()
      .find((s) => s.status === "pending" || s.status === "in_review");
    if (!waiting) continue;
    const waitingSince = waiting.submittedAt;
    entries.push({
      work,
      waitingSince,
      waitingHours: Math.max(
        0,
        Math.round(((now.getTime() - new Date(waitingSince).getTime()) / 3_600_000) * 10) / 10,
      ),
    });
  }
  return entries.sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
}

export interface AdminSummary {
  totalWorks: number;
  pendingReviews: number;
  oldestWaitingHours: number;
  published: number;
  withdrawn: number;
  storeKind: "file" | "blob";
}

export async function adminSummary(now: Date = new Date()): Promise<AdminSummary> {
  const registry = getRegistry();
  const works = await registry.listWorks();
  const queue = await reviewQueue(now);
  return {
    totalWorks: works.length,
    pendingReviews: queue.length,
    oldestWaitingHours: queue.length > 0 ? queue[0].waitingHours : 0,
    published: works.filter((w) => w.state === "published" || w.state === "unlisted").length,
    withdrawn: works.filter((w) => w.state === "withdrawn").length,
    storeKind: registry.kind,
  };
}

/** Works visible to one creator. */
export async function worksForOwner(userId: string): Promise<WorkRecord[]> {
  const works = await getRegistry().listWorks();
  return works.filter((w) => w.ownerUserId === userId);
}

/**
 * Public catalog entries for works the registry marks `published`.
 *
 * This is what closes the loop between "the admin published a game" and "the
 * game centre can find it": before this, `/content/cloud/catalog.json` was a
 * hardcoded constant, so an admin-published pack was reachable only by its
 * direct share link and invisible in `/games`.
 *
 * Deliberately metadata-only: no pack bytes are read here, and `author` is the
 * stable owner label rather than an email, so no personal data leaks into a
 * response that carries no authentication.
 */
export async function publishedCatalogEntries(): Promise<
  Array<{
    id: string;
    title: string;
    author: string;
    description: string;
    language: string;
    sceneCount: number;
    status: "published";
    updatedAt: string;
  }>
> {
  const works = await getRegistry().listWorks();
  const entries = [];
  for (const work of works) {
    // `unlisted` stays link-only: it must not be advertised in the catalogue.
    if (work.state !== "published" || !work.publishedVersionId) continue;
    const version = work.versions.find((v) => v.versionId === work.publishedVersionId);
    entries.push({
      id: work.gameId,
      title: work.title,
      author: "MOS Scene Hunt · 平台注册作者",
      description: `${version?.sceneCount ?? 0} 个地点的游戏包，已通过后台审核并发布。`,
      language: work.language || "zh-CN",
      sceneCount: version?.sceneCount ?? 0,
      status: "published" as const,
      updatedAt: work.updatedAt,
    });
  }
  return entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
