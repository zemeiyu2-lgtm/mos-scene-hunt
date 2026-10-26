// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState, StoredSceneStatus } from "@/lib/game/state";

const LEGACY_KEY = "mos-scene-hunt:active-save";
const saveKey = (gameId: string) => `mos-scene-hunt:save:${encodeURIComponent(gameId)}`;

function makeState(gameId: string) {
  return {
    gameId,
    gameVersion: "1.0.0",
    currentSceneId: null,
    scenes: {},
    inventory: [],
    keywords: [],
    startedAt: 100,
    lastUpdatedAt: 100,
  };
}

/** One stored scene record, with the fields the guard actually looks at. */
function scene(
  sceneId: string,
  status: StoredSceneStatus,
  extra: { arrivedAt?: number; completedAt?: number } = {},
) {
  return { sceneId, status, attempts: 0, grantedRewardIds: [], ...extra };
}

describe("per-game save storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("keeps different games' saves isolated", async () => {
    const storage = await import("@/lib/storage");
    const alpha = makeState("alpha");
    const beta = makeState("beta");

    expect(storage.saveGameState(alpha)).toBe(true);
    expect(storage.saveGameState(beta)).toBe(true);
    expect(storage.loadGameState("alpha")?.gameId).toBe("alpha");
    expect(storage.loadGameState("beta")?.gameId).toBe("beta");
    expect(localStorage.getItem(saveKey("alpha"))).not.toBeNull();
    expect(localStorage.getItem(saveKey("beta"))).not.toBeNull();
  });

  it("migrates a matching legacy save without deleting the original", async () => {
    const storage = await import("@/lib/storage");
    const state = makeState("legacy-game");
    const envelope = {
      schemaVersion: storage.SAVE_SCHEMA_VERSION,
      savedAt: 123,
      gameId: "legacy-game",
      gameVersion: "1.0.0",
      state,
    };
    const serialized = JSON.stringify(envelope);
    localStorage.setItem(LEGACY_KEY, serialized);

    expect(storage.loadGameState("legacy-game")?.gameId).toBe("legacy-game");
    expect(localStorage.getItem(saveKey("legacy-game"))).toBe(serialized);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(serialized);
  });

  it("does not overwrite an unmigrated legacy save when another game saves", async () => {
    const storage = await import("@/lib/storage");
    const legacy = {
      schemaVersion: storage.SAVE_SCHEMA_VERSION,
      savedAt: 123,
      gameId: "old-game",
      gameVersion: "1.0.0",
      state: makeState("old-game"),
    };
    const serialized = JSON.stringify(legacy);
    localStorage.setItem(LEGACY_KEY, serialized);

    expect(storage.saveGameState(makeState("new-game"))).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(serialized);
    expect(storage.loadGameState("old-game")?.gameId).toBe("old-game");
  });

  it("clears only the selected game's save and matching legacy copy", async () => {
    const storage = await import("@/lib/storage");
    storage.saveGameState(makeState("alpha"));
    storage.saveGameState(makeState("beta"));

    storage.clearGameState("alpha");

    expect(storage.loadGameState("alpha")).toBeNull();
    expect(storage.loadGameState("beta")?.gameId).toBe("beta");
  });
});

/**
 * The map's arrival guard asks "was this hunt already underway when the page
 * loaded?". Answering it by looking for a save key is wrong: hydrating a
 * never-started hunt already writes one, and the launch screen / game centre
 * touch the index by themselves. Only real interaction counts as progress.
 */
describe("hasProgressIn / hasGameProgress", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("treats a hydrated, never-started save as no progress", async () => {
    const storage = await import("@/lib/storage");
    // Exactly what the provider persists after hydrating an empty hunt.
    const untouched: GameState = {
      ...makeState("alpha"),
      scenes: { a: scene("a", "locked"), b: scene("b", "locked") },
    };
    storage.saveGameState(untouched);

    expect(localStorage.getItem(saveKey("alpha"))).not.toBeNull();
    expect(storage.hasGameProgress("alpha")).toBe(false);
    expect(storage.hasProgressIn(storage.loadGameState("alpha"), "alpha")).toBe(false);
  });

  it("counts an arrival as progress", async () => {
    const storage = await import("@/lib/storage");
    const arrived: GameState = {
      ...makeState("alpha"),
      scenes: { a: scene("a", "arrived", { arrivedAt: 500 }) },
    };
    expect(storage.hasProgressIn(arrived, "alpha")).toBe(true);
  });

  it("counts a kept arrival stamp as progress even after the status rolled back", async () => {
    const storage = await import("@/lib/storage");
    // reconcileState rolls `arrived` back to `locked` but keeps the stamp.
    const rolledBack: GameState = {
      ...makeState("alpha"),
      scenes: { a: scene("a", "locked", { arrivedAt: 500 }) },
    };
    expect(storage.hasProgressIn(rolledBack, "alpha")).toBe(true);
  });

  it("counts an open challenge and a moved scene pointer as progress", async () => {
    const storage = await import("@/lib/storage");
    const challenging: GameState = {
      ...makeState("alpha"),
      scenes: { a: scene("a", "challenging") },
    };
    expect(storage.hasProgressIn(challenging, "alpha")).toBe(true);
    expect(storage.hasProgressIn({ ...makeState("alpha"), currentSceneId: "a" }, "alpha")).toBe(true);
  });

  it("never reports progress for another game's state", async () => {
    const storage = await import("@/lib/storage");
    const alphaProgress: GameState = {
      ...makeState("alpha"),
      scenes: { a: scene("a", "completed", { completedAt: 900 }) },
    };
    expect(storage.hasProgressIn(alphaProgress, "beta")).toBe(false);
    expect(storage.hasProgressIn(null, "alpha")).toBe(false);
  });

  it("uses the save index written by the provider as progress", async () => {
    const storage = await import("@/lib/storage");
    storage.upsertHuntIndex({
      gameId: "alpha",
      title: "Alpha",
      completedScenes: 0,
      totalScenes: 3,
      lastPlayedAt: 1_000,
    });
    expect(storage.hasGameProgress("alpha")).toBe(true);
    expect(storage.hasGameProgress("beta")).toBe(false);
  });
});
