import { GameDataError, validateGame } from "@/lib/game/types";
import { isValidGameId } from "@/lib/publish/version";
import { VersionConflictError } from "@/lib/publish/storage";
import {
  HttpError,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { getRegistry } from "@/lib/registry/store";
import { isPubliclyReadable } from "@/lib/registry/types";
import { recordAudit, submitVersion } from "@/lib/registry/service";

/**
 * Publish endpoint — submission only. **Uploading is not publishing.**
 *
 * This endpoint used to be anonymous and keyed ownership on a client-chosen
 * `game.id`, which let anyone append a version to someone else's work and
 * repoint that work's default link at their own content. Four things changed:
 *
 *  1. A session is required (401 otherwise). No anonymous write at all.
 *  2. The `game.id` is claimed by the first submitter and is immutable
 *     afterwards; another account gets 403 `game_id_taken` (404 is not used
 *     here because the author legitimately needs to know the id is taken).
 *  3. The pack is stored as a submission awaiting review. The response carries
 *     NO public play link — only a preview path that requires a session.
 *  4. Public reads resolve the registry's `publishedVersionId`, never "latest
 *     written", so a new submission cannot change what players see.
 *
 * Body contract is unchanged (application/json, 256 KiB byte cap, full
 * `validateGame`) so existing authors' clients keep working.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PACK_BYTES = 256 * 1024;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;
const SUBMIT_MAX_PER_HOUR = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return jsonResponse(409, { error: "version_conflict", message: error.message });
    }
    if (error instanceof GameDataError) {
      return jsonResponse(400, {
        error: "invalid_pack",
        message: "游戏包校验未通过。",
        detail: error.message,
      });
    }
    return toErrorResponse(error, "publish");
  }
}

async function handle(request: Request): Promise<Response> {
  // Guard order: session first. An unauthenticated caller must not be able to
  // probe pack parsing behaviour or learn anything about existing works.
  const auth = await requireUser(request);
  assertSafeMutation(request);

  const hints = clientHints(request);
  const limit = consumeRateLimit({
    key: `publish:${auth.user.id}`,
    limit: SUBMIT_MAX_PER_HOUR,
    windowMs: SUBMIT_WINDOW_MS,
  });
  if (!limit.allowed) {
    return jsonResponse(
      429,
      { error: "rate_limited", message: "提交过于频繁，请稍后再试。" },
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PACK_BYTES) {
    return jsonResponse(413, {
      error: "pack_too_large",
      message: `游戏包超过 ${MAX_PACK_BYTES} 字节上限。`,
    });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonResponse(400, { error: "unreadable_body", message: "无法读取请求内容。" });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_PACK_BYTES) {
    return jsonResponse(413, {
      error: "pack_too_large",
      message: `游戏包超过 ${MAX_PACK_BYTES} 字节上限。`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse(400, { error: "invalid_json", message: "游戏包不是合法的 JSON。" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return jsonResponse(400, { error: "invalid_pack", message: "游戏包必须是一个 JSON 对象。" });
  }

  const candidate = parsed as { id?: unknown };
  if (!isValidGameId(candidate.id)) {
    return jsonResponse(400, {
      error: "invalid_game_id",
      message:
        "游戏 id 不合法：需为小写字母/数字开头，仅含小写字母、数字、点、下划线、连字符，最长 64 字符。",
    });
  }

  const { game } = validateGame(parsed);
  const noteRaw = (parsed as { submissionNote?: unknown }).submissionNote;
  const note = typeof noteRaw === "string" ? noteRaw.slice(0, 500) : null;

  const actor = { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash };
  const result = await submitVersion({
    actor,
    game,
    packJson: raw,
    noteFromAuthor: note,
  });

  if (result.idempotent) {
    // Same bytes already submitted: say so instead of queueing a second review
    // of identical content (which would let an author re-roll the dice).
    await recordAudit(getRegistry(), {
      actor,
      action: "work.submit",
      targetType: "version",
      targetId: result.versionId,
      after: { gameId: game.id, idempotent: true },
    });
  }

  return jsonResponse(result.idempotent ? 200 : 201, {
    gameId: game.id,
    versionId: result.versionId,
    reviewStatus: result.idempotent ? "already_submitted" : "pending",
    workState: result.work.state,
    /**
     * The ONE version the public can actually read, or null while nothing is
     * published. Clients may only offer a public share link when this equals
     * `versionId` — otherwise they would hand out a link to stale content.
     */
    publishedVersionId: isPubliclyReadable(result.work.state)
      ? result.work.publishedVersionId
      : null,
    /**
     * Deliberately NOT `playPath`: there is no public link until a reviewer
     * publishes. The preview route requires the owner (or staff) session.
     */
    previewPath: `/admin/works/${game.id}`,
  });
}
