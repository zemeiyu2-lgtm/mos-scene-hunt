/**
 * Self-service password change: identity check, server-side policy, session
 * revocation and audit. Runs against a real temporary registry — "the old
 * session is actually dead and the new password actually logs in" is the
 * property under test, so nothing is mocked.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as changePasswordRoute } from "@/app/api/auth/password/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { resetBootstrapForTests } from "@/lib/auth/bootstrap";
import { getRegistry } from "@/lib/registry/store";
import {
  createUser,
  jsonRequest,
  rawRequest,
  sessionCookieFor,
  setupRegistryEnv,
  TEST_PASSWORD,
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

const NEW_PASSWORD = "brand-new-passphrase-42";

const call = (cookie: string, body: unknown) =>
  changePasswordRoute(jsonRequest("https://host.test/api/auth/password", { cookie, body }));

const login = (email: string, password: string) =>
  loginRoute(
    rawRequest("https://host.test/api/auth/login", {
      body: JSON.stringify({ email, password }),
    }),
  );

const me = (cookie: string) =>
  meRoute(rawRequest("https://host.test/api/auth/me", { method: "GET", cookie }));

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await login(email, password);
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /(?:__Host-)?mos_sess=[^;]+/.exec(setCookie);
  expect(match).not.toBeNull();
  return match![0];
}

describe("POST /api/auth/password", () => {
  it("rejects an unauthenticated caller", async () => {
    const user = await createUser({ email: "u1@test.dev" });
    const cookie = await sessionCookieFor(user);
    const response = await call("", { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(401);
    // A valid cookie is still required even when a body is present.
    expect((await me(cookie)).status).toBe(200);
  });

  it("rejects missing fields", async () => {
    const user = await createUser({ email: "u2@test.dev" });
    const cookie = await sessionCookieFor(user);
    expect((await call(cookie, {})).status).toBe(400);
    expect((await call(cookie, { currentPassword: TEST_PASSWORD })).status).toBe(400);
    expect((await call(cookie, { newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  it("rejects a wrong current password without touching sessions or credentials", async () => {
    const user = await createUser({ email: "u3@test.dev" });
    const cookie = await sessionCookieFor(user);
    const response = await call(cookie, {
      currentPassword: "totally-wrong-password",
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toBe("wrong_current_password");
    // Session survives and the old password still logs in.
    expect((await me(cookie)).status).toBe(200);
    expect((await login("u3@test.dev", TEST_PASSWORD)).status).toBe(200);
  });

  it("enforces the server-side password policy", async () => {
    const user = await createUser({ email: "u4@test.dev" });
    const cookie = await sessionCookieFor(user);
    const response = await call(cookie, {
      currentPassword: TEST_PASSWORD,
      newPassword: "short1!", // 7 chars — below MIN_PASSWORD_LENGTH=12
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toBe("weak_password");
    // Old credential unchanged.
    expect((await login("u4@test.dev", TEST_PASSWORD)).status).toBe(200);
  });

  it("changes the password, kills every session (including the caller's) and writes an audit record", async () => {
    const user = await createUser({ email: "u5@test.dev" });
    const cookieA = await sessionCookieFor(user);
    const cookieB = await sessionCookieFor(user); // a second device

    const response = await call(cookieA, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { relogin?: boolean; sessionsRevoked?: number };
    expect(payload.relogin).toBe(true);
    expect(payload.sessionsRevoked).toBe(2);

    // Both old sessions are dead — including the one that made the change.
    expect((await me(cookieA)).status).toBe(401);
    expect((await me(cookieB)).status).toBe(401);

    // The response cleared the cookie, but prove the server side too: the
    // old password no longer logs in, the new one does.
    expect((await login("u5@test.dev", TEST_PASSWORD)).status).toBe(401);
    expect((await login("u5@test.dev", NEW_PASSWORD)).status).toBe(200);

    const audit = await getRegistry().listAudit(50);
    const change = audit.find(
      (record) => record.action === "auth.password_change" && record.targetId === user.id,
    );
    expect(change).toBeDefined();
    expect(JSON.stringify(change!.after)).toContain("sessionsRevoked");
    // No secret material in the audit trail.
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(audit)).not.toContain(TEST_PASSWORD);
  });

  it("makes a replayed request fail (the current password has moved on)", async () => {
    const user = await createUser({ email: "u6@test.dev" });
    const cookie = await sessionCookieFor(user);
    const body = { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD };
    expect((await call(cookie, body)).status).toBe(200);
    // Replay with the same (now stale) cookie and credentials.
    expect((await call(cookie, body)).status).toBe(401); // session already revoked
    // Even with a fresh session, the old current password is rejected.
    const freshCookie = await loginCookie("u6@test.dev", NEW_PASSWORD);
    expect((await call(freshCookie, body)).status).toBe(400);
  });

  it("rejects non-JSON bodies (CSRF defence shared with other mutations)", async () => {
    const user = await createUser({ email: "u7@test.dev" });
    const cookie = await sessionCookieFor(user);
    const response = await changePasswordRoute(
      rawRequest("https://host.test/api/auth/password", {
        body: "currentPassword=x",
        contentType: "text/plain",
        cookie,
      }),
    );
    expect(response.status).toBe(415);
  });

  it("rate-limits after repeated attempts", async () => {
    const user = await createUser({ email: "u8@test.dev" });
    const cookie = await sessionCookieFor(user);
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      last = (
        await call(cookie, { currentPassword: "wrong-password-xyz", newPassword: NEW_PASSWORD })
      ).status;
    }
    expect(last).toBe(429);
  });
});
