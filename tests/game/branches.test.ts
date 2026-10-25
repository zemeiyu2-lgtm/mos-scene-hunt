/**
 * Branching choices & multiple endings tests (recovery batch 3).
 *
 * A choice challenge may declare `branches`: option index -> target scene.
 * Only a SUCCESSFUL submit records a route; the route (replacing the static
 * nextSceneId) decides which scene opens. Graded choices keep their grading -
 * wrong answers never advance - and their route is content-determined (the
 * correct answer's branch, re-derived on restore). Reflective choices keep
 * their semantics: every deliberate option submits, and each can lead down
 * its own route. The hunt completes when ANY legal ending is completed.
 */

import { describe, expect, it } from "vitest";
import {
  availableSceneIds,
  createInitialState,
  gameReducer,
  isGameComplete,
  nextSceneIdOf,
  reconcileState,
  statusOf,
} from "@/lib/game/state";
import { validateGame } from "@/lib/game/types";
import type { Game, Scene } from "@/lib/game/types";
import type { GameState } from "@/lib/game/state";

const T = 1_700_000_000_000;

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: id.toUpperCase(),
    story: `story ${id}`,
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "text", question: "q", answer: ["go"] },
    reward: { type: "keyword", title: `kw-${id}`, value: `kw-${id}` },
    ...overrides,
  };
}

const choice = (overrides: Record<string, unknown> = {}) => ({
  type: "choice" as const,
  question: "选一条路",
  options: ["走向东", "走向西"],
  ...overrides,
});

/** entry --A--> a1 --> end-a ; entry --B--> b1 --> end-b */
const branchGame: Game = {
  id: "branch-hunt",
  language: "zh-CN",
  title: "Branch Hunt",
  description: "branch fixture",
  version: "1.0.0",
  startLocation: { lat: 0, lng: 0 },
  entrySceneId: "entry",
  scenes: [
    scene("entry", {
      nextSceneId: null,
      challenge: choice({ reflective: true, branches: { "0": "a1", "1": "b1" } }),
    }),
    scene("a1", { nextSceneId: "end-a" }),
    scene("end-a", {}),
    scene("b1", { nextSceneId: "end-b" }),
    scene("end-b", {}),
  ],
};

function fresh(game: Game = branchGame): GameState {
  return createInitialState(game, T);
}

function submit(game: Game, state: GameState, id: string, action: { selectedIndex?: number; text?: string }, now = T): GameState {
  state = gameReducer(game, state, { type: "ENTER_SCENE", sceneId: id, now });
  state = gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId: id, now });
  return gameReducer(game, state, { type: "SUBMIT_ANSWER", sceneId: id, now, ...action });
}

function solveText(game: Game, state: GameState, id: string, now = T): GameState {
  return submit(game, state, id, { text: "go" }, now);
}

describe("legacy single-line packs", () => {
  const linearGame: Game = {
    ...branchGame,
    id: "linear-hunt",
    entrySceneId: "a",
    scenes: [
      scene("a", { nextSceneId: "b" }),
      scene("b", { nextSceneId: "end" }),
      scene("end", {}),
    ],
  };

  it("advances in the original order and finishes at the last scene", () => {
    let s = fresh(linearGame);
    expect(availableSceneIds(linearGame, s)).toEqual(["a"]);
    s = solveText(linearGame, s, "a");
    expect(availableSceneIds(linearGame, s)).toEqual(["b"]);
    s = solveText(linearGame, s, "b", T + 1);
    expect(availableSceneIds(linearGame, s)).toEqual(["end"]);
    s = solveText(linearGame, s, "end", T + 2);
    expect(availableSceneIds(linearGame, s)).toEqual([]);
    expect(isGameComplete(linearGame, s)).toBe(true);
    expect(s.finishedAt).toBe(T + 2);
  });

  it("is not complete before the last scene is done", () => {
    const s = solveText(linearGame, fresh(linearGame), "a");
    expect(isGameComplete(linearGame, s)).toBe(false);
  });
});

