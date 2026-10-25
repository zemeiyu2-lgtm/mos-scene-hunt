/**
 * Stable identity for published games.
 *
 * A published game keeps its author-assigned `game.id` as the stable
 * `gameId`; every publish produces an immutable `versionId` derived from the
 * canonical form of the game content. Because the version id is a content
 * hash, republishing identical content is a no-op and two publishes of
 * different content can never collide on the same version object - which is
 * what makes "published versions are immutable" enforceable in storage.
 *
 * This module is platform-neutral: no filesystem, no fetch, no globals beyond
 * the standard Web Crypto API (available in Node 18+ and every browser).
 */

/** Published game ids reuse the content-pack id shape, lowercase and safe in URLs. */
export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A derived versionId: 16 lowercase hex characters (64 bits of SHA-256). */
export const VERSION_ID_PATTERN = /^[0-9a-f]{16}$/;

export function isValidGameId(value: unknown): value is string {
  return typeof value === "string" && GAME_ID_PATTERN.test(value);
}

export function isValidVersionId(value: unknown): value is string {
  return typeof value === "string" && VERSION_ID_PATTERN.test(value);
}

/**
 * Deterministic JSON serialisation: object keys sorted recursively, arrays
 * kept in order, no insignificant whitespace. Two games with identical
 * content but different key order or formatting hash to the same versionId.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 of the canonical form, hex-encoded. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Immutable version id for a game value: first 64 bits of the SHA-256 of its
 * canonical JSON. 64 bits keeps published URLs short while making accidental
 * collisions practically impossible for this workload.
 */
export async function deriveVersionId(game: unknown): Promise<string> {
  return (await sha256Hex(canonicalJson(game))).slice(0, 16);
}
