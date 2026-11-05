import {
  NO_STORE,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireRole,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { attachCityToWork, CITY_LIST_MAX_LIMIT, listCitiesPublic, parseCityInput } from "@/lib/cities/service";
import { countPublishedByCity } from "@/lib/cities/link";

/**
 * City catalogue.
 *
 * GET  /api/cities?q=&country=            public discovery (cities that
 *                                         currently hold ≥1 published pack)
 * GET  /api/cities?limit=3                ...and at most N rows, applied after
 *                                         filtering and sorting (entry previews)
 * GET  /api/cities?scope=picker           signed-in creator picker: published
 *                                         cities + the cities THIS author's
 *                                         own works are attached to
 * GET  /api/cities?scope=admin            staff only: full catalogue
 * GET  /api/cities?scope=all              DEPRECATED. Historically returned
 *                                         every city to any signed-in user,
 *                                         which exposed other authors' draft
 *                                         cities. It now answers with the
 *                                         `picker` set plus `"deprecated": true`
 *                                         and is scheduled for removal.
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
    const requested = url.searchParams.get("scope");
    let scope: "public" | "picker" | "admin" = "public";
    let deprecated = false;

    if (requested === "all") {
      // Compatibility window: same visibility as `picker`, never wider.
      deprecated = true;
      scope = "picker";
    } else if (requested === "picker") {
      scope = "picker";
    } else if (requested === "admin") {
      scope = "admin";
    } else if (requested && requested !== "public") {
      return jsonResponse(
        400,
        { error: "invalid_scope", message: "scope 只支持 public、picker、admin。" },
        { "Cache-Control": NO_STORE },
      );
    }

    // Picker and admin both need an actor: the picker set is defined by WHO is
    // asking, and the admin catalogue includes cities with no published pack.
    let actorUserId: string | undefined;
    if (scope === "picker") {
      actorUserId = (await requireUser(request)).user.id;
    } else if (scope === "admin") {
      actorUserId = (await requireRole(request, "reviewer")).user.id;
    }

    // `limit` changes the response body, so it is validated here rather than
    // silently ignored: a caller that asked for 3 rows and got 40 would think
    // its own UI was broken.
    const rawLimit = url.searchParams.get("limit");
    let limit: number | undefined;
    if (rawLimit !== null && rawLimit !== "") {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > CITY_LIST_MAX_LIMIT) {
        return jsonResponse(
          400,
          { error: "invalid_limit", message: `limit 必须是 1 到 ${CITY_LIST_MAX_LIMIT} 之间的整数。` },
          { "Cache-Control": NO_STORE },
        );
      }
      limit = parsed;
    }

    const cities = await listCitiesPublic({
      q: url.searchParams.get("q") ?? undefined,
      country: url.searchParams.get("country") ?? undefined,
      scope,
      actorUserId,
      limit,
    });
    return jsonResponse(
      200,
      deprecated ? { cities, scope, deprecated } : { cities, scope },
      { "Cache-Control": NO_STORE },
    );
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
    const packedCounts = await countPublishedByCity();

    return jsonResponse(result.created ? 201 : 200, {
      city: {
        cityId: city.cityId,
        cityName: city.cityName,
        countryCode: city.countryCode,
        countryName: city.countryName,
        adminAreaName: city.adminAreaName ?? null,
        localizedNames: city.localizedNames,
        status: city.status,
        // Real published count, never a placeholder: this is the number the UI
        // shows next to a freshly created city (usually 0, because the pack is
        // still a draft — which is the honest answer).
        gameCount: packedCounts.get(city.cityId) ?? 0,
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
