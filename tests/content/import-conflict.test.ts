import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../lib/game/types";
import { exportGameJson, MOS_GAME_PACKAGE_FORMAT, MOS_GAME_PACKAGE_VERSION } from "../../lib/game/package";
import {
  importGamePackage,
  importGamePackageChecked,
} from "../../lib/content";
import {
  getSharedGameLibraryState,
  saveSharedGameToLibrary,
} from "../../lib/content/shared-save";

/**
 * Batch-2 guard: importing a game package must never silently overwrite a
 * same-id local game with different content, must deduplicate identical
 * content, and must leave player progress and unrelated data untouched.
 */

const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";
const SAVE_PREFIX = "mos-scene-hunt:save:";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "import-hunt",
    version: "1.0.0",
    title: "导入验收游戏",
    description: "第二批导入冲突保护探针用游戏。",
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

function makeProgress(gameId: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    savedAt: 1700000000000,
    gameId,
    gameVersion: "1.0.0",
    state: {
      gameId,
      gameVersion: "1.0.0",
      currentSceneId: null,
      scenes: {
        gate: {
          sceneId: "gate",
          status: "completed",
          attempts: 2,
          grantedRewardIds: ["r-gate"],
          completedAt: 1699999999000,
        },
        pond: { sceneId: "pond", status: "locked", attempts: 0, grantedRewardIds: [] },
      },
      inventory: [{ id: "r-gate", title: "起点", sceneId: "gate" }],
      keywords: [],
      startedAt: 1699999999000,
      lastUpdatedAt: 1699999999000,
    },
  });
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

