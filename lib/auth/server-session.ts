/**
 * Session helpers for server components (pages).
 *
 * Kept separate from `guard.ts` because pages read cookies through
 * `next/headers`, while route handlers take a plain `Request`. Mixing them
 * would drag the Next request context into unit tests.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRegistry } from "../registry/store";
import { ROLE_RANK, type Role } from "../registry/types";
import { sessionCookieCandidates } from "./cookie";
import { verifySession, type SessionContext } from "./session";

export async function pageSession(): Promise<SessionContext | null> {
  const jar = await cookies();
  for (const name of sessionCookieCandidates()) {
    const value = jar.get(name)?.value;
    if (!value) continue;
    const context = await verifySession(getRegistry(), decodeURIComponent(value));
    if (context) return context;
  }
  return null;
}

/** Redirects to the login page when absent, or when the role is too low. */
export async function requirePageSession(min?: Role): Promise<SessionContext> {
  const context = await pageSession();
  if (!context) redirect("/admin/login");
  if (min && ROLE_RANK[context.user.role] < ROLE_RANK[min]) {
    redirect("/admin?denied=1");
  }
  return context;
}

export function canPublish(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.admin;
}

export function canReview(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.reviewer;
}
