/**
 * Administrator recovery guards.
 *
 * The product has no password-reset endpoint (no mail channel), so the only
 * in-product recovery path is: a second administrator exists, and that
 * administrator creates/resets accounts through the audited admin API. Two
 * properties therefore have to hold, and both are tested here against a real
 * temporary registry:
 *
 *  1. an administrator can never demote or suspend themselves — that is what
 *     makes "zero administrators" unreachable through the UI/API, because the
 *     acting administrator always survives;
 *  2. an administrator CAN create another administrator, and the creation is
 *     audited — that is the recovery channel, and it must not be blocked.
 *
 * Not tested here: rotating the recovery administrator's own password, which
 * goes through POST /api/auth/password (see tests/auth/password-change.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as usersGet, POST as usersPost } from "@/app/api/admin/users/route";
import { PATCH as userPatch } from "@/app/api/admin/users/[userId]/route";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { resetBootstrapForTests } from "@/lib/auth/bootstrap";
import { getRegistry } from "@/lib/registry/store";
import {
  createUser,
  jsonRequest,
  sessionCookieFor,
  setupRegistryEnv,
  type TestEnv,
} from "../helpers/registry";

let env: TestEnv;

beforeEach(async () => {
  env = await setupRegistryEnv();
  resetRateLimits();
  resetBootstrapForTests();
});

afterEach(async () => {
  await env.cleanup();
});

const BASE = "https://host.test/api/admin/users";

describe("administrator self-lockout guards", () => {
  it("refuses to let an administrator change their own role or status", async () => {
    const admin = await createUser({ email: "admin1@test.dev", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    const demote = await userPatch(
      jsonRequest(`${BASE}/${admin.id}`, { method: "PATCH", cookie, body: { role: "creator" } }),
      { params: Promise.resolve({ userId: admin.id }) },
    );
    expect(demote.status).toBe(400);
    expect(((await demote.json()) as { error?: string }).error).toBe("cannot_modify_self");

    const suspend = await userPatch(
      jsonRequest(`${BASE}/${admin.id}`, { method: "PATCH", cookie, body: { status: "suspended" } }),
      { params: Promise.resolve({ userId: admin.id }) },
    );
    expect(suspend.status).toBe(400);

    // The account is untouched and still usable.
    const stored = await getRegistry().getUser(admin.id);
    expect(stored?.role).toBe("admin");
    expect(stored?.status).toBe("active");
  });

  it("keeps at least one administrator: the acting admin survives demoting another admin", async () => {
    const acting = await createUser({ email: "admin2@test.dev", role: "admin" });
    const other = await createUser({ email: "admin3@test.dev", role: "admin" });
    const cookie = await sessionCookieFor(acting);

    const response = await userPatch(
      jsonRequest(`${BASE}/${other.id}`, { method: "PATCH", cookie, body: { role: "creator" } }),
      { params: Promise.resolve({ userId: other.id }) },
    );
    expect(response.status).toBe(200);

    const admins = (await getRegistry().listUsers()).filter(
      (user) => user.role === "admin" && user.status === "active",
    );
    expect(admins.map((user) => user.id)).toEqual([acting.id]);
  });

  it("does not allow a non-administrator to reach any user-management endpoint", async () => {
    const creator = await createUser({ email: "creator1@test.dev", role: "creator" });
    const cookie = await sessionCookieFor(creator);

    expect((await usersGet(jsonRequest(BASE, { method: "GET", cookie }))).status).toBe(403);
    expect(
      (
        await usersPost(
          jsonRequest(BASE, {
            cookie,
            body: { email: "x@test.dev", password: "a-long-enough-password", role: "admin" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await userPatch(
          jsonRequest(`${BASE}/${creator.id}`, {
            method: "PATCH",
            cookie,
            body: { role: "admin" },
          }),
          { params: Promise.resolve({ userId: creator.id }) },
        )
      ).status,
    ).toBe(403);
  });
});

describe("administrator recovery channel", () => {
  it("lets an administrator create a second administrator, audited", async () => {
    const admin = await createUser({ email: "admin4@test.dev", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    const response = await usersPost(
      jsonRequest(BASE, {
        cookie,
        body: {
          email: "recovery-admin@test.dev",
          password: "recovery-passphrase-2026",
          displayName: "备用管理员",
          role: "admin",
        },
      }),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { user: { id: string; role: string } };
    expect(created.user.role).toBe("admin");

    const audit = await getRegistry().listAudit(50);
    const record = audit.find(
      (entry) => entry.action === "user.create" && entry.targetId === created.user.id,
    );
    expect(record).toBeDefined();
    expect(record!.actorUserId).toBe(admin.id);
    expect(JSON.stringify(record!.after)).toContain("recovery-admin@test.dev");
    // The audit trail must never carry the password.
    expect(JSON.stringify(audit)).not.toContain("recovery-passphrase-2026");
  });

  it("rejects a recovery account whose password is below policy", async () => {
    const admin = await createUser({ email: "admin5@test.dev", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    const response = await usersPost(
      jsonRequest(BASE, {
        cookie,
        body: { email: "weak-recovery@test.dev", password: "short1!", role: "admin" },
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error?: string }).error).toBe("weak_password");
  });

  it("rejects a duplicate recovery email instead of silently resetting the password", async () => {
    const admin = await createUser({ email: "admin6@test.dev", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    const response = await usersPost(
      jsonRequest(BASE, {
        cookie,
        body: { email: "admin6@test.dev", password: "another-long-password", role: "admin" },
      }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error?: string }).error).toBe("email_taken");
  });
});
