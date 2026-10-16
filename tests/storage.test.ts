// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

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
