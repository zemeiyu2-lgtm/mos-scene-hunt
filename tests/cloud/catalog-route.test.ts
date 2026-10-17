import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 云端目录动态读取的测试。
 *
 * 这条路由过去返回硬编码常量，导致「落库改了文件、目录却不变」。这里锁住修复后的
 * 行为契约：
 *   1. 目录内容来自 content/cloud/catalog.json（改文件就改输出）；
 *   2. 只有 published 才对外可见；
 *   3. 指向缺失文件、或包内 id 与条目不一致的条目，不会被当成可下载；
 *   4. 现有官方包不受影响。
 *
 * 用例在临时目录里跑真实的 Route Handler，不会触碰仓库内容。
 */

const originalCwd = process.cwd();
let sandbox: string;

function writeJson(rel: string, value: unknown) {
  const file = path.join(sandbox, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function pack(id: string) {
  return {
    id,
    language: "zh-CN",
    title: `包 ${id}`,
    description: "目录测试用",
    version: "1.0.0",
    startLocation: { lat: 14.58, lng: 120.98 },
    scenes: [
      {
        id: "s1",
        title: "站点",
        story: "故事",
        location: { lat: 14.58, lng: 120.98, radius: 20 },
        nextSceneId: null,
      },
    ],
  };
}

function entry(id: string, status: string, packFile = `${id}.json`) {
  return {
    id,
    title: `游戏 ${id}`,
    author: "测试",
    description: "说明",
    language: "zh-CN",
    sceneCount: 1,
    status,
    packFile,
  };
}

async function loadRoute() {
  vi.resetModules();
  return import("../../app/content/cloud/catalog.json/route");
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "mos-catalog-"));
  process.chdir(sandbox);
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
  vi.resetModules();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("云端目录：动态读取", () => {
  it("目录内容来自 catalog.json 文件，而不是代码里的常量", async () => {
    writeJson("content/published-a.json", pack("published-a"));
    writeJson("content/cloud/catalog.json", { version: "1.0", games: [entry("published-a", "published")] });

    const route = await loadRoute();
    const res = await route.GET();
    const body = (await res.json()) as { games: Array<{ id: string }> };
    expect(res.status).toBe(200);
    expect(body.games.map((g) => g.id)).toEqual(["published-a"]);
  });

  it("改文件后输出随之变化（没有第二份硬编码副本）", async () => {
    writeJson("content/a.json", pack("a"));
    writeJson("content/b.json", pack("b"));
    writeJson("content/cloud/catalog.json", { version: "1.0", games: [entry("a", "published")] });

    let route = await loadRoute();
    let body = (await (await route.GET()).json()) as { games: Array<{ id: string }> };
    expect(body.games.map((g) => g.id)).toEqual(["a"]);

    writeJson("content/cloud/catalog.json", {
      version: "1.0",
      games: [entry("a", "published"), entry("b", "published")],
    });
    route = await loadRoute();
    body = (await (await route.GET()).json()) as { games: Array<{ id: string }> };
    expect(body.games.map((g) => g.id)).toEqual(["a", "b"]);
  });
});

describe("云端目录：状态区分", () => {
  it("草稿不会出现在玩家目录里", async () => {
    writeJson("content/draft-one.json", pack("draft-one"));
    writeJson("content/cloud/catalog.json", { version: "1.0", games: [entry("draft-one", "draft")] });
    const route = await loadRoute();
    const res = await route.GET();
    const body = (await res.json()) as { games: unknown[] };
    expect(body.games).toHaveLength(0);
    expect(res.headers.get("x-cloud-catalog-hidden")).toBe("1");
  });

  it("unlisted 与 archived 同样不可见", async () => {
    writeJson("content/u.json", pack("u"));
    writeJson("content/r.json", pack("r"));
    writeJson("content/cloud/catalog.json", {
      version: "1.0",
      games: [entry("u", "unlisted"), entry("r", "archived")],
    });
    const route = await loadRoute();
    const body = (await (await route.GET()).json()) as { games: unknown[] };
    expect(body.games).toHaveLength(0);
  });

  it("已发布但包文件缺失的条目不会以可下载状态出现", async () => {
    // 目录里有条目，但 content/missing.json 不存在。
    writeJson("content/cloud/catalog.json", { version: "1.0", games: [entry("missing", "published")] });
    const route = await loadRoute();
    const res = await route.GET();
    const body = (await res.json()) as { games: unknown[] };
    expect(body.games).toHaveLength(0);
    expect(res.headers.get("x-cloud-catalog-hidden")).toBe("1");
  });

  it("已发布但包内 id 与条目 id 不一致时不被信任", async () => {
    // 目录声称 id=mismatch，但文件里其实是另一个游戏：这种「挂羊头」的条目必须过滤。
    writeJson("content/mismatch.json", pack("something-else"));
    writeJson("content/cloud/catalog.json", { version: "1.0", games: [entry("mismatch", "published")] });
    const route = await loadRoute();
    const body = (await (await route.GET()).json()) as { games: unknown[] };
    expect(body.games).toHaveLength(0);
  });

  it("packFile 试图路径穿越的条目被忽略", async () => {
    writeJson("content/cloud/catalog.json", {
      version: "1.0",
      games: [entry("evil", "published", "../../package.json")],
    });
    const route = await loadRoute();
    const body = (await (await route.GET()).json()) as { games: unknown[] };
    expect(body.games).toHaveLength(0);
  });

  it("混合状态下只放出真正可下载的已发布条目", async () => {
    writeJson("content/ok.json", pack("ok"));
    writeJson("content/draft.json", pack("draft"));
    writeJson("content/cloud/catalog.json", {
      version: "1.0",
      games: [entry("ok", "published"), entry("draft", "draft"), entry("gone", "published")],
    });
    const route = await loadRoute();
    const body = (await (await route.GET()).json()) as { games: Array<{ id: string }> };
    expect(body.games.map((g) => g.id)).toEqual(["ok"]);
  });
});

describe("云端目录：错误处理", () => {
  it("仓库目录缺失时返回空目录而不是报错（云端存储才是新游戏的来源）", async () => {
    const route = await loadRoute();
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: unknown[] };
    expect(body.games).toEqual([]);
    expect(res.headers.get("x-cloud-catalog-backend")).toBe("repo-only");
  });

  it("仓库目录不是合法 JSON 返回 500 catalog_unreadable（部署本身有问题）", async () => {
    mkdirSync(path.join(sandbox, "content", "cloud"), { recursive: true });
    writeFileSync(path.join(sandbox, "content", "cloud", "catalog.json"), "{ oops");
    const route = await loadRoute();
    const res = await route.GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("catalog_unreadable");
  });

  it("games 不是数组时返回空目录而不是崩溃", async () => {
    writeJson("content/cloud/catalog.json", { version: "1.0", games: "nope" });
    const route = await loadRoute();
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: unknown[] };
    expect(body.games).toEqual([]);
  });
});

