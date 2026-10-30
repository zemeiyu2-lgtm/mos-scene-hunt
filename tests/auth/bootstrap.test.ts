/**
 * 首次引导管理员（bootstrap）的真实行为。
 *
 * 之所以单独成文件：`lib/auth/bootstrap.ts` 是模块级单例（settled/inFlight），
 * 一个进程内只能验证一条时间线，必须用 resetBootstrapForTests() 隔离。
 *
 * 这里的重点是此前报告里被搞错过的那件事——**引导由 GET /admin/login 的页面渲染触发**，
 * 不是由 POST /api/auth/login 触发。文件末尾两条静态断言把这条调用路径钉住，
 * 免得以后有人「顺手」挪到登录 POST 里而无人发现。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBootstrapAdmin, resetBootstrapForTests } from "@/lib/auth/bootstrap";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { getRegistry } from "@/lib/registry/store";
import { createUser, jsonRequest, setupRegistryEnv, type TestEnv } from "../helpers/registry";

const EMAIL = "bootstrap-admin@example.com";
const PASSWORD = "bootstrap-password-2026";

let env: TestEnv;

beforeEach(async () => {
  env = await setupRegistryEnv();
  resetBootstrapForTests();
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
});

afterEach(async () => {
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  resetBootstrapForTests();
  vi.restoreAllMocks();
  await env.cleanup();
});

const admins = async () => (await getRegistry().listUsers()).filter((u) => u.role === "admin");

describe("bootstrap: preconditions", () => {
  it("does nothing when the env pair is absent", async () => {
    const result = await ensureBootstrapAdmin();
    expect(result).toMatchObject({ created: false, reason: "no_env" });
    expect(await admins()).toHaveLength(0);
  });

  it("does nothing when only one of the two variables is set", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    expect((await ensureBootstrapAdmin()).reason).toBe("no_env");
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;
    resetBootstrapForTests();
    expect((await ensureBootstrapAdmin()).reason).toBe("no_env");
    expect(await admins()).toHaveLength(0);
  });

  it("rejects a malformed email without creating an account", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = "not-an-email";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;
    const result = await ensureBootstrapAdmin();
    expect(result).toMatchObject({ created: false, reason: "invalid_email" });
    expect(await admins()).toHaveLength(0);
  });

  it("rejects a password below the platform policy", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "short";
    const result = await ensureBootstrapAdmin();
    expect(result).toMatchObject({ created: false, reason: "weak_password" });
    expect(await admins()).toHaveLength(0);
  });
});

describe("bootstrap: creation and idempotency", () => {
  it("creates exactly one admin and that account can really log in", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = ` ${EMAIL.toUpperCase()} `;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;

    const created = await ensureBootstrapAdmin();
    expect(created.created).toBe(true);
    expect(created.email).toBe(EMAIL); // trim + lowercase

    const records = await admins();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("active");

    // 真正的验收是能登录，而不是「记录存在」
    const response = await loginPost(
      jsonRequest("https://host.test/api/auth/login", {
        body: { email: EMAIL, password: PASSWORD },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie") ?? "").toMatch(/mos_sess=/);
  });

  it("never writes the password into the user record or the logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;

    await ensureBootstrapAdmin();

    const record = (await getRegistry().listUsers())[0];
    expect(JSON.stringify(record)).not.toContain(PASSWORD);

    const emitted = [...info.mock.calls, ...error.mock.calls, ...log.mock.calls]
      .map((call) => call.map(String).join(" "))
      .join("\n");
    expect(emitted).not.toContain(PASSWORD);
    // 但要留一条可审计的痕迹
    expect(emitted).toContain(EMAIL);
  });

  it("is a no-op on the second call and tells the truth about why", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;

    expect((await ensureBootstrapAdmin()).created).toBe(true);
    const second = await ensureBootstrapAdmin();
    expect(second).toMatchObject({ created: false, reason: "admin_exists" });
    expect(await admins()).toHaveLength(1);
  });

  it("collapses concurrent callers into a single creation", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;

    const [a, b, c, d] = await Promise.all([
      ensureBootstrapAdmin(),
      ensureBootstrapAdmin(),
      ensureBootstrapAdmin(),
      ensureBootstrapAdmin(),
    ]);
    // 单飞（single-flight）：并发调用共享同一次尝试，因此四者拿到同一个结论，
    // 但**只写入一条**用户记录。这里锁的是「只创建一次」，不是「只有一个报 created」。
    expect([b.reason, c.reason, d.reason]).toEqual([a.reason, a.reason, a.reason]);
    expect(a.created).toBe(true);
    expect(await admins()).toHaveLength(1);
  });
});

describe("bootstrap: never escalates or overwrites", () => {
  it("does not touch an existing admin, even with a different bootstrap email", async () => {
    const existing = await createUser({ email: "real-admin@example.com", role: "admin" });
    const before = JSON.stringify(existing);

    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;
    const result = await ensureBootstrapAdmin();

    expect(result).toMatchObject({ created: false, reason: "admin_exists" });
    const all = await getRegistry().listUsers();
    expect(all).toHaveLength(1);
    expect(JSON.stringify(all[0])).toBe(before);
  });

  it("does not promote an existing lower-role account that owns the bootstrap email", async () => {
    const creator = await createUser({ email: EMAIL, role: "creator" });

    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;
    const result = await ensureBootstrapAdmin();

    expect(result).toMatchObject({ created: false, reason: "admin_exists" });
    const all = await getRegistry().listUsers();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(creator.id);
    expect(all[0].role).toBe("creator");
  });
});

describe("bootstrap: the trigger is the login PAGE, not the login POST", () => {
  const root = path.resolve(__dirname, "../..");

  it("GET /admin/login renders through ensureBootstrapAdmin", async () => {
    const source = await readFile(path.join(root, "app/admin/login/page.tsx"), "utf8");
    expect(source).toContain("ensureBootstrapAdmin");
    expect(source).toMatch(/await\s+ensureBootstrapAdmin\(\)/);
  });

  it("POST /api/auth/login does not bootstrap (an API script alone creates no admin)", async () => {
    const source = await readFile(path.join(root, "app/api/auth/login/route.ts"), "utf8");
    expect(source).not.toContain("ensureBootstrapAdmin");
  });

  it("a pure login attempt on a virgin environment fails instead of minting an admin", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;

    const response = await loginPost(
      jsonRequest("https://host.test/api/auth/login", {
        body: { email: EMAIL, password: PASSWORD },
      }),
    );
    expect(response.status).toBe(401);
    expect(await admins()).toHaveLength(0);
  });
});