describe("branch routing", () => {
  it("records no route before any successful submit", () => {
    const s = fresh();
    expect(s.routes).toEqual({});
    expect(statusOf(branchGame, s, "a1")).toBe("locked");
    expect(statusOf(branchGame, s, "b1")).toBe("locked");
  });

  it("opens only the chosen route after submitting option A", () => {
    const s = submit(branchGame, fresh(), "entry", { selectedIndex: 0 });
    expect(s.routes?.entry).toBe("a1");
    expect(statusOf(branchGame, s, "a1")).toBe("available");
    expect(statusOf(branchGame, s, "b1")).toBe("locked");
    expect(nextSceneIdOf(branchGame, s, "entry")).toBe("a1");
  });

  it("opens the other route after submitting option B", () => {
    const s = submit(branchGame, fresh(), "entry", { selectedIndex: 1 });
    expect(s.routes?.entry).toBe("b1");
    expect(statusOf(branchGame, s, "b1")).toBe("available");
    expect(statusOf(branchGame, s, "a1")).toBe("locked");
  });

  it("finishes at different endings depending on the route", () => {
    const east = solveText(branchGame, solveText(branchGame, submit(branchGame, fresh(), "entry", { selectedIndex: 0 }), "a1", T + 1), "end-a", T + 2);
    expect(isGameComplete(branchGame, east)).toBe(true);
    expect(east.finishedAt).toBe(T + 2);

    const west = solveText(branchGame, solveText(branchGame, submit(branchGame, fresh(), "entry", { selectedIndex: 1 }), "b1", T + 1), "end-b", T + 2);
    expect(isGameComplete(branchGame, west)).toBe(true);
  });

  it("does not require the unchosen branch: completing one ending is enough", () => {
    const east = solveText(branchGame, solveText(branchGame, submit(branchGame, fresh(), "entry", { selectedIndex: 0 }), "a1", T + 1), "end-a", T + 2);
    expect(statusOf(branchGame, east, "b1")).toBe("locked");
    expect(statusOf(branchGame, east, "end-b")).toBe("locked");
    // Completion stands even though end-b was never visited.
    expect(isGameComplete(branchGame, east)).toBe(true);
  });

  it("converges when both options point at the same scene", () => {
    const joinGame: Game = {
      ...branchGame,
      id: "join-hunt",
      scenes: [
        scene("entry", {
          nextSceneId: null,
          challenge: choice({ reflective: true, branches: { "0": "join", "1": "join" } }),
        }),
        scene("join", { nextSceneId: "end" }),
        scene("end", {}),
      ],
    };
    const viaA = solveText(joinGame, submit(joinGame, fresh(joinGame), "entry", { selectedIndex: 0 }), "join", T + 1);
    const viaB = solveText(joinGame, submit(joinGame, fresh(joinGame), "entry", { selectedIndex: 1 }), "join", T + 1);
    expect(availableSceneIds(joinGame, viaA)).toEqual(["end"]);
    expect(availableSceneIds(joinGame, viaB)).toEqual(["end"]);
  });

  it("falls back to nextSceneId when the chosen option has no branch", () => {
    const mixed: Game = {
      ...branchGame,
      id: "mixed-hunt",
      scenes: [
        scene("entry", {
          nextSceneId: "fallback",
          challenge: choice({ reflective: true, branches: { "0": "a1" } }),
        }),
        scene("a1", {}),
        scene("fallback", {}),
      ],
    };
    const west = submit(mixed, fresh(mixed), "entry", { selectedIndex: 1 });
    expect(statusOf(mixed, west, "fallback")).toBe("available");
    expect(statusOf(mixed, west, "a1")).toBe("locked");
  });
});

describe("graded (non-reflective) choices", () => {
  /** Graded choice, answer = 0, only that branch declared. */
  const gradedGame: Game = {
    ...branchGame,
    id: "graded-hunt",
    entrySceneId: "g",
    scenes: [
      scene("g", {
        nextSceneId: null,
        challenge: choice({ answer: 0, branches: { "0": "g1" } }),
      }),
      scene("g1", { nextSceneId: "end-g" }),
      scene("end-g", {}),
    ],
  };

  it("keeps grading: a wrong answer never completes or advances", () => {
    let s = submit(gradedGame, fresh(gradedGame), "g", { selectedIndex: 1 });
    expect(s.scenes.g.status).toBe("challenging");
    expect(s.scenes.g.status !== "completed").toBe(true);
    expect(s.routes?.g).toBeUndefined();
    expect(availableSceneIds(gradedGame, s)).toEqual(["g"]);
    // Repeated wrong attempts still do not advance.
    s = submit(gradedGame, s, "g", { selectedIndex: 1 }, T + 1);
    expect(availableSceneIds(gradedGame, s)).toEqual(["g"]);
  });

  it("advances along the correct answer's branch", () => {
    const s = submit(gradedGame, fresh(gradedGame), "g", { selectedIndex: 0 });
    expect(s.scenes.g.status).toBe("completed");
    expect(s.routes?.g).toBe("g1");
    expect(availableSceneIds(gradedGame, s)).toEqual(["g1"]);
  });

  it("re-derives the route from the pack on restore, ignoring a forged one", () => {
    const played = submit(gradedGame, fresh(gradedGame), "g", { selectedIndex: 0 });
    const restored = reconcileState(gradedGame, { ...played, routes: { g: "elsewhere" } }, T + 5);
    expect(restored.routes?.g).toBe("g1");
    expect(availableSceneIds(gradedGame, restored)).toEqual(["g1"]);
  });

  it("rejects branch declarations on wrong options of a graded choice", () => {
    const bad: Game = {
      ...gradedGame,
      scenes: [
        scene("g", { challenge: choice({ answer: 0, branches: { "0": "g1", "1": "g1" } }) }),
        scene("g1", {}),
        scene("end-g", {}),
      ],
    };
    expect(() => validateGame(bad)).toThrowError(/正确答案的分支/);
  });
});