describe("importGamePackageChecked - three-state rules", () => {
  it("A. imports a new game id and reads the exact bytes back", () => {
    const game = makeGame();
    const outcome = importGamePackageChecked(exportGameJson(game));
    expect(outcome.status).toBe("imported");
    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(JSON.stringify(game));
  });

  it("B. same id + same content returns already-exists without rewriting", () => {
    const game = makeGame();
    const pack = exportGameJson(game);
    expect(importGamePackageChecked(pack).status).toBe("imported");
    const before = store.get(AUTHORING_PREFIX + game.id);
    const second = importGamePackageChecked(pack);
    expect(second.status).toBe("already-exists");
    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(before);
    // exactly one record
    expect(Array.from(store.keys()).filter((k) => k.startsWith(AUTHORING_PREFIX))).toHaveLength(1);
  });

  it("C. same id + different content refuses and keeps the local game", () => {
    const game = makeGame();
    const existing = makeGame({ title: "本机保留版" });
    store.set(AUTHORING_PREFIX + game.id, JSON.stringify(existing));
    const before = store.get(AUTHORING_PREFIX + game.id);
    const outcome = importGamePackageChecked(exportGameJson(game));
    expect(outcome).toMatchObject({ status: "conflict" });
    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(before);
  });

  it("D. key order differences do not cause a false conflict", () => {
    const game = makeGame();
    // Store a copy whose JSON property order differs but whose content is equal.
    const reordered = JSON.parse(JSON.stringify(game));
    const swap = (o: Record<string, unknown>) => {
      for (const v of Object.values(o)) if (v && typeof v === "object" && !Array.isArray(v)) swap(v as Record<string, unknown>);
      const entries = Object.entries(o).reverse();
      for (const k of Object.keys(o)) delete o[k];
      for (const [k, v] of entries) o[k] = v;
    };
    swap(reordered);
    store.set(AUTHORING_PREFIX + game.id, JSON.stringify(reordered));
    expect(getSharedGameLibraryState(game)).toBe("saved");
    expect(importGamePackageChecked(exportGameJson(game)).status).toBe("already-exists");
  });

  it("E. a single content-field difference is a conflict", () => {
    const game = makeGame();
    const existing = makeGame();
    existing.scenes[0].location.radius = 16; // otherwise identical
    store.set(AUTHORING_PREFIX + game.id, JSON.stringify(existing));
    expect(importGamePackageChecked(exportGameJson(game)).status).toBe("conflict");
  });

  it("F. an unreadable local record is treated as conflict, not overwritten", () => {
    const game = makeGame();
    store.set(AUTHORING_PREFIX + game.id, "{broken json");
    const before = store.get(AUTHORING_PREFIX + game.id);
    expect(importGamePackageChecked(exportGameJson(game)).status).toBe("conflict");
    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(before);
  });

  it("G. corrupt or invalid packages are rejected without writing", () => {
    expect(importGamePackageChecked("not json").status).toBe("error");
    expect(importGamePackageChecked(JSON.stringify({ foo: 1 })).status).toBe("error");
    expect(
      importGamePackageChecked(exportGameJson(makeGame({ title: "   " }))).status,
    ).toBe("error");
    expect(store.has(AUTHORING_PREFIX + "import-hunt")).toBe(false);
  });

  it("H. incompatible package format versions are rejected", () => {
    const game = makeGame();
    const pack = JSON.stringify({
      format: MOS_GAME_PACKAGE_FORMAT,
      formatVersion: "999.0",
      game,
    });
    expect(importGamePackageChecked(pack).status).toBe("error");
    expect(store.has(AUTHORING_PREFIX + game.id)).toBe(false);
    // sanity: the real version is what unwrap accepts
    expect(MOS_GAME_PACKAGE_VERSION).toBe("1.0");
  });

  it("K. a storage failure leaves no half-written record", () => {
    const game = makeGame({ id: "half-write" });
    vi.spyOn(store, "set").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const outcome = importGamePackageChecked(exportGameJson(game));
    expect(outcome.status).toBe("error");
    expect(store.has(AUTHORING_PREFIX + game.id)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("import safety for other data", () => {
  it("I/J. conflict leaves both the local game and its player progress intact", () => {
    const game = makeGame();
    const existing = makeGame({ title: "本机保留版" });
    store.set(AUTHORING_PREFIX + game.id, JSON.stringify(existing));
    const progressKey = SAVE_PREFIX + encodeURIComponent(game.id);
    const progress = makeProgress(game.id);
    store.set(progressKey, progress);

    importGamePackageChecked(exportGameJson(game));

    expect(store.get(AUTHORING_PREFIX + game.id)).toBe(JSON.stringify(existing));
    expect(store.get(progressKey)).toBe(progress);
  });

  it("L. importing a new id does not touch other games or their progress", () => {
    const other = makeGame({ id: "other-hunt", title: "别的游戏" });
    store.set(AUTHORING_PREFIX + other.id, JSON.stringify(other));
    const otherProgressKey = SAVE_PREFIX + encodeURIComponent(other.id);
    const otherProgress = makeProgress(other.id);
    store.set(otherProgressKey, otherProgress);

    const outcome = importGamePackageChecked(exportGameJson(makeGame()));
    expect(outcome.status).toBe("imported");
    expect(store.get(AUTHORING_PREFIX + other.id)).toBe(JSON.stringify(other));
    expect(store.get(otherProgressKey)).toBe(otherProgress);
  });

  it("M. batch-1 shared-game save still works and coexists with imports", () => {
    const shared = makeGame({ id: "shared-hunt", title: "分享来的游戏" });
    expect(saveSharedGameToLibrary(shared)).toMatchObject({ status: "saved" });
    // Importing the same content is recognised as already-exists.
    expect(importGamePackageChecked(exportGameJson(shared)).status).toBe("already-exists");
    // A genuinely new import still lands alongside the shared game.
    expect(importGamePackageChecked(exportGameJson(makeGame())).status).toBe("imported");
    expect(store.get(AUTHORING_PREFIX + shared.id)).toBe(JSON.stringify(shared));
  });
});

describe("legacy importGamePackage wrapper", () => {
  it("throws on conflict and succeeds on new ids", () => {
    const game = makeGame();
    const existing = makeGame({ title: "本机保留版" });
    store.set(AUTHORING_PREFIX + game.id, JSON.stringify(existing));
    expect(() => importGamePackage(exportGameJson(game))).toThrow(/内容不同/);
    expect(importGamePackage(exportGameJson(makeGame({ id: "fresh-hunt" }))).game.id).toBe(
      "fresh-hunt",
    );
  });
});
