import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOB_ROOT,
  BlobStoreError,
  INDEX_PATHNAME,
  readBlobConfig,
  readDrafts,
  readIndex,
  readPackMeta,
  readPublishedPack,
  upsertDraft,
  updateIndexEntry,
  writePack,
} from "../../lib/cloud/blob-store";
import { FakeBlobStore } from "../../lib/cloud/blob-test-double";
import { BlobBackendError } from "../../lib/cloud/blob-backend";
import { releaseFakeBlob, useFakeBlob } from "./helpers";

/**
 * 持久化层的直接单测：只测 lib/cloud/blob-store 本身。
 *
 * 覆盖的是「真实 Blob API 的语义在代码里被正确使用了吗」：
 *   - 按摘要寻址 → 幂等，重复写不产生第二份；
 *   - 索引更新走条件写入 → 并发写不互相覆盖；
 *   - 读不存在的对象返回 null 而不是抛错；
 *   - 存储故障被归类成可区分的错误（路由层要靠它给不同状态码）。
 */

let store: FakeBlobStore;

beforeEach(() => {
  store = useFakeBlob();
});

afterEach(() => {
  vi.unstubAllEnvs();
  releaseFakeBlob();
});

function pointer(overrides: Partial<Parameters<typeof writePack>[3]> = {}) {
  return {
    digest: "a".repeat(64),
    pathname: `${BLOB_ROOT}/games/demo/a.json`,
    publishedAt: "2026-10-17T00:00:00.000Z",
    receivedAt: "2026-10-17T00:00:00.000Z",
    sceneCount: 3,
    title: "测试游戏",
    warningCount: 0,
    ...overrides,
  };
}

describe("Blob 配置探测", () => {
  it("没有凭据时报告未接入，并给出可读原因", () => {
    const config = readBlobConfig({});
    expect(config.configured).toBe(false);
    if (!config.configured) expect(config.reason).toContain("Blob");
  });

  it("有读写 token 时视为已接入", () => {
    expect(readBlobConfig({ BLOB_READ_WRITE_TOKEN: "x" }).configured).toBe(true);
  });

  it("OIDC 需要 token 与 storeId 同时存在", () => {
    expect(readBlobConfig({ VERCEL_OIDC_TOKEN: "x" }).configured).toBe(false);
    expect(readBlobConfig({ VERCEL_OIDC_TOKEN: "x", BLOB_STORE_ID: "y" }).configured).toBe(true);
  });

  it("本机联调的内存后端可被识别，并被标记为 ephemeral", () => {
    const config = readBlobConfig({ MOS_CLOUD_BLOB_MEMORY: "1" });
    expect(config.configured).toBe(true);
    if (config.configured) expect(config.ephemeral).toBe(true);
  });

  it("部署在 Vercel 上时即使设了内存开关也不启用（必须走真实 Blob）", () => {
    const config = readBlobConfig({ MOS_CLOUD_BLOB_MEMORY: "1", VERCEL: "1" });
    expect(config.configured).toBe(false);
  });

  it("没设内存开关时不会被误判为可用", () => {
    expect(readBlobConfig({}).configured).toBe(false);
  });
});

describe("包体读写", () => {
  it("写入后能原样读回", async () => {
    const body = JSON.stringify({ id: "demo", title: "测试" });
    await writePack("demo", "a".repeat(64), body, pointer());
    expect(await readPublishedPack("demo", "a".repeat(64))).toBe(body);
  });

  it("不存在的包体返回 null，不抛错", async () => {
    expect(await readPublishedPack("nope", "b".repeat(64))).toBeNull();
  });

  it("同一摘要重复写入不会产生第二份对象（幂等）", async () => {
    const digest = "c".repeat(64);
    await writePack("demo", digest, "{}", pointer({ digest }));
    const firstCount = store.puts.length;
    await writePack("demo", digest, "{}", pointer({ digest }));
    // 第二次只重写元数据，不再写包体。
    expect(store.puts.length).toBe(firstCount + 1);
    expect(store.puts.filter((p) => p.endsWith(`${digest}.json`))).toHaveLength(1);
  });

  it("元数据可读回，且 record 里保留 digest 与站数", async () => {
    const digest = "d".repeat(64);
    await writePack("demo", digest, "{}", pointer({ digest, sceneCount: 5 }));
    const meta = await readPackMeta("demo", digest);
    expect(meta?.digest).toBe(digest);
    expect(meta?.sceneCount).toBe(5);
  });

  it("存储抛出访问错误时归类为 unavailable", async () => {
    store.putFailure = () => new BlobBackendError("unavailable", "bad token");
    await expect(writePack("demo", "e".repeat(64), "{}", pointer())).rejects.toMatchObject({
      name: "BlobStoreError",
      kind: "unavailable",
    });
  });
});