describe("reflective choices", () => {
  it("lets each deliberate option open its own route", () => {
    const s0 = submit(branchGame, fresh(), "entry", { selectedIndex: 0 });
    const s1 = submit(branchGame, fresh(), "entry", { selectedIndex: 1 });
    expect(statusOf(branchGame, s0, "a1")).toBe("available");
    expect(statusOf(branchGame, s1, "b1")).toBe("available");
  });

  it("keeps the chosen route across save/restore", () => {
    const played = submit(branchGame, fresh(), "entry", { selectedIndex: 1 });
    const restored = reconcileState(branchGame, played, T + 5);
    expect(restored.routes?.entry).toBe("b1");
    expect(statusOf(branchGame, restored, "b1")).toBe("available");
    expect(statusOf(branchGame, restored, "a1")).toBe("locked");
    // Playing on from the restored save still works.
    const next = solveText(branchGame, restored, "b1", T + 6);
    expect(availableSceneIds(branchGame, next)).toEqual(["end-b"]);
  });

  it("drops route entries the pack does not declare", () => {
    const played = submit(branchGame, fresh(), "entry", { selectedIndex: 0 });
    const tampered: GameState = { ...played, routes: { entry: "end-b", ghost: "a1" } };
    const restored = reconcileState(branchGame, tampered, T + 5);
    // The forged replacement is not a declared branch, so it is dropped. The
    // original choice cannot be recovered from a hand-edited save - the safe
    // outcome is no route, hence both branch scenes stay locked.
    expect(restored.routes?.entry).toBeUndefined();
    expect(restored.routes?.ghost).toBeUndefined();
    expect(statusOf(branchGame, restored, "a1")).toBe("locked");
    expect(statusOf(branchGame, restored, "b1")).toBe("locked");
  });

  it("strips a completion forged behind an unrecorded route", () => {
    // b1 sits behind the reflective branch; without route entry->b1 the gate
    // is closed, so a hand-written completed b1 must be stripped.
    const forged: GameState = {
      ...fresh(),
      scenes: {
        ...fresh().scenes,
        entry: { ...fresh().scenes.entry, status: "completed", completedAt: T },
        b1: { sceneId: "b1", status: "completed", completedAt: T, attempts: 0, grantedRewardIds: ["b1:keyword:kw-b1"] },
      },
    };
    const restored = reconcileState(branchGame, forged, T + 5);
    expect(restored.scenes.b1.status).toBe("locked");
    expect(restored.inventory).toEqual([]);
  });
});

describe("compatibility and validation", () => {
  it("keeps requires and requiresItems working alongside branches", () => {
    const combo: Game = {
      ...branchGame,
      id: "combo-hunt",
      scenes: [
        scene("entry", {
          nextSceneId: null,
          challenge: choice({ reflective: true, branches: { "0": "gated", "1": "producer" } }),
        }),
        scene("producer", { nextSceneId: "gated", reward: { type: "item", title: "钥匙", value: "k" } }),
        // The item gate holds even though the branch route to `gated` is recorded.
        scene("gated", { requiresItems: ["k"], reward: { type: "keyword", title: "g", value: "g" } }),
      ],
    };
    const s = submit(combo, fresh(combo), "entry", { selectedIndex: 0 });
    // Route recorded, but the item gate still locks the gated scene.
    expect(s.routes?.entry).toBe("gated");
    expect(statusOf(combo, s, "gated")).toBe("locked");
    expect(statusOf(combo, s, "producer")).toBe("locked");
    // Taking the producer branch mints the item, which opens the gated scene.
    const s1 = submit(combo, fresh(combo), "entry", { selectedIndex: 1 });
    const s2 = solveText(combo, s1, "producer", T + 1);
    expect(statusOf(combo, s2, "gated")).toBe("available");
    expect(validateGame(combo).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("does not double-grant rewards on revisit after branching", () => {
    const s1 = submit(branchGame, fresh(), "entry", { selectedIndex: 0 });
    const again = submit(branchGame, s1, "entry", { selectedIndex: 1 }, T + 1);
    expect(again).toBe(s1);
    expect(s1.inventory.filter((item) => item.sceneId === "entry")).toHaveLength(1);
  });

  it("preserves branches through JSON import/export round trip", () => {
    const json = JSON.stringify(branchGame);
    const { game, issues } = validateGame(JSON.parse(json));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(game.scenes[0].challenge?.branches).toEqual({ "0": "a1", "1": "b1" });
  });

  it("rejects unknown branch targets, self targets and invalid indexes", () => {
    const unknown: Game = {
      ...branchGame,
      scenes: [scene("entry", { challenge: choice({ reflective: true, branches: { "0": "nowhere" } }) }), ...branchGame.scenes.slice(1)],
    };
    expect(() => validateGame(unknown)).toThrowError(/分支目标场景不存在/);

    const self: Game = {
      ...branchGame,
      scenes: [scene("entry", { challenge: choice({ reflective: true, branches: { "0": "entry" } }) }), ...branchGame.scenes.slice(1)],
    };
    expect(() => validateGame(self)).toThrowError(/不能指向本场景/);

    const badIndex: Game = {
      ...branchGame,
      scenes: [scene("entry", { challenge: choice({ reflective: true, branches: { "9": "a1" } }) }), ...branchGame.scenes.slice(1)],
    };
    expect(() => validateGame(badIndex)).toThrowError(/不是有效的选项下标/);
  });
});
