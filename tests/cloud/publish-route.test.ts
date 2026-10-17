import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Game } from "../../lib/game/types";
import { sha256Hex } from "../../lib/cloud/publish-server";

/**
 * 路由层的集成测试：直接调用真实的 Route Handler（POST /api/cloud/games、
 * GET /api/cloud/games/[token]），而**不是**模拟它们。
 *
 * 每个用例在临时目录里跑：`process.chdir` 到一个含 content/ 的沙箱，
 * 这样「读到线上目录」「写入发布存储」都发生在沙箱里，不会碰到仓库的真实内容。
 * afterEach 还原工作目录与环境变量，用例之间互不影响。
 */

const PUBLISH_KEY = "test-publish-key-0000000001";
const SECRET = "t".repeat(48);

const originalCwd = process.cwd();

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "route-loop-hunt",
    version: "1.0.0",
    title: "路由闭环测试",
    description: "验证发布接口与获取接口的完整往返。",
    author: "测试设计者",
    language: "zh-CN",
    estimatedMinutes: 20,
    difficulty: "easy",
    startLocation: { lat: 14.5844, lng: 120.9794 },
    huntArea: { center: { lat: 14.5844, lng: 120.9794 }, radiusMeters: 120, shape: "circle" },
    entrySceneId: "a",
    scenes: [
      {
        id: "a",
        title: "第一站",
        story: "起步。",
        location: { lat: 14.5844, lng: 120.9794, radius: 20 },
        nextSceneId: "b",
        challenge: { type: "keyword", question: "写下关键词", answer: ["光"] },
        reward: { type: "keyword", title: "线索", value: "光" },
      },
      {
        id: "b",
        title: "第二站",
        story: "终点。",
        location: { lat: 14.585, lng: 120.98, radius: 20 },
        nextSceneId: null,
        challenge: { type: "text", question: "你看到了什么？", answer: ["树"] },
        reward: { type: "badge", title: "完成", value: "done" },
      },
    ],
    ...overrides,
  };
}

let sandbox: string;

function writeCatalog(games: unknown[]) {
  mkdirSync(path.join(sandbox, "content", "cloud"), { recursive: true });
  writeFileSync(
    path.join(sandbox, "content", "cloud", "catalog.json"),
    JSON.stringify({ version: "1.0", updatedAt: "2026-10-17", games }, null, 2),
  );
}

async function loadRoutes() {
  // 每次都重新 import，确保 route 模块里的 process.cwd() 读到当前沙箱。
  vi.resetModules();
  const post = await import("../../app/api/cloud/games/route");
  const get = await import("../../app/api/cloud/games/[token]/route");
  return { post, get };
}

function postRequest(body: unknown, key: string | null = PUBLISH_KEY): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  return new Request("http://localhost/api/cloud/games", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "mos-cloud-route-"));
  writeCatalog([]);
  process.chdir(sandbox);
  vi.stubEnv("MOS_CLOUD_PUBLISH_KEY", PUBLISH_KEY);
  vi.stubEnv("MOS_CLOUD_PUBLISH_SECRET", SECRET);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("POST /api/cloud/games - 访问控制", () => {
  it("未配置发布密钥时返回 503，且不写任何文件", async () => {
    vi.stubEnv("MOS_CLOUD_PUBLISH_KEY", "");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(503);
    expect(existsSync(path.join(sandbox, "content", "cloud", "publish-store"))).toBe(false);
  });

  it("缺少密钥返回 401", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }, null));
    expect(res.status).toBe(401);
  });

  it("密钥错误返回 403，且不落库", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }, "definitely-wrong-key-123"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
    expect(existsSync(path.join(sandbox, "content", "cloud", "publish-store"))).toBe(false);
  });

  it("签名密钥缺失时即使鉴权通过也返回 503（不发不可验证的令牌）", async () => {
    vi.stubEnv("MOS_CLOUD_PUBLISH_SECRET", "");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/cloud/games - 无效输入", () => {
  it("非 JSON 返回 400", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest("{ not json"));
    expect(res.status).toBe(400);
  });

  it("结构性错误的游戏包返回 422，并列出问题", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: { id: "bad", title: "坏", scenes: [] } }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid_package");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("超体积请求返回 413", async () => {
    const { post } = await loadRoutes();
    const huge = "x".repeat(1024 * 1024);
    const res = await post.POST(postRequest(huge));
    expect(res.status).toBe(413);
  });

  it("同 id 已被别的包文件占用时返回 409", async () => {
    writeCatalog([
      { id: "route-loop-hunt", packFile: "someone-else.json", title: "别人的", status: "published" },
    ]);
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; conflict: { packFile: string } };
    expect(body.error).toBe("id_conflict");
    expect(body.conflict.packFile).toBe("someone-else.json");
  });

  it("线上目录损坏时返回 500（不猜是否冲突）", async () => {
    writeFileSync(path.join(sandbox, "content", "cloud", "catalog.json"), "{ broken");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(500);
  });
});

