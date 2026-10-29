/**
 * Session issuance and verification.
 *
 * The browser holds a random bearer token in an HttpOnly cookie; the registry
 * stores only `sha256(token)`. That means a leaked registry dump cannot be
 * replayed as a login, and revocation is a single flag flip.
 *
 * TTLs follow the design's role model: creators get a long session (7 days),
 * reviewer/admin sessions are short (8 hours) because they can change what the
 * public sees.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Role, SessionRecord, UserRecord } from "../registry/types";
import type { RegistryStore } from "../registry/store";

export const SESSION_COOKIE = "mos_sess";

/** Admin uses a separate cookie name so a creator session can never be upgraded in place. */
export const ADMIN_COOKIE_HINT = "mos_admin";

export const SESSION_TTL_MS: Record<Role, number> = {
  creator: 7 * 24 * 60 * 60 * 1000,
  reviewer: 8 * 60 * 60 * 1000,
  admin: 8 * 60 * 60 * 1000,
};

export interface SessionContext {
  session: SessionRecord;
  user: UserRecord;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Truncated, salted-free hash: enough to correlate a session, useless as PII. */
export function hashHeader(value: string | null | undefined): string {
  if (!value) return "none";
  return sha256Hex(value).slice(0, 16);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isTokenShaped(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

export interface IssueSessionInput {
  userId: string;
  role: Role;
  ipHash: string;
  uaHash: string;
  /** Credential generation of the user at issue time (see UserRecord). */
  credentialEpoch?: number;
  now?: Date;
}

/** Generation of a user/session record; absent fields are generation 0. */
export function credentialEpochOf(record: { credentialEpoch?: number }): number {
  return typeof record.credentialEpoch === "number" ? record.credentialEpoch : 0;
}

export async function issueSession(
  store: RegistryStore,
  input: IssueSessionInput,
): Promise<{ token: string; record: SessionRecord }> {
  const now = input.now ?? new Date();
  const token = generateSessionToken();
  const record: SessionRecord = {
    tokenHash: sha256Hex(token),
    userId: input.userId,
    role: input.role,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS[input.role]).toISOString(),
    revokedAt: null,
    credentialEpoch: input.credentialEpoch ?? 0,
    ipHash: input.ipHash,
    uaHash: input.uaHash,
  };
  await store.putSession(record);
  return { token, record };
}

/**
 * Resolve a bearer token to a live session + user.
 *
 * Every failure mode collapses to `null` on purpose: an expired, revoked,
 * unknown, suspended or role-changed session must not be distinguishable from
 * "no session" by the client.
 */
export async function verifySession(
  store: RegistryStore,
  token: string,
  now: Date = new Date(),
): Promise<SessionContext | null> {
  if (!isTokenShaped(token)) return null;
  const record = await store.getSession(sha256Hex(token));
  if (!record) return null;
  if (record.revokedAt !== null) return null;
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return null;

  const user = await store.getUser(record.userId);
  if (!user) return null;
  if (user.status !== "active") return null;
  // A role change must take effect immediately, not at next login.
  if (user.role !== record.role) return null;
  // A password change bumps the user's credential generation. Comparing it
  // here makes the password change authoritative on its own: even if the
  // post-change revocation pass failed, timed out or was cut short, a session
  // issued under the previous generation can never be used again.
  if (credentialEpochOf(user) !== credentialEpochOf(record)) return null;

  return { session: record, user };
}

/** Constant-time check used by the login path to avoid an early-exit oracle. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
