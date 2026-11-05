/**
 * The ONE client-side entry point for city data.
 *
 * Every city screen (Game Center entry, `/cities`, `/cities/<id>`, the creator
 * card) goes through this module, so the API's response shape is parsed in
 * exactly one place and no page has to re-implement "is this an error or an
 * empty list?".
 *
 * Rules this module is built to keep (V2.0 baseline §3 + G2-C data-layer spec):
 *
 *  1. A failure is NEVER reported as an empty result. `loadCityList` returns a
 *     discriminated result: `{ ok: true, data }` or `{ ok: false, error }` with
 *     `error.kind` telling network / HTTP / malformed structure apart.
 *  2. Only a successful, structurally valid response is cached. A rejected or
 *     invalid fetch is dropped from both the cache and the in-flight slot, so a
 *     flaky second cannot pin a fake "no cities" for a whole minute.
 *  3. Concurrent identical requests share ONE fetch; concurrent requests from
 *     different views (public / picker / admin) never share anything, because
 *     the cache key carries the view and the query.
 *  4. A failed association is never rewritten into "skipped". `attachCity`
 *     reports the failure; the five-state mapping in `mapCityAssociation` only
 *     reads explicit server fields.
 *  5. No map module is imported here (budget rule P5). This file is text only.
 */

import { isValidCityId } from "./types";

export interface PublicCitySummary {
  cityId: string;
  cityName: string;
  countryCode: string;
  countryName: string;
  adminAreaName: string | null;
  localizedNames: Record<string, string>;
  status: "active" | "merged";
  gameCount: number;
}

export interface CityPackageSummary {
  gameId: string;
  title: string;
  sceneCount: number;
  updatedAt: string;
}

export interface CityDetail {
  city: PublicCitySummary;
  packages: CityPackageSummary[];
}

/**
 * Which permission view a list belongs to. The value is part of the cache key,
 * which is what keeps a creator's picker list from being served to an anonymous
 * visitor (or the other way round).
 *
 * `manage` is deliberately absent: the author's own management view is answered
 * per work by `/api/works/<gameId>/city`, not by a catalogue endpoint.
 */
export type CityListView = "public" | "picker" | "admin";

export type CityErrorKind =
  | "network"
  | "http"
  | "malformed"
  | "unauthorized"
  | "forbidden"
  | "not_found";

export interface CityError {
  kind: CityErrorKind;
  /** 0 for network/malformed (no HTTP status exists). */
  status: number;
  /** Server error code when it sent one, otherwise a local constant. */
  code: string;
  message: string;
}

export type CityResult<T> = { ok: true; data: T } | { ok: false; error: CityError };

/* ------------------------------------------------------------------ */
/* Parsing helpers — the only place that knows the wire format         */
/* ------------------------------------------------------------------ */

class MalformedPayload extends Error {}

function fail(kind: CityErrorKind, status: number, code: string, message: string): CityResult<never> {
  return { ok: false, error: { kind, status, code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value) throw new MalformedPayload(`missing ${key}`);
  return value;
}

function optionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value ? value : null;
}

function parseCitySummary(raw: unknown): PublicCitySummary {
  if (!isRecord(raw)) throw new MalformedPayload("city entry is not an object");
  const gameCount = raw.gameCount;
  const localized = raw.localizedNames;
  return {
    cityId: requireString(raw, "cityId"),
    cityName: requireString(raw, "cityName"),
    countryCode: requireString(raw, "countryCode"),
    countryName: requireString(raw, "countryName"),
    adminAreaName: optionalString(raw, "adminAreaName"),
    // Display-only fields degrade to a safe default instead of failing the
    // whole list: identity fields above are what the UI cannot work without.
    localizedNames: isRecord(localized)
      ? Object.fromEntries(Object.entries(localized).filter(([, v]) => typeof v === "string")) as Record<string, string>
      : {},
    status: raw.status === "merged" ? "merged" : "active",
    gameCount: typeof gameCount === "number" && Number.isFinite(gameCount) ? gameCount : 0,
  };
}

function parseCityList(body: unknown): PublicCitySummary[] {
  if (!isRecord(body) || !Array.isArray(body.cities)) throw new MalformedPayload("cities is not an array");
  return body.cities.map(parseCitySummary);
}

