import {
  HttpError,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/guard";
import { getRegistry } from "@/lib/registry/store";
import { recordAudit } from "@/lib/registry/service";
import { isRole, toPublicUser, type UserRecord } from "@/lib/registry/types";

/**
 * PATCH /api/admin/users/<id>  { role?, status? }
 *
 * Two guard rails worth stating:
 *  - an admin cannot change their own role or status (the only administrator
 *    locking themselves out is unrecoverable without filesystem access);
 *  - a role change invalidates the target's existing sessions, because
 *    `verifySession` compares the session's role with the user's current role.
 *    That is intentional: demoting someone must take effect immediately.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const auth = await requireRole(request, "admin");
    assertSafeMutation(request);
    const hints = clientHints(request);
    const { userId } = await params;

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
    const payload = (body ?? {}) as { role?: unknown; status?: unknown };

    if (userId === auth.user.id) {
      throw new HttpError(400, "cannot_modify_self", "不能修改自己的角色或状态。");
    }

    const registry = getRegistry();
    const target = await registry.getUser(userId);
    if (!target) {
      throw new HttpError(404, "user_not_found", "用户不存在。");
    }

    const next: UserRecord = { ...target };
    const before = { role: target.role, status: target.status };

    if (payload.role !== undefined) {
      if (!isRole(payload.role)) {
        throw new HttpError(400, "invalid_role", "角色必须是 creator / reviewer / admin。");
      }
      next.role = payload.role;
    }
    if (payload.status !== undefined) {
      if (payload.status !== "active" && payload.status !== "suspended") {
        throw new HttpError(400, "invalid_status", "状态必须是 active / suspended。");
      }
      next.status = payload.status;
    }
    if (next.role === target.role && next.status === target.status) {
      return jsonResponse(200, { user: toPublicUser(target), unchanged: true });
    }

    // Suspending or demoting must not leave a usable session behind.
    if (next.status !== target.status || next.role !== target.role) {
      next.failedLoginCount = 0;
      next.lockedUntil = null;
    }

    await registry.putUser(next);
    await recordAudit(registry, {
      actor: { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash },
      action: next.role !== target.role ? "user.role_change" : "user.status_change",
      targetType: "user",
      targetId: userId,
      before,
      after: { role: next.role, status: next.status },
    });

    return jsonResponse(200, { user: toPublicUser(next) });
  } catch (error) {
    return toErrorResponse(error, "admin-user-detail");
  }
}
