// @vitest-environment jsdom

/**
 * Demo/preview save isolation (decisions D-001/D-002/D-006).
 *
 * The player save namespace must be untouchable from demo and preview modes:
 * different storage backend (sessionStorage), different key prefix, and clear
 * operations that only ever hit their own namespace.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { GameState } from "@/lib/game/state";

const saveKey = (gameId: string) => `mos-scene-hunt:save:${encodeURIComponent(gameId)}`;
const demoKey = (gameId: string) => `mos-scene-hunt:demo:${encodeURIComponent(gameId)}`;
const previewKey = (gameId: string) => `mos-scene-hunt:preview:${encodeURIComponent(gameId)}`;

function makeState(gameId: string, overrides: Partial<GameState> = {}): GameState {
  return {
    gameId,
    gameVersion: "1.0.0",
    currentSceneId: null,
    scenes: {},
    inventory: [],
    keywords: [],
    startedAt: 100,
    lastUpdatedAt: 100,
    ...overrides,
  } as GameState;
}

describe("mode-aware save routing", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("demo saves go to sessionStorage, never the player save", async () => {
    const storage = await import("@/lib/storage");
    const state = makeState("demo-game");

    expect(storage.saveGameStateForMode(state, "demo")).toBe(true);
    expect(sessionStorage.getItem(demoKey("demo-game"))).not.toBeNull();
    expect(localStorage.getItem(saveKey("demo-game"))).toBeNull();
  });

  it("preview saves go to their own namespace, never the player save", async () => {
    const storage = await import("@/lib/storage");
    const state = makeState("preview-game");

    expect(storage.saveGameStateForMode(state, "preview")).toBe(true);
    expect(sessionStorage.getItem(previewKey("preview-game"))).not.toBeNull();
    expect(localStorage.getItem(saveKey("preview-game"))).toBeNull();
    expect(sessionStorage.getItem(demoKey("preview-game"))).toBeNull();
  });

  it("player saves keep the exact legacy key and envelope", async () => {
    const storage = await import("@/lib/storage");
    const state = makeState("real-game");

    expect(storage.saveGameStateForMode(state, "player")).toBe(true);
    expect(localStorage.getItem(saveKey("real-game"))).not.toBeNull();
    const envelope = JSON.parse(localStorage.getItem(saveKey("real-game"))!);
    expect(envelope.schemaVersion).toBe(storage.SAVE_SCHEMA_VERSION);
    expect(envelope.gameId).toBe("real-game");
    expect(storage.loadGameStateForMode("real-game", "player")?.gameId).toBe("real-game");
  });

  it("demo hydration never falls back to the player save", async () => {
    const storage = await import("@/lib/storage");
    // A real player save exists for this game...
    expect(storage.saveGameStateForMode(makeState("shared-game"), "player")).toBe(true);

    // ...but demo mode must not see it.
    expect(storage.loadGameStateForMode("shared-game", "demo")).toBeNull();
    expect(storage.loadGameStateForMode("shared-game", "preview")).toBeNull();
  });

  it("demo and preview namespaces are isolated from each other", async () => {
    const storage = await import("@/lib/storage");
    storage.saveGameStateForMode(makeState("g", { startedAt: 111 }), "demo");
    storage.saveGameStateForMode(makeState("g", { startedAt: 222 }), "preview");

    expect(storage.loadGameStateForMode("g", "demo")?.startedAt).toBe(111);
    expect(storage.loadGameStateForMode("g", "preview")?.startedAt).toBe(222);
  });

  it("clearing the demo session only clears the demo namespace (D-002)", async () => {
    const storage = await import("@/lib/storage");
    // Real progress exists and must survive the demo reset.
    expect(storage.saveGameStateForMode(makeState("shared-game"), "player")).toBe(true);
    expect(storage.saveGameStateForMode(makeState("shared-game"), "demo")).toBe(true);

    storage.clearGameStateForMode("shared-game", "demo");

    expect(sessionStorage.getItem(demoKey("shared-game"))).toBeNull();
    expect(localStorage.getItem(saveKey("shared-game"))).not.toBeNull();
    expect(storage.loadGameStateForMode("shared-game", "player")).not.toBeNull();
  });

  it("clearing the preview session only clears the preview namespace (D-006)", async () => {
    const storage = await import("@/lib/storage");
    expect(storage.saveGameStateForMode(makeState("shared-game"), "player")).toBe(true);
    expect(storage.saveGameStateForMode(makeState("shared-game"), "preview")).toBe(true);

    storage.clearGameStateForMode("shared-game", "preview");

    expect(sessionStorage.getItem(previewKey("shared-game"))).toBeNull();
    expect(localStorage.getItem(saveKey("shared-game"))).not.toBeNull();
  });

  it("corrupt demo payloads read as absent, not as player progress", async () => {
    const storage = await import("@/lib/storage");
    sessionStorage.setItem(demoKey("broken"), "{not-json");
    expect(storage.loadGameStateForMode("broken", "demo")).toBeNull();
    sessionStorage.setItem(
      demoKey("mismatch"),
      JSON.stringify({ schemaVersion: 1, savedAt: 1, gameId: "other", gameVersion: "1", state: makeState("other") }),
    );
    expect(storage.loadGameStateForMode("mismatch", "demo")).toBeNull();
  });
});