describe("已发布索引", () => {
  it("第一次读取时返回空索引（store 还是空的）", async () => {
    const index = await readIndex();
    expect(index.games).toEqual({});
  });

  it("写入后能读回，且索引里只保留当前版本指针", async () => {
    await updateIndexEntry("demo", () => pointer());
    const index = await readIndex();
    expect(index.games.demo.digest).toBe("a".repeat(64));
  });

  it("更新同一 id 会替换指针而不是追加第二条", async () => {
    await updateIndexEntry("demo", () => pointer({ digest: "1".repeat(64) }));
    await updateIndexEntry("demo", () => pointer({ digest: "2".repeat(64) }));
    const index = await readIndex();
    expect(Object.keys(index.games)).toEqual(["demo"]);
    expect(index.games.demo.digest).toBe("2".repeat(64));
  });

  it("并发写入：条件不满足时重试后仍然合并，不丢条目", async () => {
    await updateIndexEntry("demo", () => pointer());
    // 模拟「读完之后别人改了一次」：第一次写索引抛前置条件失败，第二次应成功。
    let calls = 0;
    const originalWrite = store.write.bind(store);
    store.write = async (pathname: string, text: string, options?: Parameters<typeof store.write>[2]) => {
      if (pathname === INDEX_PATHNAME && calls === 0) {
        calls += 1;
        throw new BlobBackendError("conflict", "precondition failed");
      }
      return originalWrite(pathname, text, options);
    };
    const result = await updateIndexEntry("demo", () => pointer({ digest: "3".repeat(64) }));
    expect(result.retried).toBe(true);
    const index = await readIndex();
    expect(index.games.demo.digest).toBe("3".repeat(64));
  });

  it("持续并发冲突时抛出可重试的错误，而不是静默丢弃", async () => {
    store.write = async (pathname: string) => {
      if (pathname === INDEX_PATHNAME) throw new BlobBackendError("conflict", "precondition failed");
      throw new Error("unexpected");
    };
    await expect(updateIndexEntry("demo", () => pointer(), 2)).rejects.toBeInstanceOf(BlobStoreError);
  });

  it("mutate 返回 null 时不写索引（表示无需更新）", async () => {
    const before = store.puts.length;
    await updateIndexEntry("demo", () => null);
    expect(store.puts.length).toBe(before);
  });

  it("索引文件损坏时降级为空索引，不让目录整体 500", async () => {
    await store.write(INDEX_PATHNAME, "{ broken", { access: "private", allowOverwrite: true } as never);
    const index = await readIndex();
    expect(index.games).toEqual({});
  });

  it("首次写索引不带 ifMatch，第二次改写必须带（条件写入真的生效）", async () => {
    await updateIndexEntry("demo", () => pointer());
    await updateIndexEntry("demo", () => pointer({ digest: "9".repeat(64) }));
    const indexWrites = store.putOptions.filter((item) => item.pathname === INDEX_PATHNAME);
    expect(indexWrites).toHaveLength(2);
    expect(indexWrites[0].hadIfMatch).toBe(false);
    expect(indexWrites[1].hadIfMatch).toBe(true);
  });
});

describe("草稿目录", () => {
  it("初始为空", async () => {
    expect((await readDrafts()).games).toEqual([]);
  });

  it("同 id 覆盖而不是追加", async () => {
    const base = {
      id: "demo",
      title: "草稿",
      author: "某人",
      description: "说明",
      language: "zh-CN",
      sceneCount: 2,
      status: "draft" as const,
      packFile: "demo.json",
      digest: "a".repeat(64),
      receivedAt: "2026-10-17T00:00:00.000Z",
    };
    await upsertDraft(base);
    const second = await upsertDraft({ ...base, title: "改过" });
    expect(second.updated).toBe(true);
    const drafts = await readDrafts();
    expect(drafts.games).toHaveLength(1);
    expect(drafts.games[0].title).toBe("改过");
  });
});
