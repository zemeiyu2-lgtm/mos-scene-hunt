// @vitest-environment jsdom
/**
 * IndexedDB 不可用时的离线缓存回退（无痕浏览等环境）。
 *
 * jsdom does not provide `indexedDB`, so `lib/storage` compiles its content
 * store to `null` — exactly the "IndexedDB blocked" shape. The fallback must
 * keep the hunt playable (mirror in localStorage) and the cache cleanup must
 * stay a strict no-op: without IndexedDB there is nothing that can prove a
 * mirror is redundant, so no mirror may be deleted.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Game } from "@/lib/game/types";
import {
  cacheGameContent,
  clearCachedGameContent,
  pruneDuplicatedContentCache,
  readCachedGameContent,
} from "@/lib/storage";

const CONTENT_KEY_PREFIX = "mos-scene-hunt:content:";

function makeGame(id: string): Game {
  return {
    id,
    language: "zh-CN",
    title: `回退测试 ${id}`,
    description: "IndexedDB 不可用",
    version: "0.1.0",
    startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
    huntArea: {
      center: { lat: 14.58305, lng: 120.97936 },
      radiusMeters: 300,
      shape: "circle",
      name: "区域",
    },
    entrySceneId: "s1",
    scenes: [
      {
        id: "s1",
        title: "第一站",
        story: "故事",
        location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "第一站" },
        nextSceneId: null,
        challenge: { type: "choice", question: "选哪个？", options: ["甲", "乙"], answer: 0 },
        reward: { type: "keyword", title: "线索", value: "线索" },
      },
    ],
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("IndexedDB 不可用时", () => {
  it("缓存回退写入 localStorage，仍可完整读回", async () => {
    await cacheGameContent(makeGame("fallback-a"));
    expect(window.localStorage.getItem(`${CONTENT_KEY_PREFIX}fallback-a`)).not.toBeNull();

    const hit = await readCachedGameContent("fallback-a");
    expect(hit?.game.id).toBe("fallback-a");
    expect(hit?.game.title).toBe("回退测试 fallback-a");
    expect(typeof hit?.cachedAt).toBe("number");
  });

  it("清理重复缓存是严格 no-op：不证明有 IndexedDB 副本前一个镜像都不删", async () => {
    await cacheGameContent(makeGame("fallback-keep"));
    const mirror = window.localStorage.getItem(`${CONTENT_KEY_PREFIX}fallback-keep`);
    expect(mirror).not.toBeNull();

    const result = await pruneDuplicatedContentCache();

    expect(result.removedIds).toEqual([]);
    expect(result.freedBytes).toBe(0);
    expect(window.localStorage.getItem(`${CONTENT_KEY_PREFIX}fallback-keep`)).toBe(mirror);
  });

  it("删除缓存只清目标键，不抛错", async () => {
    await cacheGameContent(makeGame("fallback-del"));
    await cacheGameContent(makeGame("fallback-keep2"));

    await clearCachedGameContent("fallback-del");

    expect(window.localStorage.getItem(`${CONTENT_KEY_PREFIX}fallback-del`)).toBeNull();
    expect(await readCachedGameContent("fallback-keep2")).not.toBeNull();
  });
});
