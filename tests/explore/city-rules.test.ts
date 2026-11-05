/**
 * City association rules.
 *
 * Product rule: a city archive may only exist because a real, publicly readable
 * pack exists; browsing, searching or listing must never create one.
 *
 * This build satisfies that rule structurally rather than by adding a guard:
 * the production pack schema has no city field and production has no city store,
 * so the exploration surface derives a city label from a pack and offers no
 * write path at all. There is nothing to browse that could create anything.
 *
 * These tests lock that in — if a future change adds a city write path or starts
 * synthesising a city label, they fail.
 */

import { describe, expect, it } from "vitest";
import * as service from "@/lib/explore/service";
import { availableCities, summarizePack, type ExplorePack } from "@/lib/explore/summary";
import { CLOUD_CATALOG } from "@/lib/cloud/catalog";

const packJson = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id,
    title: `包 ${id}`,
    description: "说明。",
    scenes: [{ id: "s1", title: "一", story: "x", location: { lat: 1, lng: 1, radius: 10 } }],
    ...extra,
  });

describe("城市档案 — 先有真实探索包", () => {
  it("没有包声明城市时，城市列表为空（不生成空档案）", async () => {
    const source: service.ExploreSource = {
      catalog: {
        version: "t",
        updatedAt: "2026-11-05",
        games: [
          {
            id: "no-city-pack",
            title: "无城市",
            author: "作者",
            description: "说明",
            language: "zh-CN",
            sceneCount: 1,
            status: "published",
            packFile: "no-city-pack.json",
          },
        ],
      },
      readPackFile: async () => packJson("no-city-pack"),
    };
    const packs = await service.listPublicExplorePacks(source);
    expect(packs).toHaveLength(1);
    expect(packs[0].city).toBeNull();
    expect(availableCities(packs)).toEqual([]);
  });

  it("城市只由真实包派生：计数永远大于零", () => {
    const base = summarizePack(
      JSON.parse(packJson("p")),
      { gameId: "p", updatedAt: "2026-11-05", packFile: "p.json" },
      null,
    ) as ExplorePack;
    const packs: ExplorePack[] = [
      { ...base, gameId: "a", city: { cityId: "x", name: "X 城" } },
      { ...base, gameId: "b", city: { cityId: "x", name: "X 城" } },
      { ...base, gameId: "c", city: null },
    ];
    const cities = availableCities(packs);
    expect(cities).toEqual([{ cityId: "x", name: "X 城", count: 2 }]);
    for (const city of cities) expect(city.count).toBeGreaterThan(0);
  });

  it("生产目录与真实包目前没有任何城市声明（不虚构城市）", async () => {
    const packs = await service.listPublicExplorePacks();
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs) expect(pack.city).toBeNull();
    expect(availableCities(packs)).toEqual([]);
  });
});

describe("城市档案 — 浏览不写入", () => {
  it("探索服务不导出任何创建/写入城市或内容的入口", () => {
    const writeLike = Object.keys(service).filter((name) =>
      /create|ensure|upsert|write|register|archive|sync/i.test(name),
    );
    expect(writeLike).toEqual([]);
  });

  it("反复列目录不会改变生产目录（只读）", async () => {
    const before = JSON.stringify(CLOUD_CATALOG);
    await service.listPublicExplorePacks();
    await service.listPublicExplorePacks();
    await service.getPublicExplorePack("rizal-park-discovery");
    expect(JSON.stringify(CLOUD_CATALOG)).toBe(before);
  });

  it("生产目录里每条城市信息都必须能在真实公开包中找到来源", async () => {
    const packs = await service.listPublicExplorePacks();
    const declaredCities = new Set(
      packs.filter((p) => p.city).map((p) => p.city!.cityId),
    );
    for (const city of availableCities(packs)) {
      expect(declaredCities.has(city.cityId)).toBe(true);
    }
    // 目录本身不携带城市字段：城市不可能来自目录这一层。
    for (const game of CLOUD_CATALOG.games) {
      expect(Object.keys(game)).not.toContain("cityId");
      expect(Object.keys(game)).not.toContain("cityName");
    }
  });
});
