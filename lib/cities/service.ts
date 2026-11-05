/**
 * City service — validation, create-or-reuse, merge, public views.
 *
 * The rule that matters most, in two halves:
 *
 *  1. THE SERVER decides whether a city already exists. A client may send any
 *     name; it never sends an id it invented, and it never gets to skip the
 *     identity check.
 *  2. A CITY ONLY EXISTS BECAUSE CONTENT NEEDS IT. Creation is reachable only
 *     through {@link attachCityToWork}, which requires a persisted work, an
 *     actor with permission over it, and writes the association in the same
 *     call. There is no public "create a city" verb — not for a bare name, not
 *     for a catalogue entry, not for a search box.
 *
 * Ordering inside that flow (and why):
 *
 *   1. read the work                        → 404 before anything is written
 *   2. ask the state machine about the actor → 403 before anything is written
 *   3. reuse an existing profile, or create one stamped with `sourceGameId`
 *   4. commit the work's `cityId` (revision-checked)
 *   5. derive the index entry (after the commit, never before)
 *
 * If step 4 fails we roll the profile back — but only when this very request
 * created it, it is still untouched (revision 0), and nothing has linked to it
 * yet. If even the rollback fails, the profile is not lost in the void: it
 * carries `sourceGameId`, so a retry of the same request reuses it and
 * completes the association, and {@link auditCityProvenance} reports it in the
 * meantime. Nothing here claims transactional guarantees Blob does not have.
 *
 * No external geocoder is called here (batch 1 boundary): the city is whatever
 * the user chose, and `referenceLocation` is optional, supplied by the caller
 * from its own pack coordinates.
 */

import { HttpError } from "../auth/guard";
import type { ActorContext } from "../registry/service";
import { setWorkCity } from "../registry/service";
import { getRegistry, type RegistryStore } from "../registry/store";
import { canSetCity } from "../registry/state-machine";
import { isValidGameId } from "../publish/version";
import { findCityMatch, deriveCityId, type CityIdentityInput } from "./identity";
import { countPublishedByCity } from "./link";
import { resolveCityRef } from "./resolve";
import { getCityStore, type CityStore } from "./store";
import {
  CITY_SCHEMA_VERSION,
  isCountryCode,
  isValidCityId,
  type CityProfile,
  type PublicCity,
} from "./types";

const MAX_NAME_LENGTH = 80;
const MAX_ALIASES = 10;
const MAX_LOCALIZED = 12;
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function assertText(value: unknown, field: string, max = MAX_NAME_LENGTH): string {
  if (typeof value !== "string") throw new HttpError(400, "invalid_city_input", `${field} 必须是字符串。`);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, "invalid_city_input", `${field} 不能为空。`);
  if (trimmed.length > max) {
    throw new HttpError(400, "invalid_city_input", `${field} 超过 ${max} 字符上限。`);
  }
  if (hasControlChars(trimmed)) {
    throw new HttpError(400, "invalid_city_input", `${field} 含有不可见控制字符。`);
  }
  return trimmed;
}

