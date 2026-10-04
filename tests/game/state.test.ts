/**
 * Game state machine tests.
 *
 * These cover spec section 17's "Game State" block and the acceptance criteria in
 * section 18:
 *   - Scene A completes -> Scene B unlocks
 *   - a wrong answer cannot advance
 *   - a correct answer advances
 *   - re-entering a completed location grants no second reward
 */

import { describe, expect, it } from "vitest";
import {
  createInitialState,
  availableSceneIds,
  activeScene,
  completionRatio,
  gameReducer,
  isGameComplete,
  isSceneComplete,
  reconcileState,
  rewardId,
  resolveSceneStatus,
  sceneStatuses,
  statusOf,
  type GameState,
} from "@/lib/game/state";
import type { Game } from "@/lib/game/types";

/** A minimal three-scene chain with one of each challenge type. */
const game: Game = {
  id: "test-hunt",
  language: "zh-CN",
  title: "Test Hunt",
  description: "state machine fixture",
  version: "1.0.0",
  startLocation: { lat: 0, lng: 0 },
  entrySceneId: "a",
  scenes: [
    {
      id: "a",
      title: "A",
      story: "story a",
      location: { lat: 0.0004, lng: 0, radius: 50 },
      nextSceneId: "b",
      challenge: {
        type: "choice",
        question: "color?",
        options: ["white", "grey", "red"],
        answer: 1,
      },
      reward: { type: "keyword", title: "memory", value: "memory" },
    },
    {
      id: "b",
      title: "B",
      story: "story b",
      location: { lat: 0, lng: 0.0005, radius: 50 },
      nextSceneId: "c",
      challenge: {
        type: "keyword",
        question: "one word",
        answer: ["direction", "way"],
        acceptedKeywords: ["path"],
      },
      reward: { type: "keyword", title: "direction", value: "direction" },
    },
    {
      id: "c",
      title: "C",
      story: "story c",
      location: { lat: -0.0006, lng: 0, radius: 50 },
      nextSceneId: null,
      challenge: { type: "text", question: "two words", answer: ["home", "homeland"] },
      reward: { type: "badge", title: "finished", value: "path-done" },
    },
  ],
};

const T = 1_700_000_000_000;

function fresh(): GameState {
  return createInitialState(game, T);
}

/** Drive scene `id` to completion in one call. */
function solve(
  state: GameState,
  id: string,
  action: Parameters<typeof gameReducer>[2],
  now = T,
): GameState {
  state = gameReducer(game, state, { type: "ENTER_SCENE", sceneId: id, now });
  state = gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId: id, now });
  return gameReducer(game, state, action);
}

describe("initial state", () => {
  it("makes only the entry scene available", () => {
    const s = fresh();
    // Stored values stay neutral until the player interacts; reachability is
    // derived. statusOf() is the read model the UI uses.
    expect(statusOf(game, s, "a")).toBe("available");
    expect(statusOf(game, s, "b")).toBe("locked");
    expect(statusOf(game, s, "c")).toBe("locked");
    expect(s.scenes.a.status).toBe("locked");
    expect(availableSceneIds(game, s)).toEqual(["a"]);
  });

  it("starts with an empty inventory and no current scene", () => {
    const s = fresh();
    expect(s.inventory).toEqual([]);
    expect(s.keywords).toEqual([]);
    expect(s.currentSceneId).toBeNull();
    expect(isGameComplete(game, s)).toBe(false);
    expect(completionRatio(game, s)).toBe(0);
  });

  it("points the player at the entry scene", () => {
    expect(activeScene(game, fresh())?.id).toBe("a");
  });
});

