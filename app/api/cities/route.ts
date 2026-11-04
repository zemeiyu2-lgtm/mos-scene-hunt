import {
  NO_STORE,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { attachCityToWork, listCitiesPublic, parseCityInput } from "@/lib/cities/service";

/**
 * City catalogue.
 *
 * GET  /api/cities?q=&country=            public discovery (cities that
 *                                         currently hold ≥1 published pack)
 * GET  /api/cities?scope=all              authenticated creator picker (also
 *                                         shows cities with drafts only)
 * POST /api/cities  { gameId, city }      associate a pack with a city,
 *                                         creating the profile if it is new
 *
 * POST is NOT a "create a city" verb, and there is deliberately no variant of
 * it. `gameId` is mandatory: a city profile only exists because a real,
 * persisted pack needed one. The server re-reads that work and checks the
 * actor's permission over it BEFORE writing anything, so a rejected request
 * cannot leave a profile behind.
 *
 * Body is `{ "gameId": "<id>", "city": { cityName, countryCode, ... } }`;
 * the city fields may also be sent at the top level next to `gameId`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_MAX_PER_HOUR = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "all" ? "all" : "public";
    // The full catalogue is a creator tool, not public data: it exposes cities
    // whose packs are still drafts and therefore not meant to be discoverable.
    if (scope === "all") await requireUser(request);

    const cities = await listCitiesPublic({
      q: url.searchParams.get("q") ?? undefined,
      country: url.searchParams.get("country") ?? undefined,
      scope,
    });
    return jsonResponse(200, { cities, scope }, { "Cache-Control": NO_STORE });
  } catch (error) {
    return toErrorResponse(error, "cities:list");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireUser(request);
    assertSafeMutation(request);

    const limit = consumeRateLimit({
      key: `cities:create:${auth.user.id}`,
      limit: CREATE_MAX_PER_HOUR,
      windowMs: CREATE_WINDOW_MS,
    });
    if (!limit.allowed) {
      return jsonResponse(
        429,
        { error: "rate_limited", message: "城市创建过于频繁，请稍后再试。" },
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

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
    const body = parsed as Record<string, unknown>;

    // Hard requirement, not a hint: without a pack there is no city.
    if (typeof body.gameId !== "string" || !body.gameId.trim()) {
      return jsonResponse(400, {
        error: "game_id_required",
        message: "创建城市必须关联一个已保存的探索包（缺少 gameId）。",
      });
    }
    const gameId = body.gameId.trim();
    const cityBody =
      body.city !== undefined && body.city !== null
        ? body.city
        : Object.fromEntries(Object.entries(body).filter(([key]) => key !== "gameId"));

    const input = parseCityInput(cityBody);
    const hints = clientHints(request);
    const result = await attachCityToWork(
      { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash },
      gameId,
      { city: input },
    );
    const city = result.city!;

    return jsonResponse(result.created ? 201 : 200, {
      city: {
        cityId: city.cityId,
        cityName: city.cityName,
        countryCode: city.countryCode,
        countryName: city.countryName,
        adminAreaName: city.adminAreaName ?? null,
        localizedNames: city.localizedNames,
        status: city.status,
        gameCount: 0,
      },
      work: { gameId: result.work.gameId, cityId: result.work.cityId ?? null, state: result.work.state },
      created: result.created,
      reused: result.reused,
      ambiguous: result.ambiguous,
    });
  } catch (error) {
    return toErrorResponse(error, "cities:create");
  }
}
