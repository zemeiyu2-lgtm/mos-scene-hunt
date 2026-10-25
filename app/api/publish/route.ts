import { GameDataError, validateGame } from "@/lib/game/types";
import { deriveVersionId, isValidGameId } from "@/lib/publish/version";
import { getStore, VersionConflictError } from "@/lib/publish/storage";

/**
 * Publish endpoint (serverization batch 1).
 *
 * POST /api/publish with a game pack JSON body. The pack must pass the same
 * `validateGame` every other content path uses, so an invalid pack can never
 * become a published version. The response carries the stable gameId, the
 * immutable content-derived versionId, and the public play link path.
 *
 * Protection set:
 *   - application/json only (415)
 *   - body size cap before parsing (413)
 *   - JSON parse + full pack validation (400)
 *   - invalid gameId (400)
 *   - identical re-publish is idempotent (200), conflicting content under an
 *     existing version is refused (409) - published versions are immutable
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PACK_BYTES = 256 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json(415, { error: "unsupported_media_type", message: "请以 application/json 提交游戏包。" });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PACK_BYTES) {
    return json(413, { error: "pack_too_large", message: `游戏包超过 ${MAX_PACK_BYTES} 字节上限。` });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, { error: "unreadable_body", message: "无法读取请求内容。" });
  }
  if (raw.length > MAX_PACK_BYTES) {
    return json(413, { error: "pack_too_large", message: `游戏包超过 ${MAX_PACK_BYTES} 字节上限。` });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid_json", message: "游戏包不是合法的 JSON。" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return json(400, { error: "invalid_pack", message: "游戏包必须是一个 JSON 对象。" });
  }

  const candidate = parsed as { id?: unknown };
  if (!isValidGameId(candidate.id)) {
    return json(400, {
      error: "invalid_game_id",
      message: "游戏 id 不合法：需为小写字母/数字开头，仅含小写字母、数字、点、下划线、连字符，最长 64 字符。",
    });
  }

  try {
    const { game } = validateGame(parsed);
    const versionId = await deriveVersionId(game);
    const result = await getStore().publish({
      gameId: game.id,
      versionId,
      title: game.title,
      sceneCount: game.scenes.length,
      packJson: JSON.stringify(game),
    });
    return json(result.created ? 201 : 200, {
      gameId: game.id,
      versionId,
      created: result.created,
      latestVersionId: result.meta.latestVersionId,
      playPath: `/select#cloud=${game.id}.${versionId}`,
    });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return json(409, { error: "version_conflict", message: error.message });
    }
    if (error instanceof GameDataError) {
      return json(400, { error: "invalid_pack", message: "游戏包校验未通过。", detail: error.message });
    }
    return json(500, {
      error: "publish_failed",
      message: "发布失败，请稍后重试。",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
