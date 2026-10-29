// @vitest-environment jsdom
/**
 * 本机游戏包盘点与「只删本机副本」的边界。
 *
 * What these tests protect, in plain terms:
 *  1. the panel's idea of "a stored pack" is the same storage key the editor
 *     writes (`mos-scene-hunt:authoring:<id>`) - if the two ever drift, every
 *     pack silently disappears from the panel;
 *  2. the numbers are the real UTF-8 bytes, not a guess;
 *  3. deleting one pack never touches another pack, another pack's progress,
 *     or any server state - there is no network call on this path at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAuthoredGameChecked, markCurrentAuthoredGame, getActiveAuthoredGameId } from "@/lib/content";
import type { Game } from "@/lib/game/types";
import { formatBytes, utf8ByteLength } from "@/lib/storage/bytes";
import {
  AUTHORING_PREFIX,
  authoringKey,
  deleteLocalPack,
  describeStoragePressure,
  estimateBrowserStorage,
  measureLocalPacks,
  type BrowserStorageEstimate,
} from "@/lib/storage/local-pack";

const SAVE_KEY_PREFIX = "mos-scene-hunt:save:";
const CONTENT_KEY_PREFIX = "mos-scene-hunt:content:";

function makeGame(id: string, title = `游戏 ${id}`): Game {
  return {
    id,
    language: "zh-CN",
    title,
    description: "测试用游戏包",
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

/** A game whose scene carries an inlined base64 photo, like the real editor. */
function withInlineMedia(id: string, dataUrlLength = 400_000): Game {
  const game = makeGame(id);
  game.scenes[0].media = [
    {
      id: "media-1",
      kind: "image",
      title: "现场照片.jpg",
      url: "data:image/jpeg;base64," + "A".repeat(dataUrlLength),
      mimeType: "image/jpeg",
    },
  ];
  return game;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("本机游戏包盘点", () => {
  it("识别 lib/content 真实写入的游戏包（键名没有漂移）", () => {
    const game = makeGame("inventory-a", "会合点");
    expect(saveAuthoredGameChecked(game).ok).toBe(true);

    const inventory = measureLocalPacks();
    expect(inventory.storageAvailable).toBe(true);
    expect(inventory.packs.map((pack) => pack.id)).toEqual(["inventory-a"]);
    expect(inventory.packs[0].title).toBe("会合点");
    expect(inventory.packs[0].valid).toBe(true);
  });

  it("单包字节数等于存储内容的 UTF-8 字节，合计等于各项之和", () => {
    saveAuthoredGameChecked(makeGame("bytes-a"));
    saveAuthoredGameChecked(makeGame("bytes-b"));

    const inventory = measureLocalPacks();
    const expected = inventory.packs.reduce(
      (sum, pack) => sum + utf8ByteLength(window.localStorage.getItem(authoringKey(pack.id))!),
      0,
    );
    expect(inventory.totalBytes).toBe(expected);
    for (const pack of inventory.packs) {
      expect(pack.bytes).toBe(
        utf8ByteLength(window.localStorage.getItem(`${AUTHORING_PREFIX}${pack.id}`)!),
      );
    }
  });

  it("内嵌图片单独计量，因为它是作者真正能压缩的部分", () => {
    saveAuthoredGameChecked(withInlineMedia("media-heavy"));
    const pack = measureLocalPacks().packs[0];
    expect(pack.mediaCount).toBe(1);
    expect(pack.embeddedMediaBytes).toBeGreaterThan(400_000);
    expect(pack.embeddedMediaBytes).toBeLessThan(pack.bytes);
  });

  it("无法解析的记录仍然列出并计入占用，否则删不掉也看不见", () => {
    window.localStorage.setItem(`${AUTHORING_PREFIX}broken-pack`, "{ 这不是 JSON");
    const inventory = measureLocalPacks();
    expect(inventory.packs).toHaveLength(1);
    expect(inventory.packs[0].valid).toBe(false);
    expect(inventory.packs[0].id).toBe("broken-pack");
    expect(inventory.unreadableCount).toBe(1);
    expect(inventory.totalBytes).toBeGreaterThan(0);
  });

  it("标记出当前正在使用的那一份", () => {
    saveAuthoredGameChecked(makeGame("current-a"));
    saveAuthoredGameChecked(makeGame("current-b"));
    markCurrentAuthoredGame("current-b");
    const current = measureLocalPacks().packs.find((pack) => pack.isCurrent);
    expect(current?.id).toBe("current-b");
  });
});

describe("只删除本机副本", () => {
  it("只删除目标包，其他包与它们各自的进度原样保留", async () => {
    saveAuthoredGameChecked(makeGame("keep-me"));
    saveAuthoredGameChecked(makeGame("delete-me"));

    const otherRaw = window.localStorage.getItem(authoringKey("keep-me"));
    const otherProgressKey = SAVE_KEY_PREFIX + encodeURIComponent("keep-me");
    window.localStorage.setItem(otherProgressKey, '{"schemaVersion":1}');

    const result = await deleteLocalPack("delete-me");

    expect(result.ok).toBe(true);
    expect(window.localStorage.getItem(authoringKey("delete-me"))).toBeNull();
    expect(window.localStorage.getItem(authoringKey("keep-me"))).toBe(otherRaw);
    expect(window.localStorage.getItem(otherProgressKey)).toBe('{"schemaVersion":1}');
    expect(measureLocalPacks().packs.map((pack) => pack.id)).toEqual(["keep-me"]);
  });

  it("同时回收这份包自己的进度与离线缓存，否则空间并没有真的释放", async () => {
    saveAuthoredGameChecked(makeGame("clean-me"));
    const progressKey = SAVE_KEY_PREFIX + encodeURIComponent("clean-me");
    const contentKey = CONTENT_KEY_PREFIX + "clean-me";
    window.localStorage.setItem(progressKey, '{"schemaVersion":1}');
    window.localStorage.setItem(contentKey, '{"cachedAt":1}');

    await deleteLocalPack("clean-me");

    expect(window.localStorage.getItem(progressKey)).toBeNull();
    expect(window.localStorage.getItem(contentKey)).toBeNull();
  });

  it("报告释放的字节数", async () => {
    saveAuthoredGameChecked(makeGame("measured"));
    const bytes = measureLocalPacks().packs[0].bytes;
    const result = await deleteLocalPack("measured");
    expect(result.ok && result.freedBytes).toBe(bytes);
  });

  it("只在它正是当前游戏时才重置播放指针", async () => {
    saveAuthoredGameChecked(makeGame("pointer-a"));
    saveAuthoredGameChecked(makeGame("pointer-b"));
    markCurrentAuthoredGame("pointer-a");

    await deleteLocalPack("pointer-b");
    expect(getActiveAuthoredGameId()).toBe("pointer-a");

    const result = await deleteLocalPack("pointer-a");
    expect(result.ok && result.wasCurrent).toBe(true);
    expect(getActiveAuthoredGameId()).toBeNull();
  });

  it("删除不触发任何网络请求（不可能碰到线上游戏）", async () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      saveAuthoredGameChecked(makeGame("offline-delete"));
      await deleteLocalPack("offline-delete");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("不存在的包如实报告失败，而不是假装删除成功", async () => {
    const result = await deleteLocalPack("never-existed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stillStored).toBe(false);
  });

  it("浏览器拒绝写入时保留数据并给出原因", async () => {
    saveAuthoredGameChecked(makeGame("locked"));
    const base = window.localStorage;
    // jsdom's Storage is an exotic object, so overriding one method has to go
    // through a delegating wrapper rather than a property assignment.
    const blocked = {
      get length() {
        return base.length;
      },
      clear: () => base.clear(),
      getItem: (key: string) => base.getItem(key),
      key: (index: number) => base.key(index),
      setItem: (key: string, value: string) => base.setItem(key, value),
      removeItem: () => {
        throw new Error("SecurityError");
      },
    } as Storage;
    Object.defineProperty(window, "localStorage", { configurable: true, value: blocked });
    try {
      const result = await deleteLocalPack("locked");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.stillStored).toBe(true);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: base });
    }
    expect(window.localStorage.getItem(authoringKey("locked"))).not.toBeNull();
  });
});

