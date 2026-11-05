import {
  HttpError,
  NO_STORE,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { isValidCityId } from "@/lib/cities/types";
import { isValidGameId } from "@/lib/publish/version";
import { setCityIntent } from "@/lib/registry/service";
import { getRegistry } from "@/lib/registry/store";
import type { CityIntent } from "@/lib/registry/types";

/**
 * City DECISION intent — one endpoint, three verbs, zero side effects on cities.
 *
 * POST /api/works/<gameId>/city-intent
 *
 * Body:
 *   { "action": "select", "cityId": "manila-ph", "cityName": "Manila", "countryCode": "PH" }
 *   { "action": "select", "cityId": "manila-ph", "attempts": 1, "lastError": "write_conflict" }
 *   { "action": "skip" }
 *   { "action": "clear" }
 *
 * Why this exists: "the author chose a city but the association has not landed
 * yet" is a state that must survive a closed tab, a dead network and a device
 * switch. localStorage cannot carry that, and treating a failed request as
 * "skipped" would silently discard the author's decision. So the decision is
 * persisted on the work — while the city itself is NOT created here:
 *
 *   - no profile is created (that only happens through A7/POST city, which
 *     requires the pack to exist and the actor to be allowed),
 *   - `cityId` on the work is untouched,
 *   - publishing is blocked only while `mode === "pending"`.
 *
 * Idempotent by construction: the same decision replayed writes nothing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;
const MAX_ATTEMPTS = 99;

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
    const body = parsed as Record<string, unknown>;
    const action = body.action;

    const work = await getRegistry().getWork(gameId);
    if (!work) throw new HttpError(404, "work_not_found", "作品不存在。");
    if (work.ownerUserId !== auth.user.id && auth.user.role !== "admin") {
      throw new HttpError(403, "forbidden", "只有作者本人或管理员可以修改城市归属。");
    }

    let intent: CityIntent | null;
    const now = new Date().toISOString();

    if (action === "skip") {
      intent = { mode: "skipped", attempts: 0, at: now };
    } else if (action === "clear") {
      intent = null;
    } else if (action === "select") {
      const cityId = typeof body.cityId === "string" ? body.cityId.trim() : "";
      if (!isValidCityId(cityId)) {
        return jsonResponse(400, { error: "invalid_city_id", message: "cityId 不合法。" });
      }
      const attemptsRaw = body.attempts;
      const attempts =
        typeof attemptsRaw === "number" && Number.isFinite(attemptsRaw)
          ? Math.max(0, Math.min(MAX_ATTEMPTS, Math.trunc(attemptsRaw)))
          : 0;
      const lastError = typeof body.lastError === "string" ? body.lastError.slice(0, 80) : null;
      intent = {
        mode: "pending",
        cityId,
        attempts,
        lastError,
        at: now,
      };
      if (typeof body.cityName === "string" && body.cityName.trim()) {
        intent.cityName = body.cityName.trim().slice(0, 120);
      }
      if (typeof body.countryCode === "string" && /^[A-Z]{2}$/.test(body.countryCode)) {
        intent.countryCode = body.countryCode;
      }
    } else {
      return jsonResponse(400, {
        error: "invalid_action",
        message: "action 只支持 select、skip、clear。",
      });
    }

    const hints = clientHints(request);
    const updated = await setCityIntent(
      { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash },
      gameId,
      intent,
    );

    return jsonResponse(
      200,
      {
        gameId: updated.gameId,
        state: updated.state,
        cityId: updated.cityId ?? null,
        intent: updated.cityIntent ?? null,
      },
      { "Cache-Control": NO_STORE },
    );
  } catch (error) {
    return toErrorResponse(error, "works:city-intent");
  }
}
