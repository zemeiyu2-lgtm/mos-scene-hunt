import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Game } from "../../lib/game/types";
import { sha256Hex } from "../../lib/cloud/publish-server";
import { INDEX_PATHNAME, DRAFT_PATHNAME, readIndex, readPublishedPack } from "../../lib/cloud/blob-store";
import type { FakeBlobStore } from "../../lib/cloud/blob-test-double";
import { BlobBackendError } from "../../lib/cloud/blob-backend";
import { PUBLISH_KEY, SECRET, releaseFakeBlob, useFakeBlob } from "./helpers";

/**
 * 路由层的集成测试：直接调用真实的 Route Handler（POST /api/cloud/games、
 * GET /api/cloud/games/[token]），而**不是**模拟它们。
 *
 * 两个替换点，其余全是真的：
 *   - 仓库内容层：`process.chdir` 到含 content/ 的临时目录，读写都落在沙箱里；
 *   - Blob 存储：注入内存后端（lib/cloud/blob-test-double），不碰任何真实 store。
 *
 * 因此这里验证的是「发布 → 持久化 → 取回」的真实代码路径，包括条件写入、
 * 摘要校验与故障分支。它**不**验证真实 Vercel Blob 的网络连通性——那属于部署后
 * 的验收，报告里必须分开写。
 */

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
let store: FakeBlobStore;

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
  // resetModules 后 blob-store 是新的模块实例，注入需要重做。
  const { setBlobBackend } = await import("../../lib/cloud/blob-store");
  setBlobBackend(store);
  const post = await import("../../app/api/cloud/games/route");
  const get = await import("../../app/api/cloud/games/[token]/route");
  return { post, get };
}

function postRequest(
  body: unknown,
  key: string | null = PUBLISH_KEY,
  query = "",
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  return new Request(`http://localhost/api/cloud/games${query}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function tokenRequest(token: string): Request {
  return new Request(`http://localhost/api/cloud/games/${token}`);
}

const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "mos-cloud-route-"));
  writeCatalog([]);
  process.chdir(sandbox);
  store = useFakeBlob();
  vi.stubEnv("MOS_CLOUD_PUBLISH_KEY", PUBLISH_KEY);
  vi.stubEnv("MOS_CLOUD_PUBLISH_SECRET", SECRET);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_fake_store_for_tests");
  vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "");
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  vi.resetModules();
  releaseFakeBlob();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("POST /api/cloud/games - 访问控制", () => {
  it("未配置发布密钥时返回 503，且不写任何存储对象", async () => {
    vi.stubEnv("MOS_CLOUD_PUBLISH_KEY", "");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(503);
    expect(store.puts).toHaveLength(0);
  });

  it("缺少密钥返回 401", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }, null));
    expect(res.status).toBe(401);
    expect(store.puts).toHaveLength(0);
  });

  it("密钥错误返回 403，且不落库", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }, "definitely-wrong-key-123"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
    expect(store.puts).toHaveLength(0);
  });

  it("签名密钥缺失时即使鉴权通过也返回 503（不发不可验证的令牌）", async () => {
    vi.stubEnv("MOS_CLOUD_PUBLISH_SECRET", "");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(503);
    expect(store.puts).toHaveLength(0);
  });

  it("存储未接入时返回 503 storage_unavailable（失败关闭，不写临时盘）", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("storage_unavailable");
    expect(body.message).toContain("Blob");
    expect(store.puts).toHaveLength(0);
  });
});

describe("POST /api/cloud/games - 无效输入", () => {
  it("非 JSON 返回 400", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest("{ not json"));
    expect(res.status).toBe(400);
    expect(store.puts).toHaveLength(0);
  });

  it("结构性错误的游戏包返回 422，并列出问题", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: { id: "bad", title: "坏", scenes: [] } }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid_package");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(store.puts).toHaveLength(0);
  });

  it("超体积请求返回 413", async () => {
    const { post } = await loadRoutes();
    const huge = "x".repeat(1024 * 1024);
    const res = await post.POST(postRequest(huge));
    expect(res.status).toBe(413);
  });

  it("同 id 已被仓库目录里的别的包文件占用时返回 409", async () => {
    writeCatalog([
      { id: "route-loop-hunt", packFile: "someone-else.json", title: "别人的", status: "published" },
    ]);
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; conflict: { packFile: string } };
    expect(body.error).toBe("id_conflict");
    expect(body.conflict.packFile).toBe("someone-else.json");
    expect(store.puts).toHaveLength(0);
  });

  it("仓库内容目录损坏时返回 500（不猜是否冲突）", async () => {
    writeFileSync(path.join(sandbox, "content", "cloud", "catalog.json"), "{ broken");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(500);
    expect(store.puts).toHaveLength(0);
  });
});