describe("容量估算的降级", () => {
  it("浏览器没有 storage.estimate 时明确报告不可用，不编造数值", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "storage");
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
    try {
      const estimate = await estimateBrowserStorage();
      expect(estimate.supported).toBe(false);
      expect(estimate.usage).toBeNull();
      expect(estimate.quota).toBeNull();
    } finally {
      if (original) Object.defineProperty(navigator, "storage", original);
    }
  });

  it("API 不可用时提示里不含编造的额度，但仍说明已测得的占用", () => {
    const pressure = describeStoragePressure(
      { packs: [{ bytes: 1_200_000 }], totalBytes: 1_200_000 } as never,
      { supported: false, usage: null, quota: null, persisted: null, persistedSupported: false },
      formatBytes,
    );
    expect(pressure.level).toBe("unknown");
    expect(pressure.ratio).toBeNull();
    expect(pressure.note).not.toMatch(/\d+(\.\d+)?\s*MB/);
    expect(pressure.note).toContain("容量估算");
  });

  it("接近上限时给出明确处理方式，并声明这是估算值而非手机磁盘空间", () => {
    const estimate: BrowserStorageEstimate = {
      supported: true,
      usage: 4_800_000,
      quota: 5_000_000,
      persisted: false,
      persistedSupported: true,
    };
    const pressure = describeStoragePressure(
      { packs: [{ bytes: 4_500_000 }], totalBytes: 4_500_000 } as never,
      estimate,
      formatBytes,
    );
    expect(pressure.level).toBe("critical");
    expect(pressure.note).toContain("删除");
    expect(pressure.note).toContain("不是手机的可用磁盘空间");
  });

  it("空间充裕时不做多余警告", () => {
    const pressure = describeStoragePressure(
      { packs: [{ bytes: 1000 }], totalBytes: 1000 } as never,
      { supported: true, usage: 1000, quota: 5_000_000, persisted: true, persistedSupported: true },
      formatBytes,
    );
    expect(pressure.level).toBe("ok");
    expect(pressure.note).not.toContain("删除不再需要的本地副本");
  });
});