/** Parse and normalise an untrusted create-or-reuse payload. */
export function parseCityInput(raw: unknown): CityIdentityInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "invalid_city_input", "请求体必须是一个 JSON 对象。");
  }
  const body = raw as Record<string, unknown>;
  const cityName = assertText(body.cityName, "cityName");
  const countryRaw = assertText(body.countryCode, "countryCode", 8).toUpperCase();
  if (!isCountryCode(countryRaw)) {
    throw new HttpError(400, "invalid_country", "countryCode 必须是 ISO 3166-1 两位字母代码。");
  }
  const countryName =
    body.countryName === undefined || body.countryName === null
      ? countryRaw
      : assertText(body.countryName, "countryName");

  const adminAreaId =
    body.adminAreaId === undefined || body.adminAreaId === null
      ? undefined
      : assertText(body.adminAreaId, "adminAreaId", 32);
  const adminAreaName =
    body.adminAreaName === undefined || body.adminAreaName === null
      ? undefined
      : assertText(body.adminAreaName, "adminAreaName");

  let localizedNames: Record<string, string> | undefined;
  if (body.localizedNames !== undefined && body.localizedNames !== null) {
    if (typeof body.localizedNames !== "object" || Array.isArray(body.localizedNames)) {
      throw new HttpError(400, "invalid_city_input", "localizedNames 必须是对象。");
    }
    const entries = Object.entries(body.localizedNames as Record<string, unknown>);
    if (entries.length > MAX_LOCALIZED) {
      throw new HttpError(400, "invalid_city_input", `localizedNames 最多 ${MAX_LOCALIZED} 项。`);
    }
    localizedNames = {};
    for (const [locale, value] of entries) {
      if (!LOCALE_KEY.test(locale)) {
        throw new HttpError(400, "invalid_city_input", `localizedNames 的语言标记不合法：${locale}`);
      }
      localizedNames[locale] = assertText(value, `localizedNames.${locale}`);
    }
  }

  let aliases: string[] | undefined;
  if (body.aliases !== undefined && body.aliases !== null) {
    if (!Array.isArray(body.aliases)) {
      throw new HttpError(400, "invalid_city_input", "aliases 必须是字符串数组。");
    }
    if (body.aliases.length > MAX_ALIASES) {
      throw new HttpError(400, "invalid_city_input", `aliases 最多 ${MAX_ALIASES} 项。`);
    }
    aliases = body.aliases.map((value, index) => assertText(value, `aliases[${index}]`));
  }

  let referenceLocation: { lat: number; lng: number } | undefined;
  if (body.referenceLocation !== undefined && body.referenceLocation !== null) {
    const point = body.referenceLocation as Record<string, unknown>;
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new HttpError(400, "invalid_city_input", "referenceLocation 坐标不合法。");
    }
    referenceLocation = { lat, lng };
  }

  return { cityName, countryCode: countryRaw, countryName, adminAreaId, adminAreaName, localizedNames, aliases, referenceLocation };
}

export interface CreateCityResult {
  city: CityProfile;
  created: boolean;
  reused: boolean;
  /** The input could have meant more than one existing city; a new one was created. */
  ambiguous: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal invariants every caller must satisfy, whether the input arrived over
 * HTTP or from an internal call. Route-level validation is not enough: an
 * empty name would otherwise create a profile nobody can ever match.
 */
function assertIdentityInput(input: CityIdentityInput): void {
  const name = input.cityName?.trim();
  if (!name) throw new HttpError(400, "invalid_city_input", "cityName 不能为空。");
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, "invalid_city_input", `cityName 超过 ${MAX_NAME_LENGTH} 字符上限。`);
  }
  const country = input.countryCode?.trim().toUpperCase();
  if (!isCountryCode(country)) {
    throw new HttpError(400, "invalid_country", "countryCode 必须是 ISO 3166-1 两位字母代码。");
  }
}

/** Who caused a creation, and the pack that justified it. */
export interface CitySource {
  gameId: string;
  userId: string;
}

/**
 * Create the city or return the existing profile that means the same place.
 *
 * NOT exported: the only caller is {@link attachCityToWork}, which has already
 * proved that the pack exists and that this actor may touch it. Exporting this
 * would reintroduce exactly the "city with no content behind it" hole the V2
 * authorisation closed.
 *
 * Idempotent by construction: the second identical request finds the profile
 * written by the first, and two racing first requests both end up on the
 * winner because the loser re-reads after its exclusive-create conflict.
 */