describe("GPS FIX_UPDATE only moves between available and arrived", () => {
  it("flips an available scene to arrived when the player enters the ring", () => {
    let s = fresh();
    s = gameReducer(game, s, { type: "FIX_UPDATE", now: T, insideSceneIds: ["a"] });
    expect(s.scenes.a.status).toBe("arrived");
    expect(s.scenes.a.arrivedAt).toBe(T);
    expect(statusOf(game, s, "a")).toBe("arrived");
  });

  it("never completes a scene or grants a reward on position alone", () => {
    let s = fresh();
    for (let i = 0; i < 20; i++) {
      s = gameReducer(game, s, { type: "FIX_UPDATE", now: T + i, insideSceneIds: ["a", "b", "c"] });
    }
    expect(s.scenes.a.status).toBe("arrived");
    expect(s.inventory).toEqual([]);
    expect(statusOf(game, s, "b")).toBe("locked");
    expect(statusOf(game, s, "c")).toBe("locked");
  });

  it("cannot unlock a locked scene just by standing on it", () => {
    let s = fresh();
    s = gameReducer(game, s, { type: "FIX_UPDATE", now: T, insideSceneIds: ["b", "c"] });
    expect(statusOf(game, s, "b")).toBe("locked");
    expect(statusOf(game, s, "c")).toBe("locked");
  });

  it("returns an arrived scene to the neutral baseline when the player walks out", () => {
    let s = fresh();
    s = gameReducer(game, s, { type: "FIX_UPDATE", now: T, insideSceneIds: ["a"] });
    expect(s.scenes.a.status).toBe("arrived");
    s = gameReducer(game, s, { type: "FIX_UPDATE", now: T + 1, insideSceneIds: [] });
    expect(s.scenes.a.status).toBe("locked");
    // Still reachable, just not entered: the graph, not the flag, says so.
    expect(statusOf(game, s, "a")).toBe("available");
    // arrivedAt is retained so the UI does not report a first-visit time twice.
    expect(s.scenes.a.arrivedAt).toBe(T);
  });

  it("keeps a challenge open even if the player steps outside the radius mid-question", () => {
    let s = fresh();
    s = gameReducer(game, s, { type: "FIX_UPDATE", now: T, insideSceneIds: ["a"] });
    s = gameReducer(game, s, { type: "OPEN_CHALLENGE", sceneId: "a", now: T });
    expect(s.scenes.a.status).toBe("challenging");
    s = gameReducer(game, s, { type: "FIX_UPDATE", now: T + 1, insideSceneIds: [] });
    expect(s.scenes.a.status).toBe("challenging");
  });
});

describe("wrong answers cannot advance", () => {
  it("records the attempt and does not complete the scene", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 0 });
    expect(s.scenes.a.status).toBe("challenging");
    expect(s.scenes.a.attempts).toBe(1);
    expect(s.inventory).toEqual([]);
    expect(statusOf(game, s, "b")).toBe("locked");
  });

  it("does not unlock the next scene after any number of wrong answers", () => {
    let s = fresh();
    for (let i = 0; i < 10; i++) {
      s = gameReducer(game, s, {
        type: "SUBMIT_ANSWER",
        sceneId: "a",
        now: T + i,
        selectedIndex: 2,
      });
    }
    expect(s.scenes.a.attempts).toBe(10);
    expect(statusOf(game, s, "b")).toBe("locked");
    expect(availableSceneIds(game, s)).toEqual(["a"]);
  });

  it("rejects an answer submitted for a locked scene", () => {
    const s = fresh();
    const next = gameReducer(game, s, {
      type: "SUBMIT_ANSWER",
      sceneId: "b",
      now: T,
      text: "direction",
    });
    expect(next).toBe(s);
  });

  it("rejects a choice submission with no selection", () => {
    let s = fresh();
    s = gameReducer(game, s, { type: "OPEN_CHALLENGE", sceneId: "a", now: T });
    s = gameReducer(game, s, { type: "SUBMIT_ANSWER", sceneId: "a", now: T });
    expect(s.scenes.a.status).toBe("challenging");
    expect(s.scenes.a.attempts).toBe(1);
  });
});

