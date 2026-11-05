/**
 * Public read gate for the exploration surface.
 *
 * The property under test is negative and absolute: nothing that is not exactly
 * `published` in the catalogue may be listed or served, and no id that is not in
 * the catalogue may be probed. The pack file is the same one `/content/<file>`
 * serves, so the traversal rule is asserted here too.
 */

import { describe, expect, it, vi } from "vitest";
import type { CloudCatalog, CloudGameEntry } from "@/lib/cloud";
import {
  categoryCounts,
  getPublicExplorePack,
  listPublicExplorePacks,
  publicEntries,
  type ExploreSource,
} from "@/lib/explore/service";

function entry(over: Partial<CloudGameEntry> & { id: string }): CloudGameEntry {
  return {
    title: `包 ${over.id}`,
    author: "作者",
    description: "一句话说明。",
    language: "zh-CN",
    sceneCount: 1,
    status: "published",
    packFile: `${over.id}.json`,
    ...over,
  };
}

function pack(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    title: `包 ${id}`,
    description: "第一句话说明这是什么。第二句话继续。",
    language: "zh-CN",
    scenes: [
      { id: "s1", title: "一", story: "x", location: { lat: 1, lng: 1, radius: 10 } },
      { id: "s2", title: "二", story: "x", location: { lat: 1, lng: 1, radius: 10 } },
    ],
    ...extra,
  });
}

function makeSource(games: CloudGameEntry[], files: Record<string, string | null>) {
  const catalog: CloudCatalog = { version: "t", updatedAt: "2026-11-05", games };
  const readPackFile = vi.fn(async (file: string) => files[file] ?? null);
  const source: ExploreSource = { catalog, readPackFile };
  return { source, readPackFile };
}

describe("公开读取权限 — 只有 published 可见", () => {
  const games = [
    entry({ id: "published-pack" }),
    entry({ id: "draft-pack", status: "draft" }),
    entry({ id: "unlisted-pack", status: "unlisted" }),
    entry({ id: "archived-pack", status: "archived" }),
  ];
  const files = {
    "published-pack.json": pack("published-pack"),
    "draft-pack.json": pack("draft-pack"),
    "unlisted-pack.json": pack("unlisted-pack"),
    "archived-pack.json": pack("archived-pack"),
  };

  it("列表只包含 published", async () => {
    const { source } = makeSource(games, files);
    const packs = await listPublicExplorePacks(source);
    expect(packs.map((p) => p.gameId)).toEqual(["published-pack"]);
  });

  it("草稿、未公开、撤回的详情一律 404（返回 null）", async () => {
    const { source } = makeSource(games, files);
    expect(await getPublicExplorePack("draft-pack", source)).toBeNull();
    expect(await getPublicExplorePack("unlisted-pack", source)).toBeNull();
    expect(await getPublicExplorePack("archived-pack", source)).toBeNull();
  });

  it("不存在的 id 与不可见 id 结果完全一致", async () => {
    const { source } = makeSource(games, files);
    expect(await getPublicExplorePack("never-existed", source)).toBeNull();
    expect(await getPublicExplorePack("draft-pack", source)).toBeNull();
  });

  it("不可见的包连文件都不会被读取", async () => {
    const { source, readPackFile } = makeSource(games, files);
    await listPublicExplorePacks(source);
    const readFiles = readPackFile.mock.calls.map(([file]) => file);
    expect(readFiles).toEqual(["published-pack.json"]);
  });
});

