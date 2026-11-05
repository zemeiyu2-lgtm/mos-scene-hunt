/**
 * Validated in-app return targets.
 *
 * `?from=` is a RETURN LANDING SPOT, never a redirect primitive. A link that
 * accepts arbitrary input here is an open redirect: the player taps 返回 inside
 * our own UI and ends up on someone else's site (or a `javascript:` URL).
 *
 * Strategy — allow-list, not block-list:
 *
 *   - Only these shapes exist today: `/cities`, `/cities/<valid cityId>`,
 *     `/explore` and `/explore/<valid pack id>`.
 *   - These targets are ASCII-only by construction, so **percent-encoding is
 *     never legitimate** and any `%` is rejected outright. That removes the
 *     whole encoding-bypass family (`%2f`, `%5c`, `%252f`, `%2e%2e`, …) in one
 *     rule instead of chasing variants.
 *   - Paths are split into segments and rebuilt from validated parts, so the
 *     value handed to the router is canonical rather than "whatever came in".
 *   - Anything else returns null; callers then use {@link resolveReturnTarget}
 *     or the browser history.
 *
 * The city id is NOT trusted just because it parses: the detail page always
 * calls the city API, which enforces existence and public visibility on the
 * server. This module only guarantees "stays inside the app".
 */

import { isValidCityId } from "@/lib/cities/types";
import { isValidGameId } from "@/lib/publish/version";

/** Safe landing spot when `from` is present but unusable. */
export const DEFAULT_RETURN_PATH = "/cities";

const MAX_LENGTH = 512;
/* eslint-disable-next-line no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Returns a canonical internal path, or null when the input is not one of the
 * accepted shapes. Never throws — a malformed escape sequence must not be able
 * to break the page that renders the back button.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (!raw || raw.length > MAX_LENGTH) return null;
  // Untrimmed values (leading/trailing whitespace, newlines) are rejected
  // rather than trimmed: browsers strip some control characters when parsing
  // URLs, and "trim then trust" is how `\n//evil.example` style bypasses work.
  if (raw !== raw.trim()) return null;
  if (CONTROL_CHARS.test(raw)) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (raw.includes("%")) return null;
  if (raw.includes(":") || raw.includes("?") || raw.includes("#")) return null;

  const segments = raw.split("/");
  segments.shift(); // leading "" before the first slash
  if (segments.length === 0) return null;
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;

  if (segments.length === 1 && segments[0] === "cities") return "/cities";
  if (segments.length === 2 && segments[0] === "cities") {
    return isValidCityId(segments[1]) ? `/cities/${segments[1]}` : null;
  }
  /*
   * Exploration pages (2026-11-05). A player who starts a pack from its detail
   * page must be able to come back to that page, not to the city directory.
   * Only the two canonical shapes are accepted: the index and one pack id.
   * Category pages are deliberately absent — nothing links to them from
   * `/select`, and a shorter list is a smaller attack surface.
   */
  if (segments.length === 1 && segments[0] === "explore") return "/explore";
  if (segments.length === 2 && segments[0] === "explore") {
    return isValidGameId(segments[1]) ? `/explore/${segments[1]}` : null;
  }
  return null;
}

/**
 * What the back button should actually do:
 *
 *   - valid target            → that path;
 *   - present but unusable    → {@link DEFAULT_RETURN_PATH} (safe, still in-app);
 *   - absent                  → null, meaning "use browser history".
 *
 * The null case deserves a precise statement, because it is easy to over-claim:
 * `router.back()` **follows the browser's own history stack**. It usually lands
 * on the previous in-app screen, but it does NOT guarantee an in-app
 * destination — a player who opened the link directly, or arrived from another
 * site, goes back to that site. That is why "no `from`" is never treated as a
 * validated target, and why a caller must not pass anything it has not
 * resolved through this function to a navigation call.
 */
export function resolveReturnTarget(raw: string | null | undefined): string | null {
  const safe = safeReturnPath(raw);
  if (safe) return safe;
  return typeof raw === "string" && raw.length > 0 ? DEFAULT_RETURN_PATH : null;
}
