/**
 * Task dependency / unlock tests (recovery batch: reusable quest state).
 *
 * Covers the acceptance chain A -> B -> C where each task declares its
 * prerequisite via `requires` instead of the nextSceneId chain:
 *   - initially only A is startable, B and C stay locked
 *   - completing A opens B, C stays locked; completing B opens C
 *   - save + restore keeps the derived statuses consistent
 *   - repeating a completion cannot double-grant rewards
 *   - a tampered save that skips prerequisites is stripped on reconcile
 *   - a scene requiring two prerequisites opens only after both
 *   - legacy packs without `requires` keep the linear-chain behaviour
 */

import { describe, expect, it } from "vitest";
import {
  availableSceneIds,
  createInitialState,
  gameReducer,
  reconcileState,
  sceneStatuses,
  statusOf,
  type GameState,
} from "@/lib/game/state";
import { validateGame } from "@/lib/game/types";
import type { Game, Scene } from "@/lib/game/types";

const T = 1_700_000_000_000;

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: id.toUpperCase(),
    story: `story ${id}`,
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "text", question: "q", answer: ["go"] },
    reward: { type: "keyword", title: id, value: id },
    ...overrides,
  };
}

/** A -> B -> C expressed purely with declared prerequisites. */
const depGame: Game = {
  id: "dep-hunt",
  language: "zh-CN",
  title: "Dependency Hunt",
  description: "requires-chain fixture",
  version: "1.0.0",
  startLocation: { lat: 0, lng: 0 },
  entrySceneId: "a",
  scenes: [
    scene("a"),
    scene("b", { requires: ["a"] }),
    scene("c", { requires: ["b"], reward: { type: "badge", title: "final", value: "done" } }),
  ],
};

function fresh(game: Game = depGame): GameState {
  return createInitialState(game, T);
}

function solve(
  game: Game,
  state: GameState,
  id: string,
  now = T,
): GameState {
  state = gameReducer(game, state, { type: "ENTER_SCENE", sceneId: id, now });
  state = gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId: id, now });
  return gameReducer(game, state, { type: "SUBMIT_ANSWER", sceneId: id, now, text: "go" });
}

describe("requires chain A -> B -> C", () => {
  it("initially opens only A; B and C stay locked", () => {
    const s = fresh();
    expect(statusOf(depGame, s, "a")).toBe("available");
    expect(statusOf(depGame, s, "b")).toBe("locked");
    expect(statusOf(depGame, s, "c")).toBe("locked");
    expect(availableSceneIds(depGame, s)).toEqual(["a"]);
  });

  it("rejects direct entry into a locked dependent task", () => {
    const s = fresh();
    const next = gameReducer(depGame, s, { type: "ENTER_SCENE", sceneId: "b", now: T });
    expect(next).toBe(s);
    const opened = gameReducer(depGame, s, { type: "OPEN_CHALLENGE", sceneId: "b", now: T });
    expect(opened).toBe(s);
    const answered = gameReducer(depGame, s, {
      type: "SUBMIT_ANSWER",
      sceneId: "b",
      now: T,
      text: "go",
    });
    expect(answered).toBe(s);
  });

  it("completing A opens B but keeps C locked", () => {
    const s = solve(depGame, fresh(), "a");
    expect(s.scenes.a.status).toBe("completed");
    expect(statusOf(depGame, s, "b")).toBe("available");
    expect(statusOf(depGame, s, "c")).toBe("locked");
    expect(availableSceneIds(depGame, s)).toEqual(["b"]);
  });

  it("completing B opens C; the full chain completes", () => {
    let s = solve(depGame, fresh(), "a");
    s = solve(depGame, s, "b", T + 1);
    expect(statusOf(depGame, s, "c")).toBe("available");
    expect(availableSceneIds(depGame, s)).toEqual(["c"]);
    s = solve(depGame, s, "c", T + 2);
    expect(s.scenes.c.status).toBe("completed");
    expect(availableSceneIds(depGame, s)).toEqual([]);
    expect(s.inventory).toHaveLength(3);
  });

  it("survives save + restore with identical statuses and inventory", () => {
    let s = solve(depGame, fresh(), "a");
    s = solve(depGame, s, "b", T + 1);
    const restored = reconcileState(depGame, JSON.parse(JSON.stringify(s)), T + 60_000);
    expect(statusOf(depGame, restored, "a")).toBe("completed");
    expect(statusOf(depGame, restored, "b")).toBe("completed");
    expect(statusOf(depGame, restored, "c")).toBe("available");
    expect(restored.inventory).toHaveLength(2);
    expect(restored.keywords).toEqual(["a", "b"]);
  });

  it("never double-grants a reward on repeated submissions", () => {
    let s = solve(depGame, fresh(), "a");
    const afterFirst = s;
    for (let i = 0; i < 5; i++) {
      s = gameReducer(depGame, s, {
        type: "SUBMIT_ANSWER",
        sceneId: "a",
        now: T + i,
        text: "go",
      });
    }
    expect(s).toBe(afterFirst);
    expect(s.inventory.filter((i) => i.sceneId === "a")).toHaveLength(1);
  });

  it("strips a tampered save that completes C without B", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        c: {
          sceneId: "c",
          status: "completed",
          attempts: 0,
          grantedRewardIds: ["x"],
          completedAt: T,
        },
      },
      inventory: [
        { id: "c:badge:done", type: "badge", title: "cheat", sceneId: "c", acquiredAt: T },
      ],
    };
    const restored = reconcileState(depGame, persisted, T + 1000);
    expect(restored.scenes.c.status).toBe("locked");
    expect(restored.inventory).toEqual([]);
  });

  it("reports locked / available / completed for the map and quest list", () => {
    let s = fresh();
    let rows = sceneStatuses(depGame, s);
    expect(rows.map((r) => [r.scene.id, r.status])).toEqual([
      ["a", "available"],
      ["b", "locked"],
      ["c", "locked"],
    ]);
    s = solve(depGame, s, "a");
    s = solve(depGame, s, "b", T + 1);
    rows = sceneStatuses(depGame, s);
    expect(rows.map((r) => [r.scene.id, r.status])).toEqual([
      ["a", "completed"],
      ["b", "completed"],
      ["c", "available"],
    ]);
  });
});

