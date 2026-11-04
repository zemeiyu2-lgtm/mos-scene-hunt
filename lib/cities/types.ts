/**
 * City profile data model — 城市档案.
 *
 * Design rules fixed by the V1.1 plan and the implementation authorisation:
 *
 *  1. A city NAME is never an identifier. `cityId` is a stable slug derived
 *     once at creation and never re-derived afterwards.
 *  2. Country + administrative area participate in identity: two cities with
 *     the same name in different countries are different profiles, and are
 *     never merged automatically.
 *  3. Multilingual names must resolve to ONE profile: `cityName`,
 *     `localizedNames` and `aliases` all feed the same normalised match set.
 *  4. A merged profile keeps its document forever and points at the survivor
 *     via `mergedInto`; readers follow the pointer transparently.
 *  5. Profile documents and the work↔city links are stored separately: a
 *     profile is authoritative, a link is derived and rebuildable.
 */

export const CITY_SCHEMA_VERSION = 1;

/** Stable id shape: lowercase slug, 2–64 chars, may not start/end with "-". */
export const CITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/** ISO 3166-1 alpha-2, upper case. Stored upper case, compared upper case. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

export type CityStatus = "active" | "merged";

export interface LocalizedPoint {
  lat: number;
  lng: number;
}

export interface CityProfile {
  schemaVersion: number;
  /** Stable identifier. Derived once from name+country, then immutable. */
  cityId: string;
  /** ISO 3166-1 alpha-2, e.g. "PH". */
  countryCode: string;
  countryName: string;
  /** Sub-country administrative unit id (e.g. province code). Optional. */
  adminAreaId?: string;
  /** Sub-country administrative unit name, e.g. "Metro Manila". */
  adminAreaName?: string;
  /** Primary display name in the creator's language. */
  cityName: string;
  /** BCP-47 tag → name. Every value participates in identity matching. */
  localizedNames: Record<string, string>;
  /** Additional spellings that must resolve to this profile (free text). */
  aliases: string[];
  /** WGS84 decimal degrees, taken from the first linked pack's huntArea. */
  referenceLocation?: LocalizedPoint;
  /**
   * PROVENANCE. The pack whose association created this profile. Immutable and
   * the answer to "what real content justified this city existing?".
   *
   * A profile may never be created outside a work-association flow, so a
   * missing `sourceGameId` on a fresh profile is a defect, not a valid state.
   */
  sourceGameId?: string;
  /** Actor that triggered creation. Audit value only, never public. */
  sourceUserId?: string;
  status: CityStatus;
  /** Survivor of a merge. Present only when `status === "merged"`. */
  mergedInto?: string;
  createdAt: string;
  updatedAt: string;
  /** Bumped on every successful write; the optimistic-concurrency token. */
  revision: number;
}

/**
 * Derived work↔city link. One document per work (`city-links/<gameId>.json`),
 * so concurrent publishes of different works never contend, and repeated
 * writes of the same work are idempotent by key.
 *
 * `visible` mirrors "state === published" at write time. Readers MUST still
 * re-check the work document: a link is an index entry, never the authority.
 */
export interface CityLink {
  schemaVersion: number;
  gameId: string;
  cityId: string;
  title: string;
  /** Work state at the time the link was written (audit/debug only). */
  state: string;
  visible: boolean;
  updatedAt: string;
}

/** Public projection — never leaks storage keys or internal revision numbers. */
export interface PublicCity {
  cityId: string;
  cityName: string;
  countryCode: string;
  countryName: string;
  adminAreaName: string | null;
  localizedNames: Record<string, string>;
  status: CityStatus;
  gameCount: number;
}

export function isCityStatus(value: unknown): value is CityStatus {
  return value === "active" || value === "merged";
}

export function isValidCityId(value: unknown): value is string {
  return typeof value === "string" && CITY_ID_PATTERN.test(value);
}

export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && COUNTRY_CODE_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Structural validation for a stored profile document. */
export function parseCity(raw: string): CityProfile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== CITY_SCHEMA_VERSION) return null;
  if (!isValidCityId(parsed.cityId)) return null;
  if (!isCountryCode(parsed.countryCode)) return null;
  if (typeof parsed.cityName !== "string" || !parsed.cityName.trim()) return null;
  if (!isCityStatus(parsed.status)) return null;
  if (parsed.status === "merged" && !isValidCityId(parsed.mergedInto)) return null;
  if (typeof parsed.revision !== "number" || !Number.isFinite(parsed.revision)) return null;
  if (!isRecord(parsed.localizedNames)) return null;
  if (!Array.isArray(parsed.aliases)) return null;
  return parsed as unknown as CityProfile;
}

export function parseCityLink(raw: string, gameId: string): CityLink | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== CITY_SCHEMA_VERSION) return null;
  if (parsed.gameId !== gameId) return null;
  if (!isValidCityId(parsed.cityId)) return null;
  if (typeof parsed.visible !== "boolean") return null;
  return parsed as unknown as CityLink;
}
