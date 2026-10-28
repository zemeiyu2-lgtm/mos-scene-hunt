import {
  HttpError,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/guard";
import { hashPassword, isPasswordAcceptable } from "@/lib/auth/password";
import { getRegistry } from "@/lib/registry/store";
import { recordAudit } from "@/lib/registry/service";
import { isRole, toPublicUser, type Role, type UserRecord } from "@/lib/registry/types";
import { randomUUID } from "node:crypto";

/**
 * User administration (admin only).
 *
 * GET  /api/admin/users   -> list
 * POST /api/admin/users   -> create { email, password, displayName, role }
 *
 * Registration is invite-only by design: there is no public sign-up endpoint,
 * so a fabricated account cannot enter the review pipeline. That is the
 * "邀请制先行" path from the design and it is the smallest thing that can be
 * both safe and usable today.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request): Promise<Response> {
  try {
    await requireRole(request, "admin");
    const users = await getRegistry().listUsers();
    return jsonResponse(200, { users: users.map(toPublicUser) });
  } catch (error) {
    return toErrorResponse(error, "admin-users");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireRole(request, "admin");
    assertSafeMutation(request);
    const hints = clientHints(request);

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
    const payload = (body ?? {}) as Record<string, unknown>;

    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const displayName =
      typeof payload.displayName === "string" && payload.displayName.trim()
        ? payload.displayName.trim().slice(0, 80)
        : email.split("@")[0];
    const role: Role = isRole(payload.role) ? payload.role : "creator";

    if (!EMAIL_PATTERN.test(email) || email.length > 320) {
      throw new HttpError(400, "invalid_email", "邮箱格式不正确。");
    }
    const acceptable = isPasswordAcceptable(password);
    if (!acceptable.ok) {
      throw new HttpError(400, "weak_password", acceptable.reason ?? "密码不符合要求。");
    }

    const registry = getRegistry();
    const existing = await registry.getUserByEmail(email);
    if (existing) {
      throw new HttpError(409, "email_taken", "该邮箱已注册。");
    }

    const passwordFields = await hashPassword(password);
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: passwordFields.passwordHash,
      passwordSalt: passwordFields.passwordSalt,
      displayName,
      role,
      status: "active",
      createdAt: now,
      lastLoginAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    };
    await registry.putUser(user);
    await recordAudit(registry, {
      actor: { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash },
      action: "user.create",
      targetType: "user",
      targetId: user.id,
      after: { email, role },
    });

    return jsonResponse(201, { user: toPublicUser(user) });
  } catch (error) {
    return toErrorResponse(error, "admin-users");
  }
}