async function createOrReuseCity(
  input: CityIdentityInput,
  source: CitySource,
  deps: { store?: CityStore; now?: string } = {},
): Promise<CreateCityResult> {
  assertIdentityInput(input);
  const store = deps.store ?? getCityStore();
  const now = deps.now ?? new Date().toISOString();

  const matchExisting = async (): Promise<CreateCityResult | null> => {
    const cities = await store.listCities();
    // Merged profiles still answer to their names; the pointer is followed
    // below, so a retired id can never leak into a link.
    const match = findCityMatch(cities, input);
    if (match.kind === "match") {
      const resolved = await resolveCityRef(store, match.city.cityId);
      if (resolved) {
        return { city: resolved.city, created: false, reused: true, ambiguous: false };
      }
    }
    if (match.kind === "ambiguous") {
      return null; // caller must create a new profile rather than guess
    }
    return null;
  };

  const existing = await matchExisting();
  if (existing) return existing;

  const baseId = deriveCityId(input);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidateId = attempt === 0 ? baseId : `${baseId}-${attempt + 1}`;
    if (!isValidCityId(candidateId)) break;

    const profile: CityProfile = {
      schemaVersion: CITY_SCHEMA_VERSION,
      cityId: candidateId,
      countryCode: input.countryCode.toUpperCase(),
      countryName: input.countryName?.trim() || input.countryCode.toUpperCase(),
      adminAreaId: input.adminAreaId,
      adminAreaName: input.adminAreaName,
      cityName: input.cityName.trim(),
      localizedNames: { ...(input.localizedNames ?? {}) },
      aliases: [...(input.aliases ?? [])],
      referenceLocation: input.referenceLocation,
      // Provenance, set exactly once: this pack is why the city exists.
      sourceGameId: source.gameId,
      sourceUserId: source.userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };

    const created = await store.createCity(profile);
    if (created.ok) {
      return { city: profile, created: true, reused: false, ambiguous: false };
    }

    // Someone else wrote this id first. If it is the same city, reuse it; if
    // it is a different city that happens to share the slug, try the next one.
    const raced = await matchExisting();
    if (raced) return raced;
    const cities = await store.listCities();
    if (findCityMatch(cities, input).kind === "ambiguous") {
      // Keep trying suffixes; the ambiguous case must not be force-merged.
      await sleep(1);
    }
  }

  throw new HttpError(409, "city_id_exhausted", "城市档案创建冲突过多，请稍后重试。");
}

/* ------------------------------------------------------------------ */
/* The one and only write path: pack → city                           */
/* ------------------------------------------------------------------ */

export interface AttachCityRequest {
  /** Attach an existing profile. `null` clears the association. */
  cityId?: string | null;
  /** Create-or-reuse by identity, then attach. Mutually exclusive with cityId. */
  city?: CityIdentityInput;
}

export interface AttachCityResult {
  work: Awaited<ReturnType<typeof setWorkCity>>;
  city: CityProfile | null;
  created: boolean;
  reused: boolean;
  ambiguous: boolean;
}

/**
 * Roll back a profile this request created but could not attach.
 *
 * Guards, in order of importance: it must be the profile we wrote (revision
 * still 0), and no link may reference it. Both can be violated by a concurrent
 * attach for the same city — in that case the other request owns the profile
 * now, so it is left alone. Best effort by definition; a failed rollback is
 * reported, never thrown, because the caller is already on an error path.
 */
async function rollbackUnlinkedCity(
  store: CityStore,
  city: CityProfile,
  reason: string,
): Promise<void> {
  try {
    const current = await store.getCity(city.cityId);
    if (!current) return;
    if (current.revision !== 0 || current.createdAt !== city.createdAt) return; // touched since
    const links = await store.listLinks();
    if (links.some((entry) => entry.cityId === city.cityId)) return; // adopted concurrently
    await store.deleteCity(city.cityId);
  } catch (error) {
    console.error(
      "[cities] 未能回滚未关联的城市档案（可由 auditCityProvenance 发现并重试修复）",
      city.cityId,
      reason,
      error,
    );
  }
}

/**
 * Associate a pack with a city, creating the profile only if it is genuinely
 * new — the single entry point for city creation.
 *
 * Verification order matters and is not negotiable: the work must exist, and
 * the actor must be allowed to set its city, BEFORE a profile is written. A
 * rejected request therefore leaves the city store exactly as it found it.
 *
 * Idempotent: replaying the same request reuses the same profile and the state
 * machine reports `changed: false`, so nothing is rewritten and no duplicate
 * is produced.
 */
