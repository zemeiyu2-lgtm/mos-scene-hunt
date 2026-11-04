/**
 * City service — validation, create-or-reuse, merge, public views.
 *
 * The rule that matters most: THE SERVER decides whether a city already exists.
 * A client may send any name; it never sends an id it invented, and it never
 * gets to skip the identity check. Creation is a create-if-absent write, so two
 * simultaneous requests for the same city converge on one profile even when
 * they both miss the lookup.
 *
 * No external geocoder is called here (batch 1 boundary): the city is whatever
 * the user chose, and `referenceLocation` is optional, supplied by the caller
 * from its own pack coordinates.
 */

import { HttpError } from "../auth/guard";
import { findCityMatch, deriveCityId, type CityIdentityInput } from "./identity";
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

/**
 * Create the city or return the existing profile that means the same place.
 *
 * Idempotent by construction: the second identical request finds the profile
 * written by the first, and two racing first requests both end up on the
 * winner because the loser re-reads after its exclusive-create conflict.
 */
export async function createOrReuseCity(
  input: CityIdentityInput,
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

/** Public listing projection, with a lightweight count from the derived index. */
export async function listCitiesPublic(
  query: { q?: string; country?: string } = {},
  deps: { store?: CityStore } = {},
): Promise<PublicCity[]> {
  const store = deps.store ?? getCityStore();
  const cities = (await store.listCities()).filter((city) => city.status === "active");
  const links = await store.listLinks();
  const counts = new Map<string, number>();
  for (const entry of links) {
    if (!entry.visible) continue;
    counts.set(entry.cityId, (counts.get(entry.cityId) ?? 0) + 1);
  }

  const q = query.q?.trim().toLowerCase() ?? "";
  const country = query.country?.trim().toUpperCase() ?? "";

  return cities
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
}

export interface PublicCityDetail {
  city: PublicCity;
  requestedCityId: string;
  redirected: boolean;
}

export async function getPublicCity(
  cityId: string,
  deps: { store?: CityStore } = {},
): Promise<PublicCityDetail | null> {
  if (!isValidCityId(cityId)) return null;
  const store = deps.store ?? getCityStore();
  const resolved = await resolveCityRef(store, cityId);
  if (!resolved) return null;
  const links = await store.listLinks();
  const gameCount = links.filter(
    (entry) => entry.visible && entry.cityId === resolved.city.cityId,
  ).length;
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
