/**
 * Authentication tests: password hashing, session lifecycle, lockout, CSRF.
 *
 * Everything runs against a real temporary registry. Nothing here mocks the
 * store, because "the session is actually persisted and actually revoked" is
 * the property under test.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { resetBootstrapForTests } from "@/lib/auth/bootstrap";
import { getRegistry } from "@/lib/registry/store";
import {
  createUser,
  rawRequest,
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

const login = (email: string, password: string) =>
  loginRoute(
    rawRequest("https://host.test/api/auth/login", {
      body: JSON.stringify({ email, password }),
    }),
  );

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const fields = await hashPassword(TEST_PASSWORD);
    expect(await verifyPassword(TEST_PASSWORD, fields.passwordHash, fields.passwordSalt)).toBe(true);
    expect(await verifyPassword("wrong-password-123", fields.passwordHash, fields.passwordSalt)).toBe(
      false,
    );
  });

  it("produces a different hash for the same password (per-user salt)", async () => {
    const a = await hashPassword(TEST_PASSWORD);
    const b = await hashPassword(TEST_PASSWORD);
    expect(a.passwordHash).not.toBe(b.passwordHash);
    expect(a.passwordSalt).not.toBe(b.passwordSalt);
  });

  it("treats a malformed record as a failed verification instead of throwing", async () => {
    expect(await verifyPassword(TEST_PASSWORD, "zz", "zz")).toBe(false);
  });
});

describe("login", () => {
  it("issues an HttpOnly, SameSite=Lax session cookie", async () => {
    await createUser({ email: "creator@example.com" });
    const response = await login("creator@example.com", TEST_PASSWORD);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("mos_sess=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("returns the same message for an unknown email and a wrong password", async () => {
    await createUser({ email: "creator@example.com" });
    const wrongPassword = await login("creator@example.com", "not-the-password");
    const unknownEmail = await login("nobody@example.com", "not-the-password");
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const a = (await wrongPassword.json()) as { message: string };
    const b = (await unknownEmail.json()) as { message: string };
    expect(a.message).toBe(b.message);
  });

  it("locks the account after five consecutive failures", async () => {
    const user = await createUser({ email: "creator@example.com" });
    for (let i = 0; i < 5; i += 1) {
      const response = await login("creator@example.com", "wrong-password");
      expect(response.status).toBe(401);
    }
    const stored = await getRegistry().getUser(user.id);
    expect(stored?.failedLoginCount).toBe(5);
    expect(stored?.lockedUntil).not.toBeNull();

    // Even the correct password is refused while the lock holds.
    const locked = await login("creator@example.com", TEST_PASSWORD);
    expect(locked.status).toBe(423);
  });

  it("resets the failure counter on success", async () => {
    const user = await createUser({ email: "creator@example.com" });
    await login("creator@example.com", "wrong-password");
    const ok = await login("creator@example.com", TEST_PASSWORD);
    expect(ok.status).toBe(200);
    const stored = await getRegistry().getUser(user.id);
    expect(stored?.failedLoginCount).toBe(0);
  });

  it("refuses a suspended account", async () => {
    const user = await createUser({ email: "creator@example.com" });
    await getRegistry().putUser({ ...user, status: "suspended" });
    const response = await login("creator@example.com", TEST_PASSWORD);
    expect(response.status).toBe(403);
  });

  it("rejects a non-JSON body and a missing field", async () => {
    const wrongType = await loginRoute(
      rawRequest("https://host.test/api/auth/login", {
        body: "email=a",
        contentType: "text/plain",
      }),
    );
    expect(wrongType.status).toBe(415);
    const missing = await loginRoute(
      rawRequest("https://host.test/api/auth/login", { body: JSON.stringify({ email: "a@b.co" }) }),
    );
    expect(missing.status).toBe(400);
  });

  it("rate limits repeated attempts from one address", async () => {
    await createUser({ email: "creator@example.com" });
    let sawLimit = false;
    for (let i = 0; i < 30; i += 1) {
      const response = await loginRoute(
        rawRequest("https://host.test/api/auth/login", {
          body: JSON.stringify({ email: "creator@example.com", password: "wrong-password" }),
        }),
      );
      if (response.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});

describe("session lifecycle", () => {
  async function loggedInCookie(email: string): Promise<string> {
    const response = await login(email, TEST_PASSWORD);
    const raw = response.headers.get("set-cookie") ?? "";
    return raw.split(";")[0];
  }

  it("resolves the current user from the cookie", async () => {
    await createUser({ email: "creator@example.com", displayName: "作者甲" });
    const cookie = await loggedInCookie("creator@example.com");
    const me = await meRoute(
      new Request("https://host.test/api/auth/me", { headers: { cookie } }),
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { displayName: string; role: string } };
    expect(body.user.displayName).toBe("作者甲");
    expect(body.user.role).toBe("creator");
  });

  it("invalidates the session on logout", async () => {
    await createUser({ email: "creator@example.com" });
    const cookie = await loggedInCookie("creator@example.com");

    const out = await logoutRoute(
      new Request("https://host.test/api/auth/logout", {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect(out.status).toBe(200);

    const me = await meRoute(
      new Request("https://host.test/api/auth/me", { headers: { cookie } }),
    );
    expect(me.status).toBe(401);
  });

  it("invalidates the session when the role changes", async () => {
    const user = await createUser({ email: "creator@example.com", role: "creator" });
    const cookie = await loggedInCookie("creator@example.com");

    // Demotion must not wait for the next login: the stored role is compared
    // with the session's role on every request.
    await getRegistry().putUser({ ...user, role: "reviewer" });
    const me = await meRoute(
      new Request("https://host.test/api/auth/me", { headers: { cookie } }),
    );
    expect(me.status).toBe(401);
  });

  it("rejects a forged token", async () => {
    const me = await meRoute(
      new Request("https://host.test/api/auth/me", {
        headers: { cookie: "mos_sess=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      }),
    );
    expect(me.status).toBe(401);
  });
});

describe("bootstrap administrator", () => {
  it("creates one admin from env, then refuses to create a second", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = "boss@example.com";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "a-very-long-password";
    try {
      const { ensureBootstrapAdmin } = await import("@/lib/auth/bootstrap");
      const first = await ensureBootstrapAdmin();
      expect(first.created).toBe(true);

      const again = await ensureBootstrapAdmin();
      expect(again.created).toBe(false);
      expect(again.reason).toBe("admin_exists");

      const admins = (await getRegistry().listUsers()).filter((u) => u.role === "admin");
      expect(admins).toHaveLength(1);
    } finally {
      delete process.env.BOOTSTRAP_ADMIN_EMAIL;
      delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    }
  });

  it("does nothing without the env pair", async () => {
    const { ensureBootstrapAdmin } = await import("@/lib/auth/bootstrap");
    const result = await ensureBootstrapAdmin();
    expect(result.created).toBe(false);
    expect(result.reason).toBe("no_env");
  });
});