describe("multiple prerequisites", () => {
  /** Chain a -> b, plus D that requires BOTH a and b to open. */
  const multiGame: Game = {
    ...depGame,
    id: "multi-hunt",
    entrySceneId: "a",
    scenes: [
      scene("a", { nextSceneId: "b" }),
      scene("b"),
      scene("d", { requires: ["a", "b"], reward: { type: "badge", title: "pair", value: "pair" } }),
    ],
  };

  it("keeps D locked until every prerequisite is complete", () => {
    let s = fresh(multiGame);
    expect(availableSceneIds(multiGame, s)).toEqual(["a"]);
    expect(statusOf(multiGame, s, "d")).toBe("locked");

    s = solve(multiGame, s, "a");
    // B is open via the chain, but D still waits for B.
    expect(availableSceneIds(multiGame, s)).toEqual(["b"]);
    expect(statusOf(multiGame, s, "d")).toBe("locked");

    s = solve(multiGame, s, "b", T + 1);
    expect(statusOf(multiGame, s, "d")).toBe("available");
    expect(availableSceneIds(multiGame, s)).toEqual(["d"]);

    // Save + restore keeps the multi-prerequisite unlock intact.
    const restored = reconcileState(multiGame, JSON.parse(JSON.stringify(s)), T + 60_000);
    expect(statusOf(multiGame, restored, "d")).toBe("available");
    expect(restored.inventory).toHaveLength(2);
  });
});

describe("legacy packs without requires keep linear behaviour", () => {
  /** Classic chain a -> b -> c, no declared dependencies anywhere. */
  const legacyGame: Game = {
    id: "legacy-hunt",
    language: "zh-CN",
    title: "Legacy Hunt",
    description: "linear fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "a",
    scenes: [
      scene("a", { nextSceneId: "b" }),
      scene("b", { nextSceneId: "c" }),
      scene("c"),
    ],
  };

  it("walks the chain exactly as before", () => {
    let s = fresh(legacyGame);
    expect(availableSceneIds(legacyGame, s)).toEqual(["a"]);
    expect(statusOf(legacyGame, s, "b")).toBe("locked");

    s = solve(legacyGame, s, "a");
    expect(availableSceneIds(legacyGame, s)).toEqual(["b"]);
    expect(statusOf(legacyGame, s, "c")).toBe("locked");

    s = solve(legacyGame, s, "b", T + 1);
    expect(availableSceneIds(legacyGame, s)).toEqual(["c"]);

    s = solve(legacyGame, s, "c", T + 2);
    expect(availableSceneIds(legacyGame, s)).toEqual([]);
  });

  it("still refuses a save that skips the middle of the chain", () => {
    const base = fresh(legacyGame);
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        a: { sceneId: "a", status: "completed", attempts: 0, grantedRewardIds: [], completedAt: T },
        c: { sceneId: "c", status: "completed", attempts: 0, grantedRewardIds: [], completedAt: T },
      },
    };
    const restored = reconcileState(legacyGame, persisted, T + 1000);
    expect(restored.scenes.a.status).toBe("completed");
    expect(restored.scenes.c.status).toBe("locked");
  });
});

describe("validateGame: requires schema checks", () => {
  const pack = (scenes: Scene[]) => ({
    id: "v-hunt",
    language: "zh-CN",
    title: "V",
    description: "V",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: scenes[0]?.id,
    scenes,
  });

  it("accepts a valid requires chain without orphan warnings", () => {
    const { game, issues } = validateGame(pack(depGame.scenes));
    expect(game.scenes).toHaveLength(3);
    // A scene reachable only through `requires` is not an orphan.
    expect(issues).toEqual([]);
  });

  it("rejects requires pointing at a missing scene", () => {
    expect(() =>
      validateGame(pack([scene("a"), scene("b", { requires: ["ghost"] })])),
    ).toThrow(/ghost/);
  });

  it("rejects self-dependency", () => {
    expect(() =>
      validateGame(pack([scene("a", { requires: ["a"] })])),
    ).toThrow(/依赖自身/);
  });

  it("rejects dependency cycles", () => {
    expect(() =>
      validateGame(
        pack([scene("a", { requires: ["b"] }), scene("b", { requires: ["a"] })]),
      ),
    ).toThrow(/前置依赖存在环/);
  });
});