function parseCityPackage(raw: unknown): CityPackageSummary {
  if (!isRecord(raw)) throw new MalformedPayload("package entry is not an object");
  const sceneCount = raw.sceneCount;
  return {
    gameId: requireString(raw, "gameId"),
    title: typeof raw.title === "string" && raw.title ? raw.title : "(未命名探索包)",
    sceneCount: typeof sceneCount === "number" && Number.isFinite(sceneCount) ? sceneCount : 0,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

function parseCityDetail(body: unknown): CityDetail {
  if (!isRecord(body)) throw new MalformedPayload("detail body is not an object");
  if (!Array.isArray(body.packages)) throw new MalformedPayload("packages is not an array");
  return {
    city: parseCitySummary(body.city),
    // The server already filtered these to publicly readable packs; the client
    // does not (and must not) re-filter a list it cannot judge.
    packages: body.packages.map(parseCityPackage),
  };
}

export interface WorkCityPayload {
  gameId: string;
  cityId: string | null;
  state: string;
  city: { cityId: string; cityName: string; countryCode: string; countryName: string } | null;
  intent: {
    mode: "pending" | "skipped";
    cityId?: string;
    cityName?: string;
    countryCode?: string;
    attempts?: number;
    lastError?: string | null;
    at?: string;
  } | null;
}

function parseWorkCity(body: unknown): WorkCityPayload {
  if (!isRecord(body)) throw new MalformedPayload("work city body is not an object");
  const intentRaw = body.intent;
  if (intentRaw !== null && intentRaw !== undefined && !isRecord(intentRaw)) {
    throw new MalformedPayload("intent is neither null nor an object");
  }
  const intent = isRecord(intentRaw)
    ? {
        mode: intentRaw.mode === "skipped" ? ("skipped" as const) : ("pending" as const),
        cityId: optionalString(intentRaw, "cityId") ?? undefined,
        cityName: optionalString(intentRaw, "cityName") ?? undefined,
        countryCode: optionalString(intentRaw, "countryCode") ?? undefined,
        attempts: typeof intentRaw.attempts === "number" && Number.isFinite(intentRaw.attempts)
          ? intentRaw.attempts
          : 0,
        lastError: optionalString(intentRaw, "lastError"),
        at: optionalString(intentRaw, "at") ?? undefined,
      }
    : null;
  const cityRaw = body.city;
  return {
    gameId: requireString(body, "gameId"),
    cityId: optionalString(body, "cityId"),
    state: typeof body.state === "string" ? body.state : "unknown",
    city: isRecord(cityRaw)
      ? {
          cityId: requireString(cityRaw, "cityId"),
          cityName: requireString(cityRaw, "cityName"),
          countryCode: requireString(cityRaw, "countryCode"),
          countryName: requireString(cityRaw, "countryName"),
        }
      : null,
    intent,
  };
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * One HTTP call, normalised into a result. Callers never see a thrown
 * exception, so a page cannot accidentally treat "the network died" as
 * "there are no cities".
 */
async function requestJson(url: string, init?: RequestInit): Promise<CityResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return fail("network", 0, "network_error", "网络连接失败，请检查网络后重试。");
  }

  if (!response.ok) {
    // Best-effort error body: the server's code is more useful than the status
    // alone, but a broken error body must not mask the HTTP failure.
    let code = `http_${response.status}`;
    let message = "服务暂时不可用，请稍后重试。";
    try {
      const body = (await response.json()) as unknown;
      if (isRecord(body)) {
        if (typeof body.error === "string" && body.error) code = body.error;
        if (typeof body.message === "string" && body.message) message = body.message;
      }
    } catch {
      // keep defaults
    }
    const kind: CityErrorKind =
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : response.status === 404
            ? "not_found"
            : "http";
    return fail(kind, response.status, code, message);
  }

  try {
    return { ok: true, data: await response.json() };
  } catch {
    return fail("malformed", response.status, "invalid_json", "服务返回的内容无法解析。");
  }
}

/* ------------------------------------------------------------------ */
/* 60-second cache                                                     */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60_000;

/** Same ceiling the API enforces; kept local so a bad caller never reaches it. */
export const CITY_LIST_MAX_LIMIT = 200;

interface CacheEntry {
  at: number;
  value: PublicCitySummary[];
}

const listCache = new Map<string, CacheEntry>();
const listInflight = new Map<string, Promise<CityResult<PublicCitySummary[]>>>();

export interface CityListQuery {
  view?: CityListView;
  q?: string;
  country?: string;
  /**
   * At most N rows. Part of the cache key because it changes the response: a
   * 3-row preview and the full catalogue are different answers and must never
   * satisfy each other.
   */
  limit?: number;
}

/**
 * The request is built ONCE, and the cache key is derived from that exact
 * request. Adding a parameter therefore cannot leave the key behind — the two
 * cannot disagree, because there is only one object.
 *
 * Normalisation (lower-case query, upper-case country, integer limit) is what
 * lets two equivalent requests share one entry instead of two.
 */
function buildListRequest(view: CityListView, query: CityListQuery): { params: URLSearchParams; key: string } {
  const params = new URLSearchParams();
  if (view !== "public") params.set("scope", view);
  const q = query.q?.trim().toLowerCase() ?? "";
  if (q) params.set("q", q);
  const country = query.country?.trim().toUpperCase() ?? "";
  if (country) params.set("country", country);
  const limit =
    typeof query.limit === "number" && Number.isFinite(query.limit) ? Math.floor(query.limit) : null;
  if (limit !== null && limit > 0) params.set("limit", String(Math.min(limit, CITY_LIST_MAX_LIMIT)));

  const suffix = params.toString();
  // The view is always part of the key, even when it produces no query
  // parameter (public), so `public` can never collide with an unparameterised
  // request from another view.
  return { params, key: `${view}?${suffix}` };
}

/** Drops every cached list. Called after a write that can change membership. */
export function invalidateCityCaches(): void {
  listCache.clear();
  listInflight.clear();
}

/** Backwards-compatible alias used by the Game Center page. */
export const clearCityCache = invalidateCityCaches;

/**
 * The public catalogue (or a creator/admin view of it).
 *
 * `ok: true` with an empty array is the only representation of "no cities";
 * every failure path returns `ok: false`.
 */
export async function loadCityList(query: CityListQuery = {}): Promise<CityResult<PublicCitySummary[]>> {
  const view = query.view ?? "public";
  const { params, key } = buildListRequest(view, query);

  const cached = listCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, data: cached.value };
  }

  const running = listInflight.get(key);
  if (running) return running;

  const task = (async (): Promise<CityResult<PublicCitySummary[]>> => {
    try {
      const suffix = params.toString();

      const raw = await requestJson(`/api/cities${suffix ? `?${suffix}` : ""}`);
      if (!raw.ok) {
        // A failing fetch invalidates the key: a previously good list must not
        // survive a request we know just failed.
        listCache.delete(key);
        return raw;
      }

      try {
        const value = parseCityList(raw.data);
        listCache.set(key, { at: Date.now(), value });
        return { ok: true, data: value };
      } catch (error) {
        listCache.delete(key);
        if (error instanceof MalformedPayload) {
          return fail("malformed", 200, "malformed_response", "服务返回的城市数据格式不正确。");
        }
        throw error;
      }
    } finally {
      // Success or failure, the in-flight slot is released — a rejected promise
      // never becomes the answer for the next caller.
      listInflight.delete(key);
    }
  })();

  listInflight.set(key, task);
  return task;
}