describe("云端目录：已发布索引损坏时的信号", () => {
  it("索引损坏时明确标记 corrupt，而不是伪装成一个「恰好很短」的正常目录", async () => {
    writeJson("content/cloud/catalog.json", { version: "1.0", games: [] });
    // 目录路由只在「存储已接入」时才去读索引，所以这里要显式声明已接入。
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_fake_store_for_tests");

    // 注意顺序：loadRoute 内部的 resetModules 会让 blob-store 变成新实例，
    // 注入必须在它之后，否则路由会拿到一个「没有注入」的模块，真的去连远端 store。
    const route = await loadRoute();
    const { setBlobBackend, INDEX_PATHNAME } = await import("../../lib/cloud/blob-store");
    const { FakeBlobStore } = await import("../../lib/cloud/blob-test-double");
    const store = new FakeBlobStore();
    await store.write(INDEX_PATHNAME, "{ corrupted", { allowOverwrite: true });
    setBlobBackend(store);

    const res = await route.GET();
    // 仓库里的官方游戏仍然要给出来（不能让新存储的故障藏起静态内容）。
    expect(res.status).toBe(200);
    // 但必须能让调用方看出「云端这一部分是坏的，不是空的」。
    expect(res.headers.get("x-cloud-catalog-backend")).toBe("corrupt");
    expect(res.headers.get("x-cloud-catalog-warning")).toBe("published-index-corrupt");

    setBlobBackend(null);
  });
});