describe("公开读取权限 — 文件与目录规则", () => {
  it("文件缺失或不是合法 JSON 的包被跳过，其余照常列出", async () => {
    const games = [
      entry({ id: "ok-pack" }),
      entry({ id: "missing-pack" }),
      entry({ id: "broken-pack" }),
    ];
    const { source } = makeSource(games, {
      "ok-pack.json": pack("ok-pack"),
      "broken-pack.json": "{ not json",
    });
    const packs = await listPublicExplorePacks(source);
    expect(packs.map((p) => p.gameId)).toEqual(["ok-pack"]);
    expect(await getPublicExplorePack("missing-pack", source)).toBeNull();
    expect(await getPublicExplorePack("broken-pack", source)).toBeNull();
  });

  it("路径穿越与非 .json 文件名在读取前就被拒绝", async () => {
    const games = [
      entry({ id: "escape", packFile: "../secrets.json" }),
      entry({ id: "escape2", packFile: "..%2Fsecrets.json" }),
      entry({ id: "notjson", packFile: "pack.txt" }),
      entry({ id: "absolute", packFile: "/etc/passwd.json" }),
    ];
    const { source, readPackFile } = makeSource(games, {});
    expect(publicEntries(source.catalog)).toEqual([]);
    expect(await listPublicExplorePacks(source)).toEqual([]);
    expect(readPackFile).not.toHaveBeenCalled();
  });

  it("没有场景的包不会被渲染成半张卡", async () => {
    const games = [entry({ id: "empty-pack" })];
    const { source } = makeSource(games, {
      "empty-pack.json": JSON.stringify({ id: "empty-pack", title: "空", scenes: [] }),
    });
    expect(await listPublicExplorePacks(source)).toEqual([]);
    expect(await getPublicExplorePack("empty-pack", source)).toBeNull();
  });
});

describe("数据诚实性 — 不虚构包内没有的事实", () => {
  it("包没有声明时长/难度时不补默认值", async () => {
    const games = [entry({ id: "bare-pack" })];
    const { source } = makeSource(games, { "bare-pack.json": pack("bare-pack") });
    const [only] = await listPublicExplorePacks(source);
    expect(only.minutes).toBeNull();
    expect(only.difficulty).toBeNull();
    expect(only.areaMeters).toBeNull();
    expect(only.place).toBeNull();
    expect(only.sceneCount).toBe(2);
  });

  it("站点数、时长、难度来自包本身，而不是目录摘要", async () => {
    const games = [
      entry({ id: "declared", sceneCount: 99, estimatedMinutes: 999, difficulty: "hard" }),
    ];
    const { source } = makeSource(games, {
      "declared.json": pack("declared", {
        estimatedMinutes: 25,
        difficulty: "easy",
        huntArea: { center: { lat: 1, lng: 1 }, radiusMeters: 350 },
        startLocation: { lat: 1, lng: 1, name: "集合点" },
      }),
    });
    const [only] = await listPublicExplorePacks(source);
    expect(only.sceneCount).toBe(2);
    expect(only.minutes).toBe(25);
    expect(only.difficulty).toBe("easy");
    expect(only.areaMeters).toBe(350);
    expect(only.place).toBe("集合点");
  });

  it("视图模型没有评分、参与人数一类字段", async () => {
    const games = [entry({ id: "p" })];
    const { source } = makeSource(games, { "p.json": pack("p") });
    const [only] = await listPublicExplorePacks(source);
    for (const key of ["rating", "participants", "popularity", "stars", "reviews"]) {
      expect(Object.keys(only)).not.toContain(key);
    }
  });

  it("分类计数只统计真实存在分类的包", async () => {
    const games = [entry({ id: "p" })];
    const { source } = makeSource(games, { "p.json": pack("p") });
    const packs = await listPublicExplorePacks(source);
    // 无编辑标注 -> 无分类 -> 三个分类计数全为 0，且不虚构分类
    expect(categoryCounts(packs)).toEqual([]);
  });
});

describe("生产数据源 — 真实已发布内容", () => {
  it("生产目录里唯一的公开包可以被真实读取，且字段来自包本身", async () => {
    const packs = await listPublicExplorePacks();
    expect(packs.length).toBeGreaterThan(0);
    const pack = packs.find((p) => p.gameId === "rizal-park-discovery");
    expect(pack).toBeDefined();
    expect(pack!.packFile).toBe("rizal-park-discovery.json");
    expect(pack!.sceneCount).toBe(5);
    expect(pack!.minutes).toBe(25);
    expect(pack!.difficulty).toBe("easy");
    expect(pack!.areaMeters).toBe(350);
    expect(pack!.category).toBe("culture-history");
  });

  it("每个列出的包都能被详情接口再次读到（列表与详情不漂移）", async () => {
    const packs = await listPublicExplorePacks();
    for (const pack of packs) {
      const detail = await getPublicExplorePack(pack.gameId);
      expect(detail).not.toBeNull();
      expect(detail!.gameId).toBe(pack.gameId);
      expect(detail!.sceneCount).toBe(pack.sceneCount);
    }
  });
});
