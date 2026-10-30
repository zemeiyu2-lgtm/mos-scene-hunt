// @vitest-environment jsdom
/**
 * 保存路径在"空间不够"时的行为。
 *
 * The bug being pinned: on iOS Safari a 5 MB localStorage budget is shared by
 * every pack, and one phone photo inlined as base64 is enough to blow it. What
 * must remain true no matter which way the write fails:
 *
 *   - the PREVIOUS version stays byte-for-byte intact (no half-written pack
 *     that looks saved but is not readable);
 *   - the author is told why, with the actual size and a concrete next step,
 *     instead of "保存失败" or a silent no-op.
 *
 * The quota is simulated with a real byte budget in a fake Storage, not by
 * throwing unconditionally: that also proves `setItem`'s atomicity is what
 * protects the old bytes, rather than luck.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getActiveAuthoredGameId,
  markCurrentAuthoredGame,
  readAuthoredGame,
  saveAuthoredGameChecked,
} from "@/lib/content";
import type { Game } from "@/lib/game/types";
import { formatBytes, utf8ByteLength } from "@/lib/storage/bytes";

const KEY_PREFIX = "mos-scene-hunt:authoring:";

/** A Storage that charges bytes and refuses writes that would exceed the budget. */
class BudgetedStorage implements Storage {
  private map = new Map<string, string>();

  constructor(private budget: number) {}

  private keyBytes(key: string, value: string): number {
    return utf8ByteLength(key) + utf8ByteLength(value);
  }

  private totalWithout(key: string): number {
    let total = 0;
    for (const [k, v] of this.map) if (k !== key) total += this.keyBytes(k, v);
    return total;
  }

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.totalWithout(key) + this.keyBytes(key, value) > this.budget) {
      // Same shape Safari raises; the old value must survive this.
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    this.map.set(key, value);
  }
}

const originalStorage = window.localStorage;

function useStorage(storage: Storage): void {
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}

/** Delegating wrapper so one method can be overridden without touching jsdom's Storage. */
function wrapStorage(base: Storage, overrides: Partial<Storage>): Storage {
  return {
    get length() {
      return base.length;
    },
    clear: () => base.clear(),
    getItem: (key: string) => base.getItem(key),
    key: (index: number) => base.key(index),
    removeItem: (key: string) => base.removeItem(key),
    setItem: (key: string, value: string) => base.setItem(key, value),
    ...overrides,
  } as Storage;
}