export async function attachCityToWork(
  actor: ActorContext,
  gameId: string,
  request: AttachCityRequest,
  deps: { store?: CityStore; registry?: RegistryStore; now?: string } = {},
): Promise<AttachCityResult> {
  if (!isValidGameId(gameId)) {
    throw new HttpError(400, "invalid_game_id", "游戏 id 不合法。");
  }
  if (request.cityId !== undefined && request.city !== undefined) {
    throw new HttpError(400, "ambiguous_city_input", "cityId 与 city 不能同时提供。");
  }

  const registry = deps.registry ?? getRegistry();
  const store = deps.store ?? getCityStore();

  const work = await registry.getWork(gameId);
  if (!work) {
    throw new HttpError(404, "work_not_found", "作品不存在，无法关联城市。");
  }
  // Ask the state machine first: no profile may be created for a request that
  // was always going to be rejected.
  const denied = canSetCity(work, { userId: actor.user.id, role: actor.user.role });
  if (denied) {
    throw new HttpError(403, denied.code, denied.message);
  }

  if (request.cityId === null) {
    const cleared = await setWorkCity(actor, gameId, null);
    return { work: cleared, city: null, created: false, reused: false, ambiguous: false };
  }

  let city: CityProfile;
  let created = false;
  let reused = false;
  let ambiguous = false;

  if (request.cityId !== undefined) {
    const resolved = await resolveCityRef(store, request.cityId);
    if (!resolved) {
      throw new HttpError(400, "city_not_found", "城市档案不存在，无法建立关联。");
    }
    city = resolved.city;
    reused = true;
  } else if (request.city) {
    const result = await createOrReuseCity(
      request.city,
      { gameId, userId: actor.user.id },
      { store, now: deps.now },
    );
    city = result.city;
    created = result.created;
    reused = result.reused;
    ambiguous = result.ambiguous;
  } else {
    throw new HttpError(400, "city_required", "必须提供 cityId 或 city。");
  }

  try {
    const updated = await setWorkCity(actor, gameId, city.cityId);
    return { work: updated, city, created, reused, ambiguous };
  } catch (error) {
    if (created) {
      await rollbackUnlinkedCity(store, city, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

/**
 * Read-only integrity report: which active profiles have no content behind
 * them?
 *
 * A profile counts as backed when at least one work references it (directly or
 * through a merge pointer) or at least one index entry does. Anything else is
 * either a rollback that did not land or a legacy/manual artefact. Reported,
 * never deleted — removal is an operator decision (§ lifecycle boundary).
 */
export interface CityProvenanceReport {
  scanned: number;
  backed: number;
  orphans: Array<{
    cityId: string;
    cityName: string;
    sourceGameId: string | null;
    reason: "no_work_reference" | "source_work_missing" | "source_work_not_linked";
  }>;
}

export async function auditCityProvenance(
  deps: { store?: CityStore; registry?: RegistryStore } = {},
): Promise<CityProvenanceReport> {
  const store = deps.store ?? getCityStore();
  const registry = deps.registry ?? getRegistry();

  const cities = (await store.listCities()).filter((city) => city.status === "active");
  const works = await registry.listWorks();
  const links = await store.listLinks();

  const referenced = new Set<string>();
  const record = async (rawId: string | undefined | null): Promise<void> => {
    if (!rawId) return;
    const resolved = await resolveCityRef(store, rawId).catch(() => null);
    if (resolved) referenced.add(resolved.city.cityId);
  };
  for (const work of works) await record(work.cityId);
  for (const entry of links) await record(entry.cityId);

  const byId = new Map(cities.map((city) => [city.cityId, city] as const));
  const orphanIds = new Set<string>();
  for (const city of cities) {
    if (referenced.has(city.cityId)) continue;
    orphanIds.add(city.cityId);
  }

  const report: CityProvenanceReport = {
    scanned: cities.length,
    backed: cities.length - orphanIds.size,
    orphans: [],
  };
  for (const cityId of orphanIds) {
    const city = byId.get(cityId)!;
    const sourceGameId = city.sourceGameId ?? null;
    let reason: CityProvenanceReport["orphans"][number]["reason"] = "no_work_reference";
    if (sourceGameId) {
      const source = works.find((work) => work.gameId === sourceGameId);
      reason = source ? "source_work_not_linked" : "source_work_missing";
    }
    report.orphans.push({ cityId, cityName: city.cityName, sourceGameId, reason });
  }
  report.orphans.sort((a, b) => a.cityId.localeCompare(b.cityId));
  return report;
}

export interface CityListQuery {
  q?: string;
  country?: string;
  /**
   * `public` (default) = the discovery catalogue: only cities that currently
   * have at least one PUBLISHED pack.
   *
   * `picker` = the creator's picker: published cities PLUS the cities this
   * author's own works are attached to (drafts included), so a creator can
   * find the city their unpublished pack created — and NOTHING else. It must
   * never widen into "all cities", because drafts of other authors are not
   * this actor's business.
   *
   * `manage` = one work's own association (resolved per work in A8).
   * `admin` = staff only, full catalogue including cities with no published
   * pack, for provenance and repair work.
   */
  scope?: "public" | "picker" | "manage" | "admin";
  /** Required for `picker`: the actor whose own works define the visible set. */
  actorUserId?: string;
  /**
   * Optional cap on the number of rows returned, applied AFTER filtering and
   * sorting — i.e. "the first N cities of this result", never "a sample".
   *
   * It exists because a preview strip (the Game Center entry shows at most
   * three cities) must not have to download the whole catalogue to render one
   * card. Because it changes the response, it is part of the client cache key
   * as well (see `lib/cities/client.ts`).
   */
  limit?: number;
}

/** Hard ceiling for `limit`: a caller may not ask for an unbounded page. */
export const CITY_LIST_MAX_LIMIT = 200;

/** Public listing projection, with a count validated against the works. */
export async function listCitiesPublic(
  query: CityListQuery = {},
  deps: { store?: CityStore; registry?: RegistryStore } = {},
): Promise<PublicCity[]> {
  const store = deps.store ?? getCityStore();
  const scope = query.scope ?? "public";
  const cities = (await store.listCities()).filter((city) => city.status === "active");
  // Counts come from published WORKS, not from the derived index: the index can
  // lag behind a withdrawal, and a lagging index would advertise a city whose
  // only pack is no longer discoverable.
  const counts = await countPublishedByCity({ cityStore: store, registry: deps.registry });

  /*
   * `picker` visibility = published cities ∪ the cities THIS author's works
   * point at. Built from the author's own work documents (the authority), so a
   * stale `city-links` entry can neither add nor hide a city here.
   */
  let ownCityIds: Set<string> | null = null;
  if (scope === "picker") {
    ownCityIds = new Set<string>();
    if (query.actorUserId) {
      const registry = deps.registry ?? getRegistry();
      for (const work of await registry.listWorks()) {
        if (work.ownerUserId !== query.actorUserId) continue;
        if (work.cityId) ownCityIds.add(work.cityId);
        if (work.cityIntent?.cityId) ownCityIds.add(work.cityIntent.cityId);
      }
    }
  }

  const q = query.q?.trim().toLowerCase() ?? "";
  const country = query.country?.trim().toUpperCase() ?? "";
  const rawLimit = typeof query.limit === "number" && Number.isFinite(query.limit) ? Math.floor(query.limit) : null;
  const limit = rawLimit !== null && rawLimit > 0 ? Math.min(rawLimit, CITY_LIST_MAX_LIMIT) : null;

  const rows = cities
    .filter((city) => {
      if (scope === "public") return (counts.get(city.cityId) ?? 0) > 0;
      if (scope === "picker") {
        return (counts.get(city.cityId) ?? 0) > 0 || Boolean(ownCityIds?.has(city.cityId));
      }
      // `admin` and `manage` see the profile regardless of published counts.
      return true;
    })
    .filter((city) => (country ? city.countryCode === country : true))
    .filter((city) => {
      if (!q) return true;
      const haystack = [
        city.cityName,
        city.countryName,
        city.adminAreaName ?? "",
        ...Object.values(city.localizedNames),
        ...city.aliases,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .map((city) => ({
      cityId: city.cityId,
      cityName: city.cityName,
      countryCode: city.countryCode,
      countryName: city.countryName,
      adminAreaName: city.adminAreaName ?? null,
      localizedNames: city.localizedNames,
      status: city.status,
      gameCount: counts.get(city.cityId) ?? 0,
    }))
    .sort((a, b) => a.cityName.localeCompare(b.cityName, "zh-Hans-CN"));

  // Truncation happens last, so "first 3" always means the first three rows of
  // the ordered, filtered result — the same three a full request would show
  // first, and never an unordered subset of the store.
  return limit === null ? rows : rows.slice(0, limit);
}

export interface PublicCityDetail {
  city: PublicCity;
  requestedCityId: string;
  redirected: boolean;
}

export async function getPublicCity(
  cityId: string,
  deps: { store?: CityStore; registry?: RegistryStore } = {},
): Promise<PublicCityDetail | null> {
  if (!isValidCityId(cityId)) return null;
  const store = deps.store ?? getCityStore();
  const resolved = await resolveCityRef(store, cityId);
  if (!resolved) return null;
  // Direct reference (never discovery): the profile is returned even with zero
  // published packs, so a creator can see the city their draft belongs to.
  // `gameCount` still counts only packs a stranger could actually open.
  const counts = await countPublishedByCity({ cityStore: store, registry: deps.registry });
  const gameCount = counts.get(resolved.city.cityId) ?? 0;
  return {
    city: {
      cityId: resolved.city.cityId,
      cityName: resolved.city.cityName,
      countryCode: resolved.city.countryCode,
      countryName: resolved.city.countryName,
      adminAreaName: resolved.city.adminAreaName ?? null,
      localizedNames: resolved.city.localizedNames,
      status: resolved.city.status,
      gameCount,
    },
    requestedCityId: cityId,
    redirected: resolved.redirected,
  };
}

export interface MergeResult {
  from: string;
  into: string;
  linksMoved: number;
}

/**
 * Point one profile at another. Operator action only — never automatic.
 *
 * The retired profile is kept (status `merged` + `mergedInto`), so the merge is
 * reversible by clearing the pointer, and every old id keeps resolving.
 */
export async function mergeCities(
  fromCityId: string,
  intoCityId: string,
  deps: { store?: CityStore; now?: string } = {},
): Promise<MergeResult> {
  const store = deps.store ?? getCityStore();
  const now = deps.now ?? new Date().toISOString();

  if (!isValidCityId(fromCityId) || !isValidCityId(intoCityId)) {
    throw new HttpError(400, "invalid_city_id", "城市 id 不合法。");
  }
  if (fromCityId === intoCityId) {
    throw new HttpError(400, "invalid_merge", "不能把城市合并到自身。");
  }

  const from = await store.getCity(fromCityId);
  if (!from) throw new HttpError(404, "city_not_found", "待合并的城市档案不存在。");
  if (from.status === "merged") {
    throw new HttpError(409, "already_merged", "该城市档案已经合并到其他城市。");
  }

  const target = await resolveCityRef(store, intoCityId);
  if (!target) throw new HttpError(404, "city_not_found", "目标城市档案不存在。");
  if (target.chain.includes(fromCityId)) {
    throw new HttpError(409, "merge_cycle", "合并会形成环，已拒绝。");
  }

  // Move the derived links first: a crash between the two steps leaves links
  // pointing at a still-active profile (harmless) rather than at a merged id
  // with no forwarding pointer.
  const links = await store.listLinks();
  let moved = 0;
  for (const entry of links) {
    if (entry.cityId !== fromCityId) continue;
    await store.putLink({ ...entry, cityId: target.city.cityId, updatedAt: now });
    moved += 1;
  }

  const next: CityProfile = {
    ...from,
    status: "merged",
    mergedInto: target.city.cityId,
    updatedAt: now,
    revision: from.revision + 1,
  };
  const written = await store.putCity(next, from.revision);
  if (!written.ok) {
    throw new HttpError(409, "write_conflict", "城市档案刚刚被修改，请刷新后重试。");
  }

  return { from: fromCityId, into: target.city.cityId, linksMoved: moved };
}

/** Update mutable presentation fields (operator tooling; revision-checked). */
export async function updateCityDisplay(
  cityId: string,
  patch: { cityName?: string; aliases?: string[]; localizedNames?: Record<string, string>; referenceLocation?: { lat: number; lng: number } },
  deps: { store?: CityStore; now?: string } = {},
): Promise<CityProfile> {
  const store = deps.store ?? getCityStore();
  const now = deps.now ?? new Date().toISOString();
  const current = await store.getCity(cityId);
  if (!current) throw new HttpError(404, "city_not_found", "城市档案不存在。");

  const next: CityProfile = {
    ...current,
    cityName: patch.cityName ? assertText(patch.cityName, "cityName") : current.cityName,
    aliases: patch.aliases ? patch.aliases.map((a, i) => assertText(a, `aliases[${i}]`)) : current.aliases,
    localizedNames: patch.localizedNames ?? current.localizedNames,
    referenceLocation: patch.referenceLocation ?? current.referenceLocation,
    updatedAt: now,
    revision: current.revision + 1,
  };
  const written = await store.putCity(next, current.revision);
  if (!written.ok) {
    throw new HttpError(409, "write_conflict", "城市档案刚刚被修改，请刷新后重试。");
  }
  return next;
}