describe("correct answers advance and unlock the next scene", () => {
  it("completes scene A, grants the keyword, and unlocks B", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    expect(s.scenes.a.status).toBe("completed");
    expect(s.scenes.a.completedAt).toBe(T);
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0].value).toBe("memory");
    expect(s.keywords).toEqual(["memory"]);
    // B is reachable now that A is complete; nothing had to be "unlocked" in the
    // save, because reachability is derived from the graph.
    expect(statusOf(game, s, "b")).toBe("available");
    expect(statusOf(game, s, "c")).toBe("locked");
    expect(availableSceneIds(game, s)).toEqual(["b"]);
    expect(activeScene(game, s)?.id).toBe("b");
    expect(completionRatio(game, s)).toBeCloseTo(1 / 3, 5);
  });

  it("accepts a keyword challenge with a synonym", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    s = solve(s, "b", { type: "SUBMIT_ANSWER", sceneId: "b", now: T, text: "way" }, T);
    expect(s.scenes.b.status).toBe("completed");
    expect(statusOf(game, s, "c")).toBe("available");
  });

  it("walks the full chain to completion", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 }, T);
    s = solve(s, "b", { type: "SUBMIT_ANSWER", sceneId: "b", now: T, text: "direction" }, T);
    s = solve(s, "c", { type: "SUBMIT_ANSWER", sceneId: "c", now: T, text: "home" }, T);

    expect(isGameComplete(game, s)).toBe(true);
    expect(completionRatio(game, s)).toBe(1);
    expect(s.finishedAt).toBe(T);
    expect(s.keywords).toEqual(["memory", "direction"]);
    expect(s.inventory).toHaveLength(3);
    expect(isSceneComplete(s, "c")).toBe(true);
    // A finished game has nothing left to head towards.
    expect(availableSceneIds(game, s)).toEqual([]);
  });
});

describe("revisiting a completed location grants no second reward (spec 17)", () => {
  it("ignores a repeated correct answer on a completed scene", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    const afterFirst = s;

    // Same submission, again and again.
    for (let i = 0; i < 5; i++) {
      s = gameReducer(game, s, {
        type: "SUBMIT_ANSWER",
        sceneId: "a",
        now: T + i,
        selectedIndex: 1,
      });
    }
    expect(s).toBe(afterFirst);
    expect(s.inventory).toHaveLength(1);
    expect(s.keywords).toEqual(["memory"]);
  });

  it("does not re-grant when the player re-enters the radius and reopens the challenge", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    const inventoryAfterFirst = s.inventory.length;

    s = gameReducer(game, s, { type: "FIX_UPDATE", now: T + 1, insideSceneIds: ["a"] });
    s = gameReducer(game, s, { type: "OPEN_CHALLENGE", sceneId: "a", now: T + 1 });
    s = gameReducer(game, s, { type: "ENTER_SCENE", sceneId: "a", now: T + 1 });

    expect(s.scenes.a.status).toBe("completed");
    expect(s.inventory).toHaveLength(inventoryAfterFirst);
    expect(statusOf(game, s, "b")).toBe("available");
  });

  it("keeps only one copy of a keyword even if the reward were issued twice", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    // Force a second completion attempt through the low-level helper path.
    s = gameReducer(game, s, { type: "ENTER_SCENE", sceneId: "a", now: T + 5 });
    s = gameReducer(game, s, { type: "SUBMIT_ANSWER", sceneId: "a", now: T + 5, selectedIndex: 1 });
    expect(s.keywords.filter((k) => k === "memory")).toHaveLength(1);
    expect(s.scenes.a.grantedRewardIds).toEqual([rewardId(game.scenes[0])]);
  });
});

describe("sceneStatuses (map and progress list)", () => {
  it("reports locked / available / completed correctly along the chain", () => {
    let s = fresh();
    let rows = sceneStatuses(game, s);
    expect(rows.map((r) => [r.scene.id, r.status])).toEqual([
      ["a", "available"],
      ["b", "locked"],
      ["c", "locked"],
    ]);
    expect(rows.find((r) => r.scene.id === "a")?.isActive).toBe(true);

    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    rows = sceneStatuses(game, s);
    expect(rows.map((r) => [r.scene.id, r.status])).toEqual([
      ["a", "completed"],
      ["b", "available"],
      ["c", "locked"],
    ]);
    expect(rows.find((r) => r.scene.id === "b")?.isActive).toBe(true);
  });
});

