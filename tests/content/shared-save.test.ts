import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../lib/game/types";
import {
  canonicalGameJson,
  getSharedGameLibraryState,
  saveSharedGameToLibrary,
} from "../../lib/content/shared-save";

/**
 * Batch-1 guard: a game received via a share link must only enter the local
 * library through the explicit save path, and that path must never lie about
 * success nor silently overwrite an existing same-id pack.
 */

const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";
const SAVE_PREFIX = "mos-scene-hunt:save:";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "shared-hunt",
    version: "1.0.0",
    title: "朋友做的寻宝",
    description: "通过分享链接收到的游戏。",
    language: "zh-CN",
    estimatedMinutes: 20,
    startLocation: { lat: 14.584481, lng: 120.9794 },
    entrySceneId: "gate",
    huntArea: {
      center: { lat: 14.584481, lng: 120.9794 },
      radiusMeters: 120,
      shape: "polygon",
      points: [
        { lat: 14.585, lng: 120.979 },
        { lat: 14.585, lng: 120.98 },
        { lat: 14.584, lng: 120.98 },
      ],
      name: "校园区域",
    },
    scenes: [
      {
        id: "gate",
        title: "大门",
        story: "集合点。",
        location: { lat: 14.584481, lng: 120.9794, radius: 15, name: "大门" },
        nextSceneId: "pond",
        challenge: {
          type: "choice",
          question: "这是哪里？",
          options: ["大门", "水池"],
          answer: 0,
        },
        reward: { type: "keyword", title: "起点", value: "门" },
      },
      {
        id: "pond",
        title: "水池",
        story: "第二站。",
        location: { lat: 14.5846, lng: 120.9798, radius: 20, name: "水池" },
        nextSceneId: null,
        challenge: { type: "keyword", question: "写下关键词", answer: "水" },
        reward: { type: "keyword", title: "线索", value: "水" },
      },
    ],
    ...overrides,
  };
}

/** Minimal jsdom-free localStorage so these run in the node environment. */
function installLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  return { store, storage };
}

let store: Map<string, string>;
let storage: ReturnType<typeof installLocalStorage>["storage"];

beforeEach(() => {
  ({ store, storage } = installLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared game library state", () => {
  it("reports not-saved on an empty library without writing anything", () => {
    const game = makeGame();
    expect(getSharedGameLibraryState(game)).toBe("not-saved");
    expect(store.size).toBe(0);
  });

  it("E/G. reports saved when identical content is already stored (key-order insensitive)", () => {
    const game = makeGame();
    // Simulate a previously saved copy whose JSON key order differs.
    store.set(AUTHORING_PREFIX + game.id, canonicalGameJson(game));
    expect(getSharedGameLibraryState(game)).toBe("saved");
  });

  it("reports conflict when a same-id pack with different content exists", () => {
    const game = makeGame();
    const existing = makeGame({ title: "本机的旧版本" });
    store.set(AUTHORING_PREFIX + game.id, JSON.stringify(existing));
    const before = store.get(AUTHORING_PREFIX + game.id);
    expect(getSharedGameLibraryState(game)).toBe("conflict");
    // State detection must not mutate the stored pack.
    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(before);
  });

  it("reports conflict when the stored key holds unparsable content", () => {
    const game = makeGame();
    store.set(AUTHORING_PREFIX + game.id, "{not json");
    expect(getSharedGameLibraryState(game)).toBe("conflict");
  });
});

describe("canonicalGameJson", () => {
  it("ignores key order and undefined fields", () => {
    const a = { b: 1, a: [1, { y: 2, x: undefined }] };
    const b = { a: [1, { x: undefined, y: 2 }], b: 1 };
    expect(canonicalGameJson(a)).toBe(canonicalGameJson(b));
  });

  it("distinguishes different content", () => {
    expect(canonicalGameJson({ a: 1 })).not.toBe(canonicalGameJson({ a: 2 }));
  });
});

describe("saveSharedGameToLibrary", () => {
  it("A. saves a new pack and reads the exact bytes back", () => {
    const game = makeGame();
    const outcome = saveSharedGameToLibrary(game);
    expect(outcome).toEqual({ status: "saved", warnings: 0 });
    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(JSON.stringify(game));
  });

  it("A. readback verification passes only when stored bytes match", () => {
    const game = makeGame();
    saveSharedGameToLibrary(game);
    // The stored copy must be byte-identical to what we intended to write.
    expect(storage.getItem(AUTHORING_PREFIX + game.id)).toBe(JSON.stringify(game));
  });

  it("B. reports error and writes nothing when storage is full", () => {
    const game = makeGame();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      const err = new Error("The quota has been exceeded");
      throw err;
    });
    const outcome = saveSharedGameToLibrary(game);
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.message).toContain("存储");
    expect(store.has(AUTHORING_PREFIX + game.id)).toBe(false);
    vi.restoreAllMocks();
  });

  it("C. reports error when the write succeeds but readback differs", () => {
    const game = makeGame();
    const originalGet = storage.getItem;
    vi.spyOn(storage, "getItem").mockImplementation((k: string) => {
      const raw = originalGet(k);
      if (k === AUTHORING_PREFIX + game.id && raw) {
        // Simulate a corrupted round-trip: the stored title came back wrong.
        const parsed = JSON.parse(raw);
        parsed.title = "被篡改的标题";
        return JSON.stringify(parsed);
      }
      return raw;
    });
    const outcome = saveSharedGameToLibrary(game);
    expect(outcome).toMatchObject({ status: "error" });
    if (outcome.status === "error") expect(outcome.message).toContain("读回校验");
    vi.restoreAllMocks();
  });

  it("D. saving twice does not create a duplicate record", () => {
    const game = makeGame();
    expect(saveSharedGameToLibrary(game).status).toBe("saved");
    expect(saveSharedGameToLibrary(game)).toEqual({ status: "already-saved" });
    const authoringKeys = Array.from(store.keys()).filter((k) =>
      k.startsWith(AUTHORING_PREFIX),
    );
    expect(authoringKeys).toEqual([AUTHORING_PREFIX + game.id]);
  });

  it("refuses to overwrite a same-id pack with different content", () => {
    const game = makeGame();
    const existing = makeGame({ title: "本机的旧版本" });
    store.set(AUTHORING_PREFIX + game.id, JSON.stringify(existing));
    const before = store.get(AUTHORING_PREFIX + game.id);
    const outcome = saveSharedGameToLibrary(game);
    expect(outcome).toEqual({ status: "conflict" });
    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(before);
  });

  it("H. saving never touches existing player progress", () => {
    const game = makeGame();
    const saveKey = SAVE_PREFIX + encodeURIComponent(game.id);
    const otherSaveKey = SAVE_PREFIX + encodeURIComponent("other-game");
    const progress = JSON.stringify({
      schemaVersion: 1,
      gameId: game.id,
      state: { inventory: ["线索一"] },
    });
    store.set(saveKey, progress);
    store.set(otherSaveKey, progress);
    expect(saveSharedGameToLibrary(game).status).toBe("saved");
    expect(store.get(saveKey)).toBe(progress);
    expect(store.get(otherSaveKey)).toBe(progress);
  });

  it("surfaces the validator's blocking error instead of writing an invalid pack", () => {
    const game = makeGame({ title: "   " });
    const outcome = saveSharedGameToLibrary(game);
    expect(outcome.status).toBe("error");
    expect(store.has(AUTHORING_PREFIX + game.id)).toBe(false);
  });
});
