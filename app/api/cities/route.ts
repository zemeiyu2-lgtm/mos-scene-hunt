import {
  NO_STORE,
  assertSafeMutation,
  jsonResponse,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { createOrReuseCity, listCitiesPublic, parseCityInput } from "@/lib/cities/service";

/**
 * City catalogue.
 *
 * GET  /api/cities?q=&country=   public listing (id, names, country, count)
 * POST /api/cities               authenticated create-or-reuse
 *
 * POST is deliberately NOT a "create" verb: the server looks the city up by
 * identity first and only writes when nothing matches. A client retrying after
 * a timeout therefore converges on one profile, and two clients submitting the
 * same city at the same instant also converge (exclusive create + re-read).
 *
 * No external geocoder is involved in this batch: the city is what the user
 * chose, and a failed geocoding service can never block city creation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_MAX_PER_HOUR = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const cities = await listCitiesPublic({
      q: url.searchParams.get("q") ?? undefined,
      country: url.searchParams.get("country") ?? undefined,
    });
    return jsonResponse(200, { cities }, { "Cache-Control": NO_STORE });
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

    const input = parseCityInput(parsed);
    const result = await createOrReuseCity(input);

    return jsonResponse(result.created ? 201 : 200, {
      city: {
        cityId: result.city.cityId,
        cityName: result.city.cityName,
        countryCode: result.city.countryCode,
        countryName: result.city.countryName,
        adminAreaName: result.city.adminAreaName ?? null,
        localizedNames: result.city.localizedNames,
        status: result.city.status,
        gameCount: 0,
      },
      created: result.created,
      reused: result.reused,
      ambiguous: result.ambiguous,
    });
  } catch (error) {
    return toErrorResponse(error, "cities:create");
  }
}
