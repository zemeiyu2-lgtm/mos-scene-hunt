import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../lib/game/types";
import {
  DEFAULT_GAME_ID,
  clearActiveAuthoredGame,
  getActiveAuthoredGameId,
  hasAuthoredGame,
  loadGame,
  markCurrentAuthoredGame,
  readAuthoredGame,
  resolveActiveGameId,
  saveAuthoredGame,
} from "../../lib/content";
import { setCurrentAuthoredGameId } from "../../lib/storage";

/**
 * Regression guard for the "play shows the demo instead of my game" defect.
 *
 * The designer wrote the pack to `mos-scene-hunt:authoring:<id>`, but nothing
 * ever told the app *which* id to load: the root provider hard-coded
 * DEFAULT_GAME_ID, so /select always resolved to the bundled demo. These tests
 * pin the seam that fixes it - a browser-local "current authored game" pointer
 * that loadGame() honours when no explicit id is given.
 */

const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";
const CURRENT_KEY = "mos-scene-hunt:current-authored-game";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "authored-hunt",
    version: "1.0.0",
    title: "从课堂到禾场",
    description: "八个校园地点的自定义寻宝。",
    language: "zh-CN",
    estimatedMinutes: 40,
    startLocation: { lat: 14.584481, lng: 120.9794 },
    entrySceneId: "chapel",
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
        id: "chapel",
        title: "礼拜堂",
        story: "集合点。",
        location: { lat: 14.584481, lng: 120.9794, radius: 15, name: "礼拜堂" },
        nextSceneId: "library",
        challenge: {
          type: "choice",
          question: "这里是什么建筑？",
          options: ["礼拜堂", "图书馆"],
          answer: 0,
        },
        reward: { type: "keyword", title: "起点", value: "开始" },
      },
      {
        id: "library",
        title: "图书馆",
        story: "第二站。",
        location: { lat: 14.5846, lng: 120.9798, radius: 20, name: "图书馆" },
        nextSceneId: null,
        challenge: { type: "keyword", question: "写下关键词", answer: "安静" },
        reward: { type: "keyword", title: "线索", value: "书" },
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
  return store;
}

let store: Map<string, string>;

beforeEach(() => {
  store = installLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authored pack storage", () => {
  it("A. saveAuthoredGame persists under the authoring key", () => {
    const game = makeGame();
    expect(saveAuthoredGame(game)).toBe(true);
    expect(hasAuthoredGame(game.id)).toBe(true);

    const raw = store.get(`${AUTHORING_PREFIX}${game.id}`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).title).toBe("从课堂到禾场");
  });

  it("B. markCurrentAuthoredGame writes the pointer", () => {
    markCurrentAuthoredGame("authored-hunt");
    expect(store.get(CURRENT_KEY)).toBe("authored-hunt");
    expect(getActiveAuthoredGameId()).toBe("authored-hunt");
  });

  it("C. readAuthoredGame returns a validated game and null for junk", () => {
    saveAuthoredGame(makeGame());
    const read = readAuthoredGame("authored-hunt");
    expect(read?.title).toBe("从课堂到禾场");
    expect(read?.scenes.map((s) => s.title)).toEqual(["礼拜堂", "图书馆"]);

    expect(readAuthoredGame("does-not-exist")).toBeNull();
    store.set(`${AUTHORING_PREFIX}broken`, "{ not json");
    expect(readAuthoredGame("broken")).toBeNull();
  });
});

describe("resolveActiveGameId", () => {
  it("D. falls back to demo-hunt when nothing is authored", () => {
    expect(resolveActiveGameId()).toBe(DEFAULT_GAME_ID);
    expect(resolveActiveGameId(null)).toBe(DEFAULT_GAME_ID);
  });

  it("E. prefers the authored pack over the default", () => {
    saveAuthoredGame(makeGame());
    markCurrentAuthoredGame("authored-hunt");
    expect(resolveActiveGameId()).toBe("authored-hunt");
  });

  it("F. an explicit id always wins", () => {
    saveAuthoredGame(makeGame());
    markCurrentAuthoredGame("authored-hunt");
    expect(resolveActiveGameId("something-else")).toBe("something-else");
  });

  it("G. a dangling pointer degrades to the default instead of a blank screen", () => {
    // Pointer set, but the pack was never saved (or was cleared).
    setCurrentAuthoredGameId("ghost-hunt");
    expect(resolveActiveGameId()).toBe(DEFAULT_GAME_ID);
  });

  it("H. clearing the pointer returns to the bundled pack", () => {
    saveAuthoredGame(makeGame());
    markCurrentAuthoredGame("authored-hunt");
    expect(resolveActiveGameId()).toBe("authored-hunt");

    clearActiveAuthoredGame();
    expect(getActiveAuthoredGameId()).toBeNull();
    expect(resolveActiveGameId()).toBe(DEFAULT_GAME_ID);
  });
});

describe("loadGame", () => {
  it("I. loads the authored pack (not the demo) when one is current", async () => {
    saveAuthoredGame(makeGame());
    markCurrentAuthoredGame("authored-hunt");

    // No explicit id: this is the /select call path.
    const { game, source } = await loadGame();

    expect(source).toBe("local");
    expect(game.id).toBe("authored-hunt");
    expect(game.title).toBe("从课堂到禾场");
    expect(game.scenes).toHaveLength(2);
    expect(game.scenes[0].location.radius).toBe(15);
    expect(game.huntArea?.shape).toBe("polygon");
    expect(game.huntArea?.points).toHaveLength(3);
  });

  it("J. an explicit id bypasses the authored pack entirely", async () => {
    saveAuthoredGame(makeGame());
    markCurrentAuthoredGame("authored-hunt");

    // No `window`-served pack exists in the node environment, so an explicit
    // id must fail on the network path rather than silently returning the
    // authored pack - that is exactly the distinction under test.
    await expect(loadGame(DEFAULT_GAME_ID, { forceNetwork: true })).rejects.toThrow(
      /demo-hunt/,
    );
  });
});
