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
  clientHints,
  jsonResponse,
  readCookie,
} from "./guard";
import { hashPassword, verifyPassword } from "./password";
import { consumeRateLimit } from "./rate-limit";
import {
  hashHeader,
  issueSession,
  sha256Hex,
  verifySession,
} from "./session";
import { sessionCookie, clearedSessionCookie, sessionCookieCandidates } from "./cookie";
import { getRegistry } from "../registry/store";
import { recordAudit } from "../registry/service";
import { toPublicUser, type UserRecord } from "../registry/types";

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
