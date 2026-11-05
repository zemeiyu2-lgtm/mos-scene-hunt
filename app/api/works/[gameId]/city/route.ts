import {
  HttpError,
  NO_STORE,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { parseCityInput } from "@/lib/cities/service";
import { attachCityToWork } from "@/lib/cities/service";
import { resolveCityRef } from "@/lib/cities/resolve";
import { getCityStore } from "@/lib/cities/store";
import { isValidGameId } from "@/lib/publish/version";
import { getRegistry } from "@/lib/registry/store";

/**
 * Work ↔ city association — the canonical write path for the city ecosystem.
 *
 * GET  /api/works/<gameId>/city   owner or admin: current association
 * POST /api/works/<gameId>/city   owner (not yet public) or admin (any state)
 *
 * Body, exactly one of:
 *   `{ "cityId": "manila-ph" }`     attach an existing profile
 *   `{ "cityId": null }`            clear the association
 *   `{ "city": { cityName: … } }`   create-or-reuse by identity, then attach
 *
 * A client can never write `cityId` through the publish payload — the pack JSON
 * is validated and stored as-is, and this endpoint is the only write path.
 *
 * Nothing is created before the pack is proved to exist and the actor is proved
 * to be allowed to touch it; the decision itself lives in the state machine
 * (`canSetCity`), this route only authenticates.
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
    // Denormalised city summary + the raw decision intent, so the creator UI can
    // render all five states from ONE request and a closed browser can never
    // silently turn "waiting" into "skipped".
    let city: {
      cityId: string;
      cityName: string;
      countryCode: string;
      countryName: string;
    } | null = null;
    if (work.cityId) {
      const resolved = await resolveCityRef(getCityStore(), work.cityId);
      if (resolved) {
        city = {
          cityId: resolved.city.cityId,
          cityName: resolved.city.cityName,
          countryCode: resolved.city.countryCode,
          countryName: resolved.city.countryName,
        };
      }
    }
    return jsonResponse(
      200,
      {
        gameId: work.gameId,
        cityId: work.cityId ?? null,
        state: work.state,
        title: work.title,
        city,
        intent: work.cityIntent ?? null,
      },
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
    const body = parsed as { cityId?: unknown; city?: unknown };
    const hasCity = body.city !== undefined && body.city !== null;
    if (!("cityId" in body) && !hasCity) {
      return jsonResponse(400, {
        error: "invalid_body",
        message: "必须提供 cityId 或 city 字段。",
      });
    }

    const hints = clientHints(request);
    const actor = { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash };

    const result = hasCity
      ? await attachCityToWork(actor, gameId, { city: parseCityInput(body.city) })
      : typeof body.cityId === "string" || body.cityId === null
        ? await attachCityToWork(actor, gameId, {
            cityId: body.cityId === null ? null : body.cityId.trim(),
          })
        : null;
    if (!result) {
      return jsonResponse(400, { error: "invalid_body", message: "cityId 必须是字符串或 null。" });
    }

    return jsonResponse(200, {
      gameId: result.work.gameId,
      cityId: result.work.cityId ?? null,
      state: result.work.state,
      city: result.city
        ? {
            cityId: result.city.cityId,
            cityName: result.city.cityName,
            countryCode: result.city.countryCode,
            countryName: result.city.countryName,
          }
        : null,
      created: result.created,
      reused: result.reused,
    });
  } catch (error) {
    return toErrorResponse(error, "works:city:set");
  }
}