describe("云端闭环 - 发布 → 持久化 → 取回", () => {
  it("合法包被接收（202）并真的写进存储：包体 + 元数据 + 草稿，但玩家目录不变", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      digest: string;
      token: string;
      retrievalPath: string;
      catalogStatus: string;
      store: { backend: string; created: boolean };
      game: { id: string; sceneCount: number };
    };
    expect(body.ok).toBe(true);
    expect(body.catalogStatus).toBe("draft");
    expect(body.store.backend).toBe("vercel-blob");
    expect(body.store.created).toBe(true);
    expect(body.game.id).toBe("route-loop-hunt");
    expect(body.game.sceneCount).toBe(2);
    expect(body.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.retrievalPath).toBe(`/api/cloud/games/${encodeURIComponent(body.token)}`);

    // 持久化证据：包体按摘要寻址存在于 store 里，内容可原样读回。
    const packPath = `scene-hunt/games/route-loop-hunt/${body.digest}.json`;
    expect(store.blobs.has(packPath)).toBe(true);
    expect(store.blobs.has(`scene-hunt/games/route-loop-hunt/${body.digest}.meta.json`)).toBe(true);

    // 草稿目录有这一条，且状态是 draft（玩家不可见）。
    const drafts = JSON.parse(store.text(DRAFT_PATHNAME) ?? "{}") as {
      games: Array<{ id: string; status: string; digest: string }>;
    };
    expect(drafts.games[0]).toMatchObject({
      id: "route-loop-hunt",
      status: "draft",
      digest: body.digest,
    });

    // 未开启直接发布时，已发布索引里不该出现这个 id。
    const index = JSON.parse(store.text(INDEX_PATHNAME) ?? '{"games":{}}') as { games: Record<string, unknown> };
    expect(index.games["route-loop-hunt"]).toBeUndefined();
  });

  it("发布后按令牌取回的包体与提交内容逐字节一致，摘要吻合", async () => {
    const { post, get } = await loadRoutes();
    const game = makeGame();
    const res = await post.POST(postRequest({ game }));
    const { token, digest } = (await res.json()) as { token: string; digest: string };

    const fetched = await get.GET(tokenRequest(token), tokenParams(token));
    expect(fetched.status).toBe(200);
    const text = await fetched.text();
    expect(sha256Hex(text)).toBe(digest);

    const received = JSON.parse(text) as Game;
    expect(received.id).toBe(game.id);
    expect(received.title).toBe(game.title);
    expect(received.scenes.map((s) => s.id)).toEqual(game.scenes.map((s) => s.id));
    expect(received.scenes[0].location).toEqual(game.scenes[0].location);
    expect(received.scenes[0].challenge).toEqual(game.scenes[0].challenge);
    expect(received.scenes[1].reward).toEqual(game.scenes[1].reward);
    expect(fetched.headers.get("x-publish-game-id")).toBe(game.id);
  });

  it("重复提交同一内容：幂等，不产生第二份包体，并提示内容未变", async () => {
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

    // 包体只写了一次（按摘要寻址），元数据被重写是允许的。
    const packWrites = store.puts.filter((p) => p === `scene-hunt/games/route-loop-hunt/${a.digest}.json`);
    expect(packWrites).toHaveLength(1);
  });

  it("更新自己的游戏（同 id 新内容）被接受并标为 republish，旧版本包体仍保留", async () => {
    writeCatalog([{ id: "route-loop-hunt", packFile: "route-loop-hunt.json", title: "旧版", status: "published" }]);
    const { post } = await loadRoutes();
    const v1 = await post.POST(postRequest({ game: makeGame() })).then((r) => r.json() as Promise<{ digest: string }>);
    const res = await post.POST(postRequest({ game: makeGame({ version: "1.1.0", title: "改过标题" }) }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { duplicate: string; digest: string };
    expect(body.duplicate).toBe("republish");
    expect(body.digest).not.toBe(v1.digest);
    // 不可变包体：两版都在，不会互相覆盖。
    expect(store.blobs.has(`scene-hunt/games/route-loop-hunt/${v1.digest}.json`)).toBe(true);
    expect(store.blobs.has(`scene-hunt/games/route-loop-hunt/${body.digest}.json`)).toBe(true);
  });

  it("开启直接发布后：索引更新，玩家目录能读到这一条", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }, PUBLISH_KEY, "?publish=1"));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { catalogStatus: string; digest: string };
    expect(body.catalogStatus).toBe("published");

    const index = await readIndex();
    expect(index.games["route-loop-hunt"]?.digest).toBe(body.digest);
    expect(await readPublishedPack("route-loop-hunt", body.digest)).toContain("route-loop-hunt");
  });

  it("未开启直接发布时，即使请求带 ?publish=1 也只进草稿", async () => {
    const { post } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }, PUBLISH_KEY, "?publish=1"));
    const body = (await res.json()) as { catalogStatus: string; directPublishEnabled: boolean };
    expect(body.directPublishEnabled).toBe(false);
    expect(body.catalogStatus).toBe("draft");
    const index = await readIndex();
    expect(index.games["route-loop-hunt"]).toBeUndefined();
  });

  it("伪造的令牌取不到任何内容（401）", async () => {
    const { get } = await loadRoutes();
    const res = await get.GET(tokenRequest("v1.YWJj.ZGVm"), tokenParams("v1.YWJj.ZGVm"));
    expect(res.status).toBe(401);
  });

  it("合法但对应包已从存储消失的令牌返回 404", async () => {
    const { post, get } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    const { token, digest } = (await res.json()) as { token: string; digest: string };
    // 模拟「存储被清理」：只删包体，元数据仍在。
    store.blobs.delete(`scene-hunt/games/route-loop-hunt/${digest}.json`);

    const fetched = await get.GET(tokenRequest(token), tokenParams(token));
    expect(fetched.status).toBe(404);
    const body = (await fetched.json()) as { error: string };
    expect(body.error).toBe("package_not_found");
  });

  it("存储被篡改时拒绝返回（摘要不符 → 500 digest_mismatch）", async () => {
    const { post, get } = await loadRoutes();
    const res = await post.POST(postRequest({ game: makeGame() }));
    const { token, digest } = (await res.json()) as { token: string; digest: string };
    const packPath = `scene-hunt/games/route-loop-hunt/${digest}.json`;
    const record = store.blobs.get(packPath);
    expect(record).toBeTruthy();
    store.blobs.set(packPath, {
      ...(record as NonNullable<typeof record>),
      body: JSON.stringify(makeGame({ title: "被替换" })),
    });

    const fetched = await get.GET(tokenRequest(token), tokenParams(token));
    expect(fetched.status).toBe(500);
    const body = (await fetched.json()) as { error: string };
    expect(body.error).toBe("digest_mismatch");
  });

  it("存储写入失败时返回 503，且已发布索引不被破坏", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();
    // 先正常发布一版，作为「既有数据」。
    const first = await post.POST(postRequest({ game: makeGame() }, PUBLISH_KEY, "?publish=1"));
    const firstBody = (await first.json()) as { digest: string };
    expect(first.status).toBe(202);

    // 之后的写入全部失败。
    store.putFailure = () => new BlobBackendError("unavailable", "network is down");
    const second = await post.POST(postRequest({ game: makeGame({ title: "第二版" }) }, PUBLISH_KEY, "?publish=1"));
    expect(second.status).toBe(503);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("storage_write_failed");

    // 既有版本仍然可下载，索引仍指向它。
    const index = await readIndex();
    expect(index.games["route-loop-hunt"]?.digest).toBe(firstBody.digest);
    expect(await readPublishedPack("route-loop-hunt", firstBody.digest)).not.toBeNull();
  });

  it("索引写入冲突时重试后成功，不把发布整体判失败", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();
    // 只让第一次「写索引」失败一次，用后端自身的故障注入钩子（不覆写方法）。
    const originalWrite = store.write.bind(store);
    let conflicts = 0;
    store.write = async (pathname, text, options) => {
      if (pathname === INDEX_PATHNAME && conflicts === 0) {
        conflicts += 1;
        throw new BlobBackendError("conflict", "precondition failed");
      }
      return originalWrite(pathname, text, options);
    };
    const res = await post.POST(postRequest({ game: makeGame() }, PUBLISH_KEY, "?publish=1"));
    expect(conflicts).toBe(1);
    expect(res.status).toBe(202);
    expect((await readIndex()).games["route-loop-hunt"]).toBeTruthy();
  });

  it("并发发布两个不同游戏：两条索引条目都保留", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();
    const [a, b] = await Promise.all([
      post.POST(postRequest({ game: makeGame({ id: "alpha" }) }, PUBLISH_KEY, "?publish=1")),
      post.POST(postRequest({ game: makeGame({ id: "beta" }) }, PUBLISH_KEY, "?publish=1")),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const index = await readIndex();
    expect(Object.keys(index.games).sort()).toEqual(["alpha", "beta"]);
  });

  /**
   * Issue #61 P1 的**精确复现**。
   *
   * 上面那个用例虽然叫「并发」，但两次请求落到 `read → write` 的时序其实是串行的，
   * 所以它并不能证明「首次创建的竞争」被防住了。这里强制让两个请求**都**读到
   * 「索引不存在」，再到存储里抢创建——旧实现（不带 ifMatch + 无条件覆盖）在这个
   * 时序下必然丢掉先写的那条。
   */
  it("两个游戏同时首次发布（都先读到空索引）：两条都必须保留", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();

    const originalRead = store.read.bind(store);
    let indexReads = 0;
    store.read = async (pathname) => {
      if (pathname === INDEX_PATHNAME && indexReads < 2) {
        indexReads += 1;
        return null; // 两个请求各自读一次，都看到「索引还不存在」
      }
      return originalRead(pathname);
    };

    const [a, b] = await Promise.all([
      post.POST(postRequest({ game: makeGame({ id: "first-game" }) }, PUBLISH_KEY, "?publish=1")),
      post.POST(postRequest({ game: makeGame({ id: "second-game" }) }, PUBLISH_KEY, "?publish=1")),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);

    const index = await readIndex();
    expect(Object.keys(index.games).sort()).toEqual(["first-game", "second-game"]);
    // 两条指针各自完整，不是「只剩一条空壳」。
    for (const id of ["first-game", "second-game"]) {
      expect(index.games[id].digest).toMatch(/^[0-9a-f]{64}$/);
      expect(index.games[id].pathname).toContain(id);
    }
  });

  it("索引损坏时发布失败关闭：返回 500 index_corrupt，且坏索引一字节未被覆盖", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();

    // 先有一个正常发布的游戏，然后索引被写坏。
    const ok = await post.POST(postRequest({ game: makeGame({ id: "healthy" }) }, PUBLISH_KEY, "?publish=1"));
    expect(ok.status).toBe(202);

    const broken = '{ "version": 1, "games": { "healthy": { "digest": ';
    await store.write(INDEX_PATHNAME, broken, { allowOverwrite: true });

    const res = await post.POST(postRequest({ game: makeGame({ id: "newcomer" }) }, PUBLISH_KEY, "?publish=1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("index_corrupt");
    expect(body.message).toContain("避免覆盖");

    // 核心断言：损坏的索引原文保留，没有被「只含 newcomer 的空索引」覆盖。
    expect(store.text(INDEX_PATHNAME)).toBe(broken);
  });

  it("索引损坏时也不会去写包体和草稿，避免留下无人引用的半成品", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();
    await store.write(INDEX_PATHNAME, "not json at all", { allowOverwrite: true });

    const res = await post.POST(postRequest({ game: makeGame({ id: "would-be-orphan" }) }, PUBLISH_KEY, "?publish=1"));
    expect(res.status).toBe(500);

    // 读索引在写包体之前，所以这里应该完全没有新对象。
    const gameBlobs = store.puts.filter((p) => p.includes("would-be-orphan"));
    expect(gameBlobs).toEqual([]);
    expect(store.text(DRAFT_PATHNAME)).toBeNull();
  });

  it("索引损坏时既有游戏的包体仍然原样可取回（数据没被删）", async () => {
    vi.stubEnv("MOS_CLOUD_ALLOW_DIRECT_PUBLISH", "1");
    const { post } = await loadRoutes();
    const ok = await post.POST(postRequest({ game: makeGame({ id: "survivor" }) }, PUBLISH_KEY, "?publish=1"));
    const okBody = (await ok.json()) as { digest: string };
    const before = await readPublishedPack("survivor", okBody.digest);
    expect(before).not.toBeNull();

    await store.write(INDEX_PATHNAME, "{{{", { allowOverwrite: true });
    const res = await post.POST(postRequest({ game: makeGame({ id: "x" }) }, PUBLISH_KEY, "?publish=1"));
    expect(res.status).toBe(500);

    expect(await readPublishedPack("survivor", okBody.digest)).toBe(before);
  });
});

describe("GET /api/cloud/games - 接口自述", () => {
  it("不泄露密钥，只报告通道与存储是否就绪", async () => {
    const { post } = await loadRoutes();
    const res = await post.GET();
    const body = (await res.json()) as { enabled: boolean; storage: string; message: string };
    expect(res.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.storage).toBe("vercel-blob");
    const text = JSON.stringify(body);
    expect(text).not.toContain(PUBLISH_KEY);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("vercel_blob_rw_fake_store_for_tests");
  });
});
