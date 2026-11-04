import {
  HttpError,
  NO_STORE,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { isValidGameId } from "@/lib/publish/version";
import { getRegistry } from "@/lib/registry/store";
import { setWorkCity } from "@/lib/registry/service";

/**
 * Work ↔ city association.
 *
 * GET  /api/works/<gameId>/city   owner or admin: current association
 * POST /api/works/<gameId>/city   owner (not yet public) or admin (any state)
 *
 * Body: `{ "cityId": "manila-ph" }` or `{ "cityId": null }` to clear.
 *
 * A client can never write `cityId` through the publish payload — the pack
 * JSON is validated and stored as-is, and this endpoint is the only write path.
 * The permission rule itself lives in the state machine, not here: this route
 * only proves WHO is asking.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;

async function loadWorkForActor(request: Request, gameId: string) {
  const auth = await requireUser(request);
  const work = await getRegistry().getWork(gameId);
  if (!work) throw new HttpError(404, "work_not_found", "作品不存在。");
  if (work.ownerUserId !== auth.user.id && auth.user.role !== "admin") {
    throw new HttpError(403, "forbidden", "只有作者本人或管理员可以查看该作品的城市归属。");
  }
  return { auth, work };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  try {
    const { gameId: rawId } = await params;
    const gameId = decodeURIComponent(rawId ?? "");
    if (!isValidGameId(gameId)) {
      throw new HttpError(400, "invalid_game_id", "游戏 id 不合法。");
    }
    const { work } = await loadWorkForActor(request, gameId);
    return jsonResponse(
      200,
      { gameId: work.gameId, cityId: work.cityId ?? null, state: work.state },
      { "Cache-Control": NO_STORE },
    );
  } catch (error) {
    return toErrorResponse(error, "works:city:get");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  try {
    const { gameId: rawId } = await params;
    const gameId = decodeURIComponent(rawId ?? "");
    if (!isValidGameId(gameId)) {
      throw new HttpError(400, "invalid_game_id", "游戏 id 不合法。");
    }

    const auth = await requireUser(request);
    assertSafeMutation(request);

    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return jsonResponse(400, { error: "unreadable_body", message: "无法读取请求内容。" });
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: "body_too_large", message: "请求内容过大。" });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid_json", message: "请求内容不是合法 JSON。" });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(400, { error: "invalid_body", message: "请求体必须是一个 JSON 对象。" });
    }
    const body = parsed as { cityId?: unknown };
    if (!("cityId" in body)) {
      return jsonResponse(400, { error: "invalid_body", message: "缺少 cityId 字段。" });
    }
    const requested = body.cityId;
    if (requested !== null && typeof requested !== "string") {
      return jsonResponse(400, { error: "invalid_body", message: "cityId 必须是字符串或 null。" });
    }

    const hints = clientHints(request);
    const work = await setWorkCity(
      { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash },
      gameId,
      requested === null ? null : requested.trim(),
    );

    return jsonResponse(200, {
      gameId: work.gameId,
      cityId: work.cityId ?? null,
      state: work.state,
    });
  } catch (error) {
    return toErrorResponse(error, "works:city:set");
  }
}