/**
 * One city + its publicly readable packs, in ONE request.
 *
 * 404 is an answer, not a crash: `code` distinguishes "no such city"
 * (`city_not_found`) from "exists but has no public pack" (`city_not_public`).
 */
export async function loadCityDetail(cityId: string): Promise<CityResult<CityDetail>> {
  if (!cityId) return fail("not_found", 404, "city_not_found", "城市不存在。");
  const raw = await requestJson(`/api/cities/${encodeURIComponent(cityId)}`);
  if (!raw.ok) return raw;
  try {
    return { ok: true, data: parseCityDetail(raw.data) };
  } catch (error) {
    if (error instanceof MalformedPayload) {
      return fail("malformed", 200, "malformed_response", "服务返回的城市内容格式不正确。");
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Work ↔ city                                                         */
/* ------------------------------------------------------------------ */

/** Current association of one work (owner or admin only; 401/403/404 typed). */
export async function loadWorkCity(gameId: string): Promise<CityResult<WorkCityPayload>> {
  const raw = await requestJson(`/api/works/${encodeURIComponent(gameId)}/city`);
  if (!raw.ok) return raw;
  try {
    return { ok: true, data: parseWorkCity(raw.data) };
  } catch (error) {
    if (error instanceof MalformedPayload) {
      return fail("malformed", 200, "malformed_response", "服务返回的城市归属数据格式不正确。");
    }
    throw error;
  }
}

export type CityIntentInput =
  | { action: "select"; cityId: string; cityName?: string; countryCode?: string; attempts?: number; lastError?: string | null }
  | { action: "skip" }
  | { action: "clear" };

/**
 * Persist the DECISION (never the association). No city is created here.
 * Writes change which cities the picker may show, so the list cache is dropped.
 */
export async function saveCityIntent(
  gameId: string,
  input: CityIntentInput,
): Promise<CityResult<WorkCityPayload>> {
  const raw = await requestJson(`/api/works/${encodeURIComponent(gameId)}/city-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!raw.ok) return raw;
  invalidateCityCaches();
  try {
    return { ok: true, data: parseWorkCity(raw.data) };
  } catch (error) {
    if (error instanceof MalformedPayload) {
      return fail("malformed", 200, "malformed_response", "服务返回的城市归属数据格式不正确。");
    }
    throw error;
  }
}

/**
 * Attach an existing city profile (or clear the association with `null`).
 *
 * A failure is returned as a failure — the caller must keep the "pending"
 * decision and offer a retry; it must never translate this into "skipped".
 *
 * `null` is the only way to remove a link, and the server treats it as
 * "clear", not "attach nothing": there is no separate DELETE verb, so one
 * write path keeps the audit trail in one place.
 */
export async function attachCity(
  gameId: string,
  cityId: string | null,
): Promise<CityResult<WorkCityPayload>> {
  const raw = await requestJson(`/api/works/${encodeURIComponent(gameId)}/city`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cityId }),
  });
  if (!raw.ok) return raw;
  invalidateCityCaches();
  try {
    return { ok: true, data: parseWorkCity(raw.data) };
  } catch (error) {
    if (error instanceof MalformedPayload) {
      return fail("malformed", 200, "malformed_response", "服务返回的城市归属数据格式不正确。");
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Five-state mapping (the only place that interprets intent fields)   */
/* ------------------------------------------------------------------ */

export type CityAssociation =
  | { kind: "unset" }
  | { kind: "pending_waiting"; cityId: string | null; cityName: string | null }
  | { kind: "pending_failed"; cityId: string | null; cityName: string | null; attempts: number; lastError: string | null }
  | { kind: "skipped" }
  | { kind: "associated"; cityId: string; cityName: string | null };

/**
 * `lastError` sentinel for "the record holds a cityId that is not a legal id".
 * The UI uses it to say "关联记录异常" instead of the generic retry wording,
 * because retrying the same corrupt value would fail the same way.
 */
export const INVALID_CITY_ID = "invalid_city_id";

/**
 * `lastError` sentinel for "the stored id is a LEGAL id, but the city profile
 * behind it no longer resolves" (deleted, merged away, storage unreadable).
 * The server omits the city summary in exactly that situation, so a valid-id +
 * no-name payload is the fingerprint of a dangling association. The stored
 * cityId is KEPT on the failure state so the creator card still offers the
 * recovery paths (retry attach, or clear) instead of losing the reference.
 */
export const CITY_PROFILE_MISSING = "city_profile_missing";

/**
 * Server fields → the five UI states. The rules are exhaustive on purpose:
 *
 *  - a VALID `cityId` with a resolved profile wins (associated);
 *  - a `cityId` that exists but is not a legal city id is a damaged record,
 *    never an association. It is reported as `pending_failed` with
 *    `lastError: "invalid_city_id"`, because that is the only state that both
 *    (a) refuses to claim a city and (b) still blocks publishing — silently
 *    degrading to `unset` would let a broken link look like "never decided";
 *  - a VALID `cityId` whose profile no longer resolves (deleted/merged, the
 *    server omits the summary) is a dangling link: `pending_failed` with
 *    `lastError: "city_profile_missing"`, cityId kept for recovery;
 *  - otherwise an explicit `intent.mode === "skipped"` is the ONLY way to read
 *    "skipped";
 *  - otherwise `pending` with `attempts === 0` is waiting, `> 0` is failed;
 *  - otherwise nothing was decided.
 *
 * `cityId === null` is never used on its own to decide between unset and
 * skipped, and a failed association keeps its `pending` state.
 */
export function mapCityAssociation(payload: WorkCityPayload | null): CityAssociation {
  if (!payload) return { kind: "unset" };
  return mapAssociation({
    cityId: payload.cityId,
    cityName: payload.city?.cityName ?? null,
    intent: payload.intent,
  });
}

/**
 * The mapping itself, over the four fields that matter.
 *
 * Split out so a server-rendered screen (the admin table) can derive the SAME
 * state from a `WorkRecord` it already has, without inventing a fake API
 * payload — one mapping, two callers, no second opinion about what "failed"
 * means.
 */
export function mapAssociation(input: {
  cityId?: string | null;
  cityName?: string | null;
  intent?: WorkCityPayload["intent"];
} | null): CityAssociation {
  if (!input) return { kind: "unset" };

  const rawCityId = input.cityId ?? null;
  if (rawCityId && isValidCityId(rawCityId)) {
    // A valid id WITHOUT a resolvable profile is a dangling association: the
    // server omits the summary precisely when the profile cannot be read.
    // Showing "✓ <raw id>" would present a dead reference as a working link —
    // and inventing a display name from the id would be forgery. It keeps its
    // cityId so the UI can still offer retry/clear recovery.
    if (input.cityName == null) {
      return {
        kind: "pending_failed",
        cityId: rawCityId,
        cityName: null,
        attempts: 1,
        lastError: CITY_PROFILE_MISSING,
      };
    }
    return {
      kind: "associated",
      cityId: rawCityId,
      cityName: input.cityName ?? null,
    };
  }
  if (rawCityId) {
    // The id is present but unusable (`"Manila PH"`, `"../x"`, `" "`, wrong
    // case…). It is NOT a city we can show, and it is NOT "no decision": the
    // record is inconsistent and needs a human or a retry to resolve.
    return {
      kind: "pending_failed",
      cityId: null,
      cityName: input.cityName ?? null,
      attempts: 1,
      lastError: INVALID_CITY_ID,
    };
  }

  const intent = input.intent;
  if (!intent) return { kind: "unset" };
  if (intent.mode === "skipped") return { kind: "skipped" };

  const attempts = intent.attempts ?? 0;
  // The decision's city id is only useful for a retry if it is a real id;
  // anything else would just send a garbage value to the write endpoint. The
  // stored name is kept so the UI can still say WHAT was chosen.
  const cityId = intent.cityId && isValidCityId(intent.cityId) ? intent.cityId : null;
  const cityName = intent.cityName ?? null;
  if (attempts > 0) {
    return { kind: "pending_failed", cityId, cityName, attempts, lastError: intent.lastError ?? null };
  }
  return { kind: "pending_waiting", cityId, cityName };
}

/** Only a pending decision blocks publishing; unset/skipped/associated do not. */
export function blocksPublish(state: CityAssociation): boolean {
  return state.kind === "pending_waiting" || state.kind === "pending_failed";
}

/**
 * The two record-level anomalies the admin table must surface as TEXT (not
 * only colour), phrased for a human who has to decide what to do:
 *
 *  - `published` work still holding a `pending` city intent — publish was
 *    forced around the guard (a concurrent residue). Advisory ONLY: nothing in
 *    the app rewrites either field automatically; a human confirms or clears.
 *  - a stored `cityId` that is not a legal id — a damaged record. Same rule:
 *    shown, logged, never silently "fixed".
 *
 * The admin page calls this on every row; returning null is the normal case.
 */
export function cityAssociationAnomaly(input: {
  workState?: string;
  cityId?: string | null;
  cityName?: string | null;
  intent?: WorkCityPayload["intent"];
}): string | null {
  if (input.workState === "published" && input.intent?.mode === "pending") {
    return "已公开但仍待关联（并发残留），需人工确认";
  }
  const association = mapAssociation({
    cityId: input.cityId ?? null,
    cityName: input.cityName ?? null,
    intent: input.intent ?? null,
  });
  if (association.kind === "pending_failed" && association.lastError === INVALID_CITY_ID) {
    return "城市归属记录异常（id 不合法），需人工修正";
  }
  if (
    association.kind === "pending_failed" &&
    association.lastError === CITY_PROFILE_MISSING &&
    input.cityId != null
  ) {
    return "城市档案缺失（关联指向的城市已不存在），需人工修正";
  }
  return null;
}
