/**
 * Admin actions on one work — the HTTP surface, not the service.
 *
 * Covers what only a route test can prove: the auth order (401 before 403
 * before CSRF before existence), that a plain creator can never reach an
 * admin-only action, and — the point of the contradiction-state rule — that a
 * published work still holding a pending city intent is NEVER silently
 * rewritten by an unrelated admin action: the state the admin asked for
 * changes, the intent does not.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as adminActionPost } from "@/app/api/admin/works/[gameId]/[action]/route";
import { issueSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getRegistry } from "@/lib/registry/store";
import type { CityTestEnv } from "../cities/setup";
import { seedUser, seedWork, setupCityEnv } from "../cities/setup";

let env: CityTestEnv;
let adminCookie: string;
let creatorCookie: string;
let admin: Awaited<ReturnType<typeof seedUser>>;

function actionRequest(
  gameId: string,
  action: string,
  options: { cookie?: string; body?: unknown; origin?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin !== undefined) headers.origin = options.origin;
  return new Request(`http://localhost/api/admin/works/${gameId}/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {}),
  });
}

async function call(gameId: string, action: string, options: Parameters<typeof actionRequest>[2] = {}) {
  return adminActionPost(actionRequest(gameId, action, options), {
    params: Promise.resolve({ gameId, action }),
  });
}

async function seedContradiction(gameId: string): Promise<void> {
  // published + pending intent: the residue the admin table must flag, and
  // which NO admin action may silently "fix".
  const work = await seedWork(getRegistry(), {
    gameId,
    ownerUserId: "owner0001",
    state: "published",
    withApprovedVersion: true,
  });
  const intent = {
    mode: "pending" as const,
    cityId: "manila-ph",
    cityName: "Manila",
    attempts: 1,
    lastError: "network_error",
    at: "2026-11-04T00:00:00.000Z",
  };
  const updated = await getRegistry().putWork(
    { ...work, cityIntent: intent },
    work.revision,
  );
  if (!updated.ok) throw new Error("putWork 失败");
}

beforeEach(async () => {
  env = await setupCityEnv();
  const creator = await seedUser(env.registry, "owner0001", "creator");
  admin = await seedUser(env.registry, "admin0001", "admin");
  const creatorSession = await issueSession(env.registry, {
    userId: creator.id,
    role: "creator",
    ipHash: "ip",
    uaHash: "ua",
  });
  const adminSession = await issueSession(env.registry, {
    userId: admin.id,
    role: "admin",
    ipHash: "ip",
    uaHash: "ua",
  });
  creatorCookie = `${SESSION_COOKIE}=${creatorSession.token}`;
  adminCookie = `${SESSION_COOKIE}=${adminSession.token}`;
});

afterEach(async () => {
  await env.cleanup();
});

describe("POST /api/admin/works/[gameId]/[action] — 权限与反馈", () => {
  it("未登录 → 401（角色检查先于任何作品读取）", async () => {
    await seedWork(getRegistry(), { gameId: "w-401", ownerUserId: "owner0001", state: "published" });
    const response = await call("w-401", "unlist", { body: {} });
    expect(response.status).toBe(401);
  });

  it("普通用户请求管理员操作 → 403 forbidden（403 不泄露 id 是否存在）", async () => {
    const response = await call("no-such-work", "unlist", { cookie: creatorCookie, body: {} });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("forbidden");
  });

  it("普通用户连 reviewer 级操作（claim）也被拒 → 403", async () => {
    await seedWork(getRegistry(), { gameId: "w-claim", ownerUserId: "owner0001", state: "submitted" });
    const response = await call("w-claim", "claim", { cookie: creatorCookie, body: {} });
    expect(response.status).toBe(403);
  });

  it("带会话但 Origin 与 Host 不一致（跨站）→ 403 bad_origin", async () => {
    await seedWork(getRegistry(), { gameId: "w-csrf", ownerUserId: "owner0001", state: "published" });
    const response = await call("w-csrf", "unlist", {
      cookie: adminCookie,
      body: {},
      origin: "https://evil.example.com",
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("bad_origin");
  });

  it("带会话、Origin 合法但 Host 缺失 → 403 bad_origin", async () => {
    await seedWork(getRegistry(), { gameId: "w-csrf2", ownerUserId: "owner0001", state: "published" });
    const request = new Request("http://localhost/api/admin/works/w-csrf2/unlist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
        origin: "http://localhost",
        // host intentionally absent
      },
      body: JSON.stringify({}),
    });
    Object.defineProperty(request, "headers", {
      value: new Headers([
        ["content-type", "application/json"],
        ["cookie", adminCookie],
        ["origin", "http://localhost"],
      ]),
    });
    const response = await adminActionPost(request, {
      params: Promise.resolve({ gameId: "w-csrf2", action: "unlist" }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("bad_origin");
  });

  it("合法管理员 unlist → 200，返回改写后的 work（明确反馈）", async () => {
    await seedWork(getRegistry(), { gameId: "w-ok", ownerUserId: "owner0001", state: "published" });
    const response = await call("w-ok", "unlist", { cookie: adminCookie, body: {} });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { work?: { state?: string } };
    expect(body.work?.state).toBe("unlisted");
  });

  it("未知操作 → 404 unknown_action", async () => {
    await seedWork(getRegistry(), { gameId: "w-unk", ownerUserId: "owner0001", state: "published" });
    const response = await call("w-unk", "explode", { cookie: adminCookie, body: {} });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("unknown_action");
  });
});

describe("矛盾态（published + pending）：管理操作不自动改写城市意图", () => {
  it("unlist / restore 改作品状态，cityIntent 保持 pending 原样，并留下审计", async () => {
    await seedContradiction("w-contradiction");
    const registry = getRegistry();

    const unlisted = await call("w-contradiction", "unlist", { cookie: adminCookie, body: {} });
    expect(unlisted.status).toBe(200);
    const afterUnlist = await registry.getWork("w-contradiction");
    expect(afterUnlist?.state).toBe("unlisted");
    // The residue is preserved EXACTLY — nothing "helpfully" cleared it.
    expect(afterUnlist?.cityIntent).toEqual({
      mode: "pending",
      cityId: "manila-ph",
      cityName: "Manila",
      attempts: 1,
      lastError: "network_error",
      at: "2026-11-04T00:00:00.000Z",
    });

    const restored = await call("w-contradiction", "restore", { cookie: adminCookie, body: {} });
    expect(restored.status).toBe(200);
    const afterRestore = await registry.getWork("w-contradiction");
    expect(afterRestore?.state).toBe("published");
    expect(afterRestore?.cityIntent?.mode).toBe("pending");

    // Audited: both state changes are on the record; the intent itself was
    // never the object of an audit entry (no hidden rewrite happened).
    const audit = await registry.listAudit(50);
    const actions = audit
      .filter((entry) => entry.targetType === "work" && entry.targetId === "w-contradiction")
      .map((entry) => entry.action);
    expect(actions).toContain("work.unlist");
    expect(actions).toContain("work.restore");
    expect(actions).not.toContain("work.city_intent");
  });
});