describe("reconcileState (save/load integrity)", () => {
  it("returns a fresh state for a different game id", () => {
    const persisted = { ...fresh(), gameId: "some-other-hunt" };
    const restored = reconcileState(game, persisted, T + 1000);
    expect(statusOf(game, restored, "a")).toBe("available");
    expect(restored.inventory).toEqual([]);
  });

  it("downgrades a mid-arrival scene to the neutral baseline", () => {
    const persisted: Partial<GameState> = {
      ...fresh(),
      currentSceneId: "a",
      scenes: {
        ...fresh().scenes,
        a: { sceneId: "a", status: "arrived", attempts: 0, grantedRewardIds: [], arrivedAt: T },
      },
    };
    const restored = reconcileState(game, persisted, T + 1000);
    // The arrival flag is dropped; reachability still makes it enterable.
    expect(restored.scenes.a.status).toBe("locked");
    expect(statusOf(game, restored, "a")).toBe("available");
  });

  it("refuses a tampered save that marks an unreachable scene complete", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        // Claim scene C is done while A and B were never touched.
        c: { sceneId: "c", status: "completed", attempts: 0, grantedRewardIds: ["x"], completedAt: T },
      },
      inventory: [
        { id: "c:badge:x", type: "badge", title: "cheat", sceneId: "c", acquiredAt: T },
      ],
    };
    const restored = reconcileState(game, persisted, T + 1000);
    expect(restored.scenes.c.status).toBe("locked");
    expect(restored.scenes.c.grantedRewardIds).toEqual([]);
    // The stale reward is dropped along with the bogus completion.
    expect(restored.inventory).toEqual([]);
  });

  it("refuses a save that skips the middle of the chain", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        a: { sceneId: "a", status: "completed", attempts: 0, grantedRewardIds: [], completedAt: T },
        // B skipped entirely, C claimed complete.
        c: { sceneId: "c", status: "completed", attempts: 0, grantedRewardIds: [], completedAt: T },
      },
    };
    const restored = reconcileState(game, persisted, T + 1000);
    expect(restored.scenes.a.status).toBe("completed");
    expect(restored.scenes.c.status).toBe("locked");
  });

  it("drops inventory entries that reference unknown scenes", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        a: { sceneId: "a", status: "completed", attempts: 1, grantedRewardIds: [], completedAt: T },
      },
      inventory: [
        { id: "ghost:item:1", type: "item", title: "ghost", sceneId: "does-not-exist", acquiredAt: T },
      ],
    };
    const restored = reconcileState(game, persisted, T + 1000);
    expect(restored.inventory).toEqual([]);
  });

  it("re-derives keywords from surviving inventory instead of trusting the save", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        a: { sceneId: "a", status: "completed", attempts: 1, grantedRewardIds: [], completedAt: T },
      },
      inventory: [
        { id: "a:keyword:memory", type: "keyword", title: "memory", value: "memory", sceneId: "a", acquiredAt: T },
      ],
      // A hand-injected keyword that no reward produced.
      keywords: ["memory", "I-CHEATED"],
    };
    const restored = reconcileState(game, persisted, T + 1000);
    expect(restored.keywords).toEqual(["memory"]);
  });

  it("keeps a legitimate completed save intact", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    const restored = reconcileState(game, s, T + 60_000);
    expect(restored.scenes.a.status).toBe("completed");
    expect(restored.scenes.a.completedAt).toBe(T);
    expect(statusOf(game, restored, "b")).toBe("available");
    expect(restored.inventory).toHaveLength(1);
    expect(restored.keywords).toEqual(["memory"]);
    // startedAt is preserved, lastUpdatedAt is refreshed.
    expect(restored.startedAt).toBe(T);
    expect(restored.lastUpdatedAt).toBe(T + 60_000);
  });

  it("tolerates a legacy save that stored the derived 'available' status", () => {
    const base = fresh();
    const persisted = {
      ...base,
      scenes: {
        ...base.scenes,
        // An older build wrote "available" into the save.
        a: { sceneId: "a", status: "available" as unknown as "locked", attempts: 0, grantedRewardIds: [] },
      },
    };
    const restored = reconcileState(game, persisted as Partial<GameState>, T + 1000);
    expect(restored.scenes.a.status).toBe("locked");
    expect(statusOf(game, restored, "a")).toBe("available");
  });
});

describe("RESET", () => {
  it("clears all progress", () => {
    let s = fresh();
    s = solve(s, "a", { type: "SUBMIT_ANSWER", sceneId: "a", now: T, selectedIndex: 1 });
    s = gameReducer(game, s, { type: "RESET", now: T + 100 });
    expect(s.inventory).toEqual([]);
    expect(s.keywords).toEqual([]);
    expect(statusOf(game, s, "a")).toBe("available");
    expect(statusOf(game, s, "b")).toBe("locked");
    expect(s.startedAt).toBe(T + 100);
  });
});
