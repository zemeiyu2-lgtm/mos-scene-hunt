import { describe, expect, it } from "vitest";
import {
  mergeCatalogs,
  pointerToCatalogEntry,
  type RawCatalogEntry,
} from "../../lib/cloud/catalog-source";

/**
 * 目录合并的纯逻辑单测。
 *
 * 这条逻辑决定「玩家究竟能看到什么」，所以单独锁住三个契约：
 *   1. 仓库内容层（静态示范游戏）永远保留；
 *   2. 同 id 时以 Blob 已发布版本为准（明确的发布动作胜过仓库副本）；
 *   3. 不可下载的条目一律隐藏，并计入 hidden 统计。
 *
 * 这里刻意不碰文件系统与网络：isPlayable 由用例直接给定，断言只关心合并与过滤。
 */

function repo(id: string, extra: Partial<RawCatalogEntry> = {}): RawCatalogEntry {
  return { id, packFile: `${id}.json`, status: "published", title: `仓库 ${id}`, ...extra };
}

function blob(id: string, digest = "a".repeat(64)): RawCatalogEntry {
  return {
    id,
    packFile: `${id}.json`,
    status: "published",
    title: `云端 ${id}`,
    digest,
    publishedAt: "2026-10-17",
  };
}

const alwaysPlayable = async () => true;
const neverPlayable = async () => false;

describe("mergeCatalogs", () => {
  it("只有仓库条目时原样保留（静态示范游戏不受影响）", async () => {
    const result = await mergeCatalogs({
      repoEntries: [repo("bsop"), repo("igsl")],
      blobEntries: [],
      isPlayable: alwaysPlayable,
    });
    expect(result.playable.map((e) => e.id)).toEqual(["bsop", "igsl"]);
    expect(result.hidden).toBe(0);
  });

  it("只有存储条目时也能进目录（新发布的游戏）", async () => {
    const result = await mergeCatalogs({
      repoEntries: [],
      blobEntries: [blob("new-one")],
      isPlayable: alwaysPlayable,
    });
    expect(result.playable.map((e) => e.id)).toEqual(["new-one"]);
  });

  it("同 id 时以存储为准，且不产生重复条目", async () => {
    const result = await mergeCatalogs({
      repoEntries: [repo("shared")],
      blobEntries: [blob("shared")],
      isPlayable: alwaysPlayable,
    });
    expect(result.playable).toHaveLength(1);
    expect(result.playable[0].title).toBe("云端 shared");
    expect(result.playable[0].digest).toBe("a".repeat(64));
  });

  it("仓库与存储的条目会合并成一份目录，顺序是仓库在前", async () => {
    const result = await mergeCatalogs({
      repoEntries: [repo("bsop")],
      blobEntries: [blob("fresh")],
      isPlayable: alwaysPlayable,
    });
    expect(result.playable.map((e) => e.id)).toEqual(["bsop", "fresh"]);
  });

  it("不可下载的条目被隐藏并计入 hidden", async () => {
    const result = await mergeCatalogs({
      repoEntries: [repo("ok"), repo("broken")],
      blobEntries: [blob("ghost")],
      isPlayable: async (entry) => entry.id === "ok",
    });
    expect(result.playable.map((e) => e.id)).toEqual(["ok"]);
    expect(result.hidden).toBe(2);
  });

  it("全部不可下载时返回空目录而不是报错", async () => {
    const result = await mergeCatalogs({
      repoEntries: [repo("a")],
      blobEntries: [blob("b")],
      isPlayable: neverPlayable,
    });
    expect(result.playable).toEqual([]);
    expect(result.hidden).toBe(2);
  });

  it("丢弃没有 id 的脏条目，不让它污染目录", async () => {
    const result = await mergeCatalogs({
      repoEntries: [repo("ok"), { packFile: "x.json", status: "published" } as unknown as RawCatalogEntry],
      blobEntries: [],
      isPlayable: alwaysPlayable,
    });
    expect(result.playable.map((e) => e.id)).toEqual(["ok"]);
  });

  it("可下载性检查对每条条目都真的被调用（不是按名字猜）", async () => {
    const checked: string[] = [];
    await mergeCatalogs({
      repoEntries: [repo("a"), repo("b")],
      blobEntries: [blob("c")],
      isPlayable: async (entry) => {
        checked.push(entry.id);
        return true;
      },
    });
    expect(checked.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("pointerToCatalogEntry", () => {
  const pointer = {
    digest: "b".repeat(64),
    title: "云端游戏",
    sceneCount: 4,
    publishedAt: "2026-10-17T08:30:00.000Z",
  };

  it("把指针转成目录条目，状态固定为 published", () => {
    const entry = pointerToCatalogEntry("cloud-game", pointer);
    expect(entry).toMatchObject({
      id: "cloud-game",
      title: "云端游戏",
      sceneCount: 4,
      status: "published",
      digest: pointer.digest,
      // 玩家侧下载路径不变：/content/<id>.json
      packFile: "cloud-game.json",
      publishedAt: "2026-10-17",
    });
  });

  it("缺省字段给出可用的默认值（老客户端不至于渲染出空白卡片）", () => {
    const entry = pointerToCatalogEntry("cloud-game", pointer);
    expect(entry.author).toBe("MOS Scene Hunt");
    expect(entry.description).toBe("");
    expect(entry.language).toBe("zh-CN");
  });

  it("草稿目录里的补充信息（作者、难度）会被带上", () => {
    const entry = pointerToCatalogEntry("cloud-game", pointer, {
      author: "某设计者",
      description: "一段说明",
      language: "en",
      estimatedMinutes: 15,
      difficulty: "hard",
    });
    expect(entry).toMatchObject({
      author: "某设计者",
      description: "一段说明",
      language: "en",
      estimatedMinutes: 15,
      difficulty: "hard",
    });
  });
});
