/**
 * Auth request handlers, kept out of `route.ts` so tests can call them with a
 * plain `Request` without booting Next's router.
 *
 * Threat notes:
 *  - Unknown email still runs one scrypt verification against a dummy hash, so
 *    timing does not disclose account existence.
 *  - Failures increment a counter persisted on the user record: the in-process
 *    rate limiter is a burst guard, the persisted counter is the lockout.
 *  - Every branch returns the same message for bad email and bad password.
 */

import {
  HttpError,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  readCookie,
  requireUser,
} from "./guard";
import { hashPassword, isPasswordAcceptable, verifyPassword } from "./password";
import { consumeRateLimit } from "./rate-limit";
import {
  credentialEpochOf,
  hashHeader,
  issueSession,
  sha256Hex,
  verifySession,
} from "./session";
import { sessionCookie, clearedSessionCookie, sessionCookieCandidates } from "./cookie";
import { getRegistry } from "../registry/store";
import { recordAudit } from "../registry/service";
import { toPublicUser, type SessionRecord, type UserRecord } from "../registry/types";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_IP = 20;
const LOGIN_MAX_PER_ACCOUNT = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

let dummyHash: { passwordHash: string; passwordSalt: string } | null = null;

/** Pre-computed so the "unknown email" path costs the same as a real check. */
async function getDummyHash(): Promise<{ passwordHash: string; passwordSalt: string }> {
  if (!dummyHash) dummyHash = await hashPassword("dummy-password-for-timing-only");
  return dummyHash;
}

function sessionTokenFrom(request: Request): string | null {
  for (const name of sessionCookieCandidates()) {
    const value = readCookie(request, name);
    if (value) return value;
  }
  return null;
}

export async function loginHandler(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "请以 application/json 提交。");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "invalid_json", "请求体不是合法 JSON。");
  }
  const payload = (body ?? {}) as { email?: unknown; password?: unknown };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email || !password) {
    throw new HttpError(400, "missing_credentials", "请填写邮箱与密码。");
  }
  if (email.length > 320 || password.length > 256) {
    throw new HttpError(400, "invalid_credentials", "邮箱或密码格式不正确。");
  }

  const hints = clientHints(request);
  const ipLimit = consumeRateLimit({
    key: `login-ip:${hints.ipHash}`,
    limit: LOGIN_MAX_PER_IP,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!ipLimit.allowed) {
    return jsonResponse(
      429,
      { error: "rate_limited", message: "尝试过于频繁，请稍后再试。" },
      { "Retry-After": String(ipLimit.retryAfterSeconds) },
    );
  }

  const registry = getRegistry();
  const user = await registry.getUserByEmail(email);
  const now = new Date();

  if (!user) {
    const dummy = await getDummyHash();
    await verifyPassword(password, dummy.passwordHash, dummy.passwordSalt);
    await recordAudit(registry, {
      actor: null,
      action: "auth.login_failed",
      targetType: "user",
      targetId: "unknown",
      after: { emailHash: hashHeader(email), reason: "no_such_user" },
    });
    throw new HttpError(401, "invalid_credentials", "邮箱或密码不正确。");
  }

  if (user.status !== "active") {
    throw new HttpError(403, "account_suspended", "该账号已被停用，请联系管理员。");
  }
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > now.getTime()) {
    throw new HttpError(423, "account_locked", "登录失败次数过多，账号已被临时锁定，请稍后再试。");
  }

  const accountLimit = consumeRateLimit({
    key: `login-user:${user.id}`,
    limit: LOGIN_MAX_PER_ACCOUNT,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!accountLimit.allowed) {
    throw new HttpError(429, "rate_limited", "该账号尝试过于频繁，请稍后再试。");
  }

  const ok = await verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const updated: UserRecord = {
      ...user,
      failedLoginCount: failed,
      lockedUntil:
        failed >= LOGIN_MAX_PER_ACCOUNT
          ? new Date(now.getTime() + ACCOUNT_LOCK_MS).toISOString()
          : user.lockedUntil,
    };
    await registry.putUser(updated);
    await recordAudit(registry, {
      actor: null,
      action: "auth.login_failed",
      targetType: "user",
      targetId: user.id,
      after: { failedCount: failed, locked: updated.lockedUntil !== null },
    });
    throw new HttpError(401, "invalid_credentials", "邮箱或密码不正确。");
  }

  const refreshed: UserRecord = {
    ...user,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: now.toISOString(),
  };
  await registry.putUser(refreshed);

  const { token } = await issueSession(registry, {
    userId: refreshed.id,
    role: refreshed.role,
    credentialEpoch: credentialEpochOf(refreshed),
    ipHash: hints.ipHash,
    uaHash: hints.uaHash,
    now,
  });
  await recordAudit(registry, {
    actor: { user: refreshed, ipHash: hints.ipHash, uaHash: hints.uaHash },
    action: "auth.login",
    targetType: "user",
    targetId: refreshed.id,
    after: { role: refreshed.role },
  });

  return jsonResponse(
    200,
    { user: toPublicUser(refreshed) },
    { "Set-Cookie": sessionCookie(token, refreshed.role) },
  );
}

export async function logoutHandler(request: Request): Promise<Response> {
  const registry = getRegistry();
  const hints = clientHints(request);
  const token = sessionTokenFrom(request);

  if (token) {
    const context = await verifySession(registry, token);
    await registry.revokeSession(sha256Hex(token), new Date().toISOString());
    if (context) {
      await recordAudit(registry, {
        actor: { user: context.user, ipHash: hints.ipHash, uaHash: hints.uaHash },
        action: "auth.logout",
        targetType: "user",
        targetId: context.user.id,
      });
    }
  }
  return jsonResponse(200, { ok: true }, { "Set-Cookie": clearedSessionCookie() });
}