describe("云端闭环 - 发布 → 取回", () => {
  it("合法游戏包被接收（202），目录条目为 draft，返回凭据与获取路径", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    const body = (await res.json()) as {
      ok: boolean;
      digest: string;
      token: string;
      retrievalPath: string;
      catalogStatus: string;
      game: { id: string; sceneCount: number };
    };
    expect(body.ok).toBe(true);
    expect(body.catalogStatus).toBe("draft");
    expect(body.game.id).toBe("route-loop-hunt");
    expect(body.game.sceneCount).toBe(2);
    expect(body.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.retrievalPath).toBe(`/api/cloud/games/${encodeURIComponent(body.token)}`);

    // 目录草稿写进了发布存储，但线上目录没有被改动。
    const drafts = JSON.parse(
      readFileSync(path.join(sandbox, "content", "cloud", "publish-store", "catalog-entries.json"), "utf8"),
    ) as { games: Array<{ id: string; status: string }> };
    expect(drafts.games[0]).toMatchObject({ id: "route-loop-hunt", status: "draft" });

    const live = JSON.parse(readFileSync(path.join(sandbox, "content", "cloud", "catalog.json"), "utf8")) as {
      games: unknown[];
    };
    expect(live.games).toHaveLength(0);
  });

  it("凭令牌取回的包体与发布内容逐字节一致，且摘要吻合", async () => {
    const { post, get } = await loadRoutes();
    const game = makeGame();
    const res = await post.POST(postRequest({ game }));
    const { token, digest } = (await res.json()) as { token: string; digest: string };

    const fetched = await get.GET(new Request(`http://localhost/api/cloud/games/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(fetched.status).toBe(200);
    const text = await fetched.text();
    expect(sha256Hex(text)).toBe(digest);

    // 内容一致性：每一个站点的关键字段都要对得上。
    const received = JSON.parse(text) as Game;
    expect(received.id).toBe(game.id);
    expect(received.title).toBe(game.title);
    expect(received.scenes.map((s) => s.id)).toEqual(game.scenes.map((s) => s.id));
    expect(received.scenes[0].location).toEqual(game.scenes[0].location);
    expect(received.scenes[0].challenge).toEqual(game.scenes[0].challenge);
    expect(received.scenes[1].reward).toEqual(game.scenes[1].reward);
    expect(fetched.headers.get("x-publish-game-id")).toBe(game.id);
  });

  it("重复提交同一内容：幂等，不产生第二份存储，并提示内容未变", async () => {
    const { post } = await loadRoutes();
    const first = await post.POST(postRequest({ game: makeGame() }));
    const second = await post.POST(postRequest({ game: makeGame() }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const a = (await first.json()) as { digest: string; store: { created: boolean } };
    const b = (await second.json()) as { digest: string; unchanged: boolean; store: { created: boolean } };
    expect(b.digest).toBe(a.digest);
    expect(a.store.created).toBe(true);
    expect(b.store.created).toBe(false);
    expect(b.unchanged).toBe(true);
  });

  it("更新自己的游戏（同 id 同文件、新内容）被接受并标为 republish", async () => {
    writeCatalog([{ id: "route-loop-hunt", packFile: "route-loop-hunt.json", title: "旧版", status: "published" }]);
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame({ version: "1.1.0" }) }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { duplicate: string };
    expect(body.duplicate).toBe("republish");
  });

  it("伪造的令牌取不到任何内容（401）", async () => {
    const { get } = await loadRoutes();
    const res = await get.GET(new Request("http://localhost/api/cloud/games/forged"), {
      params: Promise.resolve({ token: "v1.YWJj.ZGVm" }),
    });
    expect(res.status).toBe(401);
  });

  it("合法但对应包已不存在的令牌返回 404", async () => {
    const { post, get } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    const { token } = (await res.json()) as { token: string };
    // 模拟「存储被清理」：删掉包体，只留 meta。
    const storeDir = path.join(sandbox, "content", "cloud", "publish-store");
    for (const file of readdirSync(storeDir)) {
      if (/^[0-9a-f]{64}\.json$/.test(file)) rmSync(path.join(storeDir, file));
    }
    const fetched = await get.GET(new Request(`http://localhost/api/cloud/games/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(fetched.status).toBe(404);
    const body = (await fetched.json()) as { error: string };
    expect(body.error).toBe("package_not_found");
  });

  it("存储被篡改时拒绝返回（摘要不符 → 500）", async () => {
    const { post, get } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    const { token } = (await res.json()) as { token: string };
    const storeDir = path.join(sandbox, "content", "cloud", "publish-store");
    const bodyFile = readdirSync(storeDir).find((f) => /^[0-9a-f]{64}\.json$/.test(f));
    expect(bodyFile).toBeTruthy();
    writeFileSync(path.join(storeDir, bodyFile as string), JSON.stringify(makeGame({ title: "被替换" })));
    const fetched = await get.GET(new Request(`http://localhost/api/cloud/games/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(fetched.status).toBe(500);
    const body = (await fetched.json()) as { error: string };
    expect(body.error).toBe("digest_mismatch");
  });
});

describe("GET /api/cloud/games - 接口自述", () => {
  it("不泄露密钥，只报告通道是否开通", async () => {
    const { post } = await loadRoutes();
    const res = await post.GET();
    const body = (await res.json()) as { enabled: boolean; message: string };
    expect(res.status).toBe(200);
    expect(body.enabled).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toContain(PUBLISH_KEY);
    expect(text).not.toContain(SECRET);
  });
});
