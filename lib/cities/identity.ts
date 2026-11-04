/**
 * City identity — pure string work, no I/O.
 *
 * The rules here decide when two inputs are "the same city". They are
 * deliberately CONSERVATIVE:
 *
 *  - exact normalised equality only — no fuzzy / edit-distance matching,
 *    because a wrong auto-merge silently moves one city's packs under another;
 *  - country always participates, so "Springfield" in two countries can never
 *    collapse into one profile;
 *  - administrative area participates when both sides have one;
 *  - an ambiguous match (same name, several candidate admins) creates a new
 *    profile instead of guessing which one was meant.
 */

import { createHash } from "node:crypto";
import type { CityProfile } from "./types";

/**
 * Normalise a display name into a comparison key.
 *
 * NFKD + diacritic stripping makes "A Coruña" and "A Coruna" equal; punctuation
 * removal makes "St. Louis" and "St Louis" equal. CJK is untouched by both
 * steps, so "马尼拉" stays "马尼拉" and only matches itself.
 */
export function normalizeCityName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’'`´]/g, "")
    .replace(/[.,;:!?()[\]{}"“”«»/\\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Every name this profile answers to, normalised and de-duplicated. */
export function cityNameKeys(city: CityProfile): Set<string> {
  const keys = new Set<string>();
  const add = (value: string | undefined | null) => {
    if (!value) return;
    const key = normalizeCityName(value);
    if (key) keys.add(key);
  };
  add(city.cityName);
  for (const value of Object.values(city.localizedNames ?? {})) add(value);
  for (const value of city.aliases ?? []) add(value);
  return keys;
}

/** Normalised administrative key; "" when the profile has no admin unit. */
export function adminKey(city: Pick<CityProfile, "adminAreaId" | "adminAreaName">): string {
  const id = city.adminAreaId?.trim();
  if (id) return `id:${id.toLowerCase()}`;
  const name = city.adminAreaName?.trim();
  return name ? `name:${normalizeCityName(name)}` : "";
}

/**
 * All administrative keys a profile answers to.
 *
 * A profile may carry an id, a name, or both; an input may carry only a name
 * ("Illinois") while the stored profile has the code ("IL"). Comparing primary
 * keys alone would miss that pair, so compatibility is set intersection.
 */
export function adminKeys(city: Pick<CityProfile, "adminAreaId" | "adminAreaName">): Set<string> {
  const keys = new Set<string>();
  const id = city.adminAreaId?.trim();
  if (id) keys.add(`id:${id.toLowerCase()}`);
  const name = city.adminAreaName?.trim();
  if (name) {
    const normalised = normalizeCityName(name);
    if (normalised) keys.add(`name:${normalised}`);
  }
  return keys;
}

export interface CityIdentityInput {
  cityName: string;
  countryCode: string;
  countryName?: string;
  adminAreaId?: string;
  adminAreaName?: string;
  localizedNames?: Record<string, string>;
  aliases?: string[];
  /** Optional WGS84 anchor; identity matching never uses it. */
  referenceLocation?: { lat: number; lng: number };
}

function inputAdminKey(input: CityIdentityInput): string {
  return adminKey({
    adminAreaId: input.adminAreaId,
    adminAreaName: input.adminAreaName,
  } as Pick<CityProfile, "adminAreaId" | "adminAreaName">);
}

function inputAdminKeys(input: CityIdentityInput): Set<string> {
  return adminKeys({
    adminAreaId: input.adminAreaId,
    adminAreaName: input.adminAreaName,
  } as Pick<CityProfile, "adminAreaId" | "adminAreaName">);
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/** Deterministic identity string, used for hashing and debugging. */
export function identityKey(input: CityIdentityInput): string {
  const name = normalizeCityName(input.cityName);
  return [input.countryCode.toUpperCase(), inputAdminKey(input), name].join("|");
}

export type CityMatch =
  | { kind: "none" }
  | { kind: "match"; city: CityProfile }
  /** Several profiles share the name and one side lacks an admin unit. */
  | { kind: "ambiguous"; candidates: CityProfile[] };

/**
 * Find the profile an input refers to.
 *
 * Returns `ambiguous` rather than picking a winner: an ambiguous input must
 * create a NEW profile (and may later be merged by an operator), never be
 * auto-attached to a guess.
 */
export function findCityMatch(cities: CityProfile[], input: CityIdentityInput): CityMatch {
  const country = input.countryCode.toUpperCase();
  const wantedNames = new Set<string>();
  const add = (value: string | undefined | null) => {
    if (!value) return;
    const key = normalizeCityName(value);
    if (key) wantedNames.add(key);
  };
  add(input.cityName);
  for (const value of Object.values(input.localizedNames ?? {})) add(value);
  for (const value of input.aliases ?? []) add(value);

  const wantedAdmin = inputAdminKey(input);
  const wantedAdminKeys = inputAdminKeys(input);
  const candidates = cities.filter((city) => {
    if (city.countryCode.toUpperCase() !== country) return false;
    const keys = cityNameKeys(city);
    let nameHit = false;
    for (const name of wantedNames) {
      if (keys.has(name)) {
        nameHit = true;
        break;
      }
    }
    if (!nameHit) return false;

    const storedAdminKeys = adminKeys(city);
    if (wantedAdminKeys.size > 0 && storedAdminKeys.size > 0) {
      return intersects(wantedAdminKeys, storedAdminKeys);
    }
    // One side has no admin unit: only safe when it cannot be confused with a
    // different administrative unit of the same country.
    return true;
  });

  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "match", city: candidates[0] };
  // More than one profile answers to this name. If exactly one of them matches
  // the requested admin unit strictly, prefer it; otherwise refuse to guess.
  const strict = candidates.filter(
    (city) => wantedAdmin !== "" && intersects(wantedAdminKeys, adminKeys(city)),
  );
  if (strict.length === 1) return { kind: "match", city: strict[0] };
  return { kind: "ambiguous", candidates };
}

const ASCII_SLUG = /[^a-z0-9]+/g;

function asciiSlug(raw: string): string {
  const base = raw
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(ASCII_SLUG, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, 40);
}

/**
 * Derive the stable id for a new profile.
 *
 * Latin names slugify ("manila-ph"). Names with no usable ASCII (CJK, Arabic…)
 * fall back to the English name when present, otherwise to a deterministic
 * hash of the identity key — never to a random id, because the same identity
 * must land on the same candidate id for the exclusive-create race to resolve
 * correctly in a second request.
 */
export function deriveCityId(input: CityIdentityInput): string {
  const country = input.countryCode.toLowerCase();
  const english = input.localizedNames?.["en"];
  const slug = asciiSlug(input.cityName) || (english ? asciiSlug(english) : "");
  if (slug) return `${slug}-${country}`;
  const hash = createHash("sha256").update(identityKey(input)).digest("hex").slice(0, 8);
  return `city-${hash}-${country}`;
}