function makeGame(id = "quota-base"): Game {
  return {
    id,
    language: "zh-CN",
    title: "空间测试",
    description: "用于验证保存失败时的行为",
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

function withPhoto(game: Game, bytes = 300_000): Game {
  const next = structuredClone(game);
  next.scenes[0].media = [
    {
      id: "media-photo",
      kind: "image",
      title: "现场.jpg",
      url: "data:image/jpeg;base64," + "A".repeat(bytes),
      mimeType: "image/jpeg",
    },
  ];
  return next;
}

beforeEach(() => {
  useStorage(new BudgetedStorage(5 * 1024 * 1024));
});

afterEach(() => {
  useStorage(originalStorage);
});

describe("保存成功", () => {
  it("返回实际写入的字节数，并可从存储读回", () => {
    const game = makeGame();
    const result = saveAuthoredGameChecked(game);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(utf8ByteLength(result.serialized!));
    expect(window.localStorage.getItem(KEY_PREFIX + game.id)).toBe(result.serialized);
    expect(readAuthoredGame(game.id)?.title).toBe(game.title);
  });

  it("大体积游戏包给出可执行的提醒，但仍允许保存", () => {
    const game = withPhoto(makeGame("quota-big"), 1_600_000);
    const result = saveAuthoredGameChecked(game);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBeGreaterThan(1_500_000);
    const text = result.warnings.map((issue) => issue.message).join(" | ");
    expect(text).toContain("内嵌");
    expect(text).toContain(formatBytes(result.bytes!));
  });

  it("重复保存同一份游戏只覆盖同一个键，不会累积副本", () => {
    const game = makeGame("quota-repeat");
    for (let i = 0; i < 5; i++) saveAuthoredGameChecked(game);
    const keys = Array.from({ length: window.localStorage.length }, (_, i) =>
      window.localStorage.key(i),
    ).filter((key) => key?.startsWith(KEY_PREFIX));
    expect(keys).toEqual([KEY_PREFIX + "quota-repeat"]);
  });
});

describe("空间不足", () => {
  it("写入被拒绝时保留上一版，且不留下半成品", () => {
    const game = makeGame("quota-atomic");
    // Enough for the text-only pack, not enough for one 300 KB photo.
    useStorage(new BudgetedStorage(200_000));

    expect(saveAuthoredGameChecked(game).ok).toBe(true);
    const previous = window.localStorage.getItem(KEY_PREFIX + game.id);
    expect(previous).not.toBeNull();

    const result = saveAuthoredGameChecked(withPhoto(game, 300_000));

    expect(result.ok).toBe(false);
    expect(window.localStorage.getItem(KEY_PREFIX + game.id)).toBe(previous);
    expect(readAuthoredGame(game.id)?.scenes[0].media).toBeUndefined();
  });

  it("保存失败时，原有数据和播放指针均保持不变", () => {
    useStorage(new BudgetedStorage(200_000));
    const game = makeGame("quota-pointer");
    expect(saveAuthoredGameChecked(game).ok).toBe(true);
    markCurrentAuthoredGame("quota-pointer");
    expect(getActiveAuthoredGameId()).toBe("quota-pointer");

    const result = saveAuthoredGameChecked(withPhoto(game, 300_000));

    expect(result.ok).toBe(false);
    // 数据：旧版逐字节原样。
    expect(window.localStorage.getItem(KEY_PREFIX + "quota-pointer")).toBe(
      JSON.stringify(game),
    );
    // 指针：仍然指向这份旧版，不会因为保存失败被清掉或改指别的包。
    expect(getActiveAuthoredGameId()).toBe("quota-pointer");
  });

  it("提示里说清：满了、这一份多大、旧版没被动过、下一步怎么做", () => {
    const game = makeGame("quota-message");
    useStorage(new BudgetedStorage(200_000));
    saveAuthoredGameChecked(game);

    const bigger = withPhoto(game, 300_000);
    const result = saveAuthoredGameChecked(bigger);
    expect(result.ok).toBe(false);
    const message = result.errors[0]?.message ?? "";

    expect(message).toContain("本机存储已满");
    // The exact size the author tried to write, in whatever unit fits it.
    expect(message).toContain(formatBytes(utf8ByteLength(JSON.stringify(bigger))));
    expect(message).toContain("删除不再需要的本地副本");
    expect(message).toContain("上一版没有被改动");
  });

  it("第一次保存就失败时，不会声称旧版还在", () => {
    useStorage(new BudgetedStorage(200_000));
    const result = saveAuthoredGameChecked(withPhoto(makeGame("quota-first"), 300_000));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message ?? "").not.toContain("上一版没有被改动");
    expect(window.localStorage.getItem(KEY_PREFIX + "quota-first")).toBeNull();
  });

  it("无痕浏览这类非配额失败给出不同的说明", () => {
    const base = new BudgetedStorage(5 * 1024 * 1024);
    useStorage(
      wrapStorage(base, {
        setItem: () => {
          throw new Error("SecurityError: storage is disabled");
        },
      }),
    );
    const result = saveAuthoredGameChecked(makeGame("quota-blocked"));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message ?? "").toContain("隐私模式");
  });
});

describe("无法序列化", () => {
  it("循环引用在写入之前就被拦下，存储没有被动过", () => {
    const game = makeGame("quota-circular");
    (game as unknown as Record<string, unknown>).self = game;

    const result = saveAuthoredGameChecked(game);
    expect(result.ok).toBe(false);
    expect(window.localStorage.getItem(KEY_PREFIX + game.id)).toBeNull();
    expect(result.errors[0]?.message ?? "").toContain("序列化");
  });
});

describe("读回校验", () => {
  it("写入后的字节不一致时不报告成功", () => {
    const base = window.localStorage;
    useStorage(
      wrapStorage(base, {
        getItem: (key: string) => {
          const raw = base.getItem(key);
          if (!key.startsWith(KEY_PREFIX) || !raw) return raw;
          return raw.replace("空间测试", "被改过的标题");
        },
      }),
    );
    const result = saveAuthoredGameChecked(makeGame("quota-readback"));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message ?? "").toContain("读回校验");
  });
});
