/**
 * Cookie construction for sessions.
 *
 * `__Host-` prefix is used in production so the cookie cannot be shadowed by a
 * subdomain; it requires Secure + Path=/ + no Domain, which is exactly what we
 * want. In development the plain name is used because `next dev` runs on
 * http://localhost, where a Secure cookie would never be sent back.
 */

import { SESSION_COOKIE, SESSION_TTL_MS } from "./session";
import type { Role } from "../registry/types";

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

export function sessionCookie(token: string, role: Role): string {
  const maxAge = Math.floor(SESSION_TTL_MS[role] / 1000);
  const parts = [
    `${sessionCookieName()}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(): string {
  const parts = [
    `${sessionCookieName()}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/**
 * The cookie NAME changes between environments, so request-side lookup must
 * accept both. `readCookie` in guard.ts takes an explicit name; this helper
 * resolves the ordered candidates.
 */
export function sessionCookieCandidates(): string[] {
  return [`__Host-${SESSION_COOKIE}`, SESSION_COOKIE];
}
