// @vitest-environment jsdom
/**
 * 离线缓存在 IndexedDB 可用时的行为，以及「清理重复缓存」的安全边界。
 *
 * The one rule that must never break: the localStorage mirror is only removed
 * when a structurally VALID copy exists in IndexedDB. A missing or corrupt
 * IndexedDB value means the mirror may be the only readable offline copy, and
 * deleting it on a guess is exactly the data loss this module must not cause.
 *
 * `fake-indexeddb` provides a real IndexedDB implementation so the idb-keyval
 * code path (not just the localStorage fallback) is exercised.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@/lib/game/types";
import {
  cacheGameContent,
  clearCachedGameContent,
  pruneDuplicatedContentCache,
  readCachedGameContent,
} from "@/lib/storage";

const CONTENT_KEY_PREFIX = "mos-scene-hunt:content:";

const idbState = vi.hoisted(() => ({ failGet: false }));

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    get: async (key: IDBValidKey, store?: unknown) => {
      if (idbState.failGet) throw new Error("simulated IndexedDB failure");
      return actual.get(key, store as never);
    },
  };
});

function makeGame(id: string): Game {
  return {
    id,
    language: "zh-CN",
    title: `缓存测试 ${id}`,
    description: "用于验证离线缓存",
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

function mirrorKey(gameId: string): string {
  return `${CONTENT_KEY_PREFIX}${gameId}`;
}

beforeEach(() => {
  window.localStorage.clear();
  idbState.failGet = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IndexedDB 可用时", () => {
  it("缓存写入 IndexedDB，不再镜像到 localStorage", async () => {
    await cacheGameContent(makeGame("cache-idb-only"));
    expect(window.localStorage.getItem(mirrorKey("cache-idb-only"))).toBeNull();
    const hit = await readCachedGameContent("cache-idb-only");
    expect(hit?.game.title).toBe("缓存测试 cache-idb-only");
    expect(typeof hit?.cachedAt).toBe("number");
  });

  it("清理重复缓存：IndexedDB 有有效副本时才删除镜像", async () => {
    await cacheGameContent(makeGame("cache-valid"));
    window.localStorage.setItem(mirrorKey("cache-valid"), '{"cachedAt":1,"game":{}}');

    const result = await pruneDuplicatedContentCache();

    expect(result.removedIds).toEqual(["cache-valid"]);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(window.localStorage.getItem(mirrorKey("cache-valid"))).toBeNull();
    // 权威副本仍然可读，清理没有造成任何损失。
    expect((await readCachedGameContent("cache-valid"))?.game.id).toBe("cache-valid");
  });

  it("IndexedDB 没有对应副本时，镜像被保留（它可能是唯一离线副本）", async () => {
    const onlyCopy = '{"cachedAt":1,"game":{"id":"cache-kept"}}';
    window.localStorage.setItem(mirrorKey("cache-kept"), onlyCopy);

    const result = await pruneDuplicatedContentCache();

    expect(result.removedIds).toEqual([]);
    expect(window.localStorage.getItem(mirrorKey("cache-kept"))).toBe(onlyCopy);
    expect((await readCachedGameContent("cache-kept"))?.game.id).toBe("cache-kept");
  });

  it("IndexedDB 副本损坏（缺 game 字段）时，镜像被保留", async () => {
    // 先正常缓存一次，再用原生 IndexedDB 把同一 store 里的值改写成
    // 损坏但非空的结构（不能走 idb-keyval 的默认 store）。
    await cacheGameContent(makeGame("cache-corrupt"));
    window.localStorage.setItem(mirrorKey("cache-corrupt"), '{"cachedAt":2,"game":{"id":"cache-corrupt"}}');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mos-scene-hunt");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("content", "readwrite");
        tx.objectStore("content").put({ cachedAt: 1, broken: true }, mirrorKey("cache-corrupt"));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }

    const result = await pruneDuplicatedContentCache();

    expect(result.removedIds).toEqual([]);
    expect(window.localStorage.getItem(mirrorKey("cache-corrupt"))).not.toBeNull();
  });

  it("IndexedDB 读取抛错时，镜像被保留，清理本身不失败", async () => {
    window.localStorage.setItem(mirrorKey("cache-idb-down"), '{"cachedAt":1,"game":{"id":"x"}}');
    idbState.failGet = true;

    const result = await pruneDuplicatedContentCache();

    expect(result.removedIds).toEqual([]);
    expect(window.localStorage.getItem(mirrorKey("cache-idb-down"))).not.toBeNull();
  });

  it("删除一个包会同时清掉它的 IndexedDB 副本与 localStorage 镜像", async () => {
    await cacheGameContent(makeGame("cache-doomed"));
    window.localStorage.setItem(mirrorKey("cache-doomed"), "mirror");

    await clearCachedGameContent("cache-doomed");

    expect(window.localStorage.getItem(mirrorKey("cache-doomed"))).toBeNull();
    expect(await readCachedGameContent("cache-doomed")).toBeNull();
  });
});