export async function meHandler(request: Request): Promise<Response> {
  const registry = getRegistry();
  const token = sessionTokenFrom(request);
  if (!token) {
    return jsonResponse(401, { error: "unauthenticated", message: "未登录。" });
  }
  const context = await verifySession(registry, token);
  if (!context) {
    return jsonResponse(401, { error: "unauthenticated", message: "会话已失效，请重新登录。" });
  }
  return jsonResponse(200, {
    user: toPublicUser(context.user),
    expiresAt: context.session.expiresAt,
  });
}

/**
 * POST /api/auth/password  { currentPassword, newPassword }
 *
 * Self-service password change for any signed-in user. Policy:
 *  - the caller must present a live session AND the current password, so a
 *    hijacked tab cannot silently rotate the credential without knowing it;
 *  - the new password passes the same server-side policy as account creation;
 *  - EVERY session of this user is revoked, including the one that performed
 *    the change — the browser gets a cleared cookie and must log in again.
 *    "Other devices stay logged in" would be the weaker choice;
 *  - the audit record carries no secret material, only the session count.
 */
export async function changePasswordHandler(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  assertSafeMutation(request);

  const hints = clientHints(request);
  const limit = consumeRateLimit({
    key: `password-change:${auth.user.id}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) {
    return jsonResponse(
      429,
      { error: "rate_limited", message: "操作过于频繁，请稍后再试。" },
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "invalid_json", "请求体不是合法 JSON。");
  }
  const payload = (body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
  if (!currentPassword || !newPassword) {
    throw new HttpError(400, "missing_fields", "请填写当前密码与新密码。");
  }
  if (currentPassword.length > 256 || newPassword.length > 256) {
    throw new HttpError(400, "invalid_password", "密码过长。");
  }

  const registry = getRegistry();
  // Re-read from the store: the session context may predate a concurrent
  // change (e.g. an admin demotion), and verifySession's role/status check
  // already gated requireUser — this re-read only refreshes credential fields.
  const user = await registry.getUser(auth.user.id);
  if (!user || user.status !== "active") {
    throw new HttpError(401, "unauthenticated", "会话已失效，请重新登录。");
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt);
  if (!currentOk) {
    await recordAudit(registry, {
      actor: { user, ipHash: hints.ipHash, uaHash: hints.uaHash },
      action: "auth.password_change_failed",
      targetType: "user",
      targetId: user.id,
      after: { reason: "wrong_current_password" },
    });
    throw new HttpError(400, "wrong_current_password", "当前密码不正确。");
  }

  const acceptable = isPasswordAcceptable(newPassword);
  if (!acceptable.ok) {
    throw new HttpError(400, "weak_password", acceptable.reason ?? "密码不符合要求。");
  }

  const fields = await hashPassword(newPassword);

  // Everything that can fail without changing anything happens BEFORE the
  // credential is committed. The session list is the expensive part on Blob
  // (list + one read per record), so reading it first means a slow or failing
  // store aborts the request with the password untouched — instead of leaving
  // a rotated credential next to a set of sessions nobody has enumerated.
  let sessions: SessionRecord[];
  try {
    sessions = await registry.listSessionsByUser(user.id);
  } catch (error) {
    console.error("[auth] 改密前会话清单读取失败（密码未修改）", error);
    return jsonResponse(503, {
      error: "session_lookup_failed",
      passwordChanged: false,
      retryable: true,
      message: "无法读取会话清单，密码未修改。请稍后重试。",
    });
  }

  // Commit point. From here the password IS changed; every response below
  // says so, and none of them may claim the change failed.
  const nextEpoch = credentialEpochOf(user) + 1;
  try {
    await registry.putUser({
      ...user,
      passwordHash: fields.passwordHash,
      passwordSalt: fields.passwordSalt,
      credentialEpoch: nextEpoch,
    });
  } catch (error) {
    console.error("[auth] 改密写入失败（密码未修改）", error);
    return jsonResponse(503, {
      error: "password_write_failed",
      passwordChanged: false,
      retryable: true,
      message: "密码写入失败，密码未修改。请稍后重试。",
    });
  }

  // Past the commit point the credential generation has already advanced, so
  // every session issued before this request is dead by construction
  // (verifySession compares epochs). The pass below is cleanup: failed or
  // partial revocation leaves stale records behind, never a usable session.
  const revokedAt = new Date().toISOString();
  let revoked = 0;
  let revokeFailed = 0;
  for (const session of sessions) {
    if (session.revokedAt !== null) continue;
    try {
      await registry.revokeSession(session.tokenHash, revokedAt);
      revoked += 1;
    } catch (error) {
      revokeFailed += 1;
      console.error("[auth] 会话撤销失败（凭证世代已推进，该会话仍不可用）", error);
    }
  }

  const auditRecorded = await recordAudit(registry, {
    actor: { user, ipHash: hints.ipHash, uaHash: hints.uaHash },
    action: "auth.password_change",
    targetType: "user",
    targetId: user.id,
    after: {
      sessionsRevoked: revoked,
      sessionsFailed: revokeFailed,
      credentialEpoch: nextEpoch,
    },
  });

  const complete = revokeFailed === 0 && auditRecorded;
  return jsonResponse(
    200,
    {
      ok: true,
      passwordChanged: true,
      relogin: true,
      sessionsRevoked: revoked,
      sessionsFailed: revokeFailed,
      auditRecorded,
      status: complete ? "complete" : "partial",
      message: complete
        ? "密码已修改，请使用新密码重新登录。"
        : "密码已修改，旧会话已全部失效。但会话清理或审计留痕未完全成功，已记录异常供运维核查。请直接用新密码重新登录，不要再用旧密码重复提交。",
    },
    { "Set-Cookie": clearedSessionCookie() },
  );
}
