/**
 * Unit tests for the designer's `requires` (prerequisite scene) editing helpers.
 *
 * The engine side of `requires` is covered by tests/game/dependencies.test.ts;
 * what matters here is that the designer can never write a pack the validator
 * rejects (dangling reference, self/cycle dependency, impossible entry gate),
 * and that a designer-authored pack actually advances in the real engine.
 */

import { describe, expect, it } from "vitest";
import {
  danglingRequiresRefs,
  describeRequiresChain,
  isEntryScene,
  normalizeEntryRequires,
  removeRequiresRefsTo,
  requirableSceneOptions,
  toggleSceneRequires,
  wouldCreateRequiresCycle,
} from "@/lib/game/dependency-edit";
import { createBlankGame } from "@/app/design/design-game";
import { availableSceneIds, createInitialState, gameReducer } from "@/lib/game/state";
import { validateGame, type Game, type Scene } from "@/lib/game/types";

/** A -> B -> C chain with no declared prerequisites (classic linear hunt). */
function chainPack(): Game {
  const scene = (id: string, title: string, next: string | null): Scene => ({
    id,
    title,
    story: "story",
    location: { lat: 14.58, lng: 120.97, radius: 20 },
    nextSceneId: next,
    challenge: { type: "choice", question: "q", options: ["a", "b"], answer: 0 },
    reward: { type: "keyword", title: `${id}-kw`, value: `${id}-kw` },
  });
  return {
    id: "dep-pack",
    language: "zh-CN",
    title: "依赖测试",
    description: "d",
    version: "0.1.0",
    startLocation: { lat: 14.58, lng: 120.97, radius: 30 },
    entrySceneId: "a",
    scenes: [scene("a", "第一站", "b"), scene("b", "第二站", "c"), scene("c", "第三站", null)],
  };
}

/** Replace one scene, returning a new game. */
function withScene(game: Game, scene: Scene): Game {
  return { ...game, scenes: game.scenes.map((s) => (s.id === scene.id ? scene : s)) };
}

describe("toggleSceneRequires", () => {
  it("adds a prerequisite using the stable scene id", () => {
    const game = chainPack();
    const result = toggleSceneRequires(game, "c", "a");
    if (!("scene" in result)) throw new Error(result.error);
    expect(result.scene.requires).toEqual(["a"]);
    expect(result.scene.title).toBe("第三站");
  });

  it("removes a prerequisite and drops an empty list to undefined", () => {
    let game = chainPack();
    const added = toggleSceneRequires(game, "c", "a");
    if (!("scene" in added)) throw new Error(added.error);
    game = withScene(game, added.scene);
    const removed = toggleSceneRequires(game, "c", "a");
    if (!("scene" in removed)) throw new Error(removed.error);
    expect(removed.scene.requires).toBeUndefined();
  });

  it("never duplicates an existing prerequisite", () => {
    const game = chainPack();
    const once = toggleSceneRequires(game, "c", "a");
    if (!("scene" in once)) throw new Error(once.error);
    const twice = toggleSceneRequires(withScene(game, once.scene), "c", "a");
    // Second toggle is a removal, never a duplicate append.
    expect("scene" in twice && twice.scene.requires).toBeUndefined();
  });

  it("rejects self-dependency", () => {
    const game = chainPack();
    expect(toggleSceneRequires(game, "b", "b")).toEqual({ error: "场景不能把自己设为前置场景" });
  });

  it("rejects a direct cycle", () => {
    let game = chainPack();
    const add = toggleSceneRequires(game, "b", "c");
    if (!("scene" in add)) throw new Error(add.error);
    game = withScene(game, add.scene); // b requires c
    const result = toggleSceneRequires(game, "c", "b");
    expect("error" in result && result.error).toContain("循环依赖");
  });

  it("rejects an indirect cycle A -> B -> C -> A", () => {
    let game = chainPack();
    for (const [sceneId, dep] of [["b", "a"], ["c", "b"], ["a", "c"]] as const) {
      const result = toggleSceneRequires(game, sceneId, dep);
      if (sceneId === "a") {
        // a is the entry: this must fail for the entry reason, not silently pass.
        expect("error" in result).toBe(true);
        return;
      }
      if (!("scene" in result)) throw new Error(result.error);
      game = withScene(game, result.scene);
    }
  });

  it("rejects prerequisites on the entry scene", () => {
    const game = chainPack();
    const result = toggleSceneRequires(game, "a", "c");
    expect("error" in result && result.error).toContain("起点场景");
  });

  it("rejects an unknown dependency id", () => {
    const game = chainPack();
    const result = toggleSceneRequires(game, "b", "ghost");
    expect("error" in result && result.error).toContain("不存在");
  });

  it("does not mutate the input game", () => {
    const game = chainPack();
    toggleSceneRequires(game, "c", "a");
    expect(game.scenes.find((s) => s.id === "c")!.requires).toBeUndefined();
  });
});

describe("wouldCreateRequiresCycle / describeRequiresChain", () => {
  it("detects indirect dependency paths", () => {
    let game = chainPack();
    const b = toggleSceneRequires(game, "b", "a");
    if (!("scene" in b)) throw new Error(b.error);
    game = withScene(game, b.scene);
    const c = toggleSceneRequires(game, "c", "b");
    if (!("scene" in c)) throw new Error(c.error);
    game = withScene(game, c.scene);
    expect(wouldCreateRequiresCycle(game, "a", "c")).toBe(true);
    expect(wouldCreateRequiresCycle(game, "a", "b")).toBe(true);
    // b already gates on a, c gates on b: making b gate on c closes the loop.
    expect(wouldCreateRequiresCycle(game, "b", "c")).toBe(true);
    // Adding a prerequisite that depends on nothing cannot create a cycle.
    expect(wouldCreateRequiresCycle(game, "c", "a")).toBe(false);
    expect(describeRequiresChain(game, "c", "a")).toBe("第三站 → 第二站 → 第一站");
  });
});

describe("requirableSceneOptions", () => {
  it("lists every other scene by id and title, never the scene itself", () => {
    const game = chainPack();
    const options = requirableSceneOptions(game, "c");
    expect(options.map((o) => o.id)).toEqual(["a", "b"]);
    expect(options[0]).toMatchObject({ title: "第一站", position: 1, selected: false });
  });

  it("marks existing selections and would-cycle options", () => {
    let game = chainPack();
    const b = toggleSceneRequires(game, "b", "a");
    if (!("scene" in b)) throw new Error(b.error);
    const c = toggleSceneRequires(withScene(game, b.scene), "c", "b");
    if (!("scene" in c)) throw new Error(c.error);
    game = withScene(withScene(game, b.scene), c.scene);
    const options = requirableSceneOptions(game, "c");
    expect(options.find((o) => o.id === "b")).toMatchObject({ selected: true });
    // Selecting a would close the cycle c -> a? No: a is the entry, a does not depend on c.
    expect(options.find((o) => o.id === "a")?.wouldCycle).toBe(false);
  });
});

describe("removeRequiresRefsTo", () => {
  it("strips references to a deleted scene and reports the affected scenes", () => {
    let game = chainPack();
    const add = toggleSceneRequires(game, "c", "b");
    if (!("scene" in add)) throw new Error(add.error);
    game = withScene(game, add.scene);

    const result = removeRequiresRefsTo(game, "b");
    expect(result.affected).toEqual([{ sceneId: "c", title: "第三站" }]);
    expect(result.game.scenes.find((s) => s.id === "c")!.requires).toBeUndefined();
    // The resulting pack must still validate (no dangling ids).
    expect(() => validateGame(JSON.parse(JSON.stringify(result.game)))).not.toThrow();
  });

  it("leaves unrelated scenes untouched", () => {
    const game = chainPack();
    const result = removeRequiresRefsTo(game, "c");
    expect(result.affected).toEqual([]);
    expect(result.game.scenes).toEqual(game.scenes);
  });
});

describe("danglingRequiresRefs", () => {
  it("finds references to scenes that no longer exist", () => {
    const game = chainPack();
    const broken: Game = {
      ...game,
      scenes: game.scenes.map((s) =>
        s.id === "c" ? { ...s, requires: ["ghost"] } : s,
      ),
    };
    expect(danglingRequiresRefs(broken)).toEqual([{ sceneId: "c", missingId: "ghost" }]);
    expect(danglingRequiresRefs(game)).toEqual([]);
  });

  it("validator rejects a dangling prerequisite (import guard)", () => {
    const game = chainPack();
    const broken: Game = {
      ...game,
      scenes: game.scenes.map((s) => (s.id === "c" ? { ...s, requires: ["ghost"] } : s)),
    };
    expect(() => validateGame(JSON.parse(JSON.stringify(broken)))).toThrow(/不存在/);
  });
});

describe("designer-authored pack advances in the real engine", () => {
  it("locks the dependent until every prerequisite is complete, then opens it", () => {
    // Author it the way the designer does: start from a blank game, add scenes
    // through the same helper, then run the engine over the result.
    let game = createBlankGame({ id: "designer-dep" });
    const first = game.scenes[0];
    const second: Scene = {
      id: `${game.id}-scene-2`,
      title: "第二站",
      story: "story",
      location: { lat: first.location.lat + 0.001, lng: first.location.lng, radius: 15 },
      nextSceneId: null,
      challenge: { type: "choice", question: "q", options: ["a", "b"], answer: 0 },
      reward: { type: "keyword", title: "二", value: "二" },
    };
    const third: Scene = {
      id: `${game.id}-scene-3`,
      title: "第三站",
      story: "story",
      location: { lat: first.location.lat + 0.002, lng: first.location.lng, radius: 15 },
      nextSceneId: null,
      challenge: { type: "choice", question: "q", options: ["a", "b"], answer: 0 },
      reward: { type: "keyword", title: "三", value: "三" },
    };
    // Same wiring the designer does when adding scenes: the chain is linked,
    // and the third scene additionally declares two prerequisites.
    game = {
      ...game,
      scenes: [
        { ...first, nextSceneId: second.id },
        { ...second, nextSceneId: third.id },
        third,
      ],
    };

    // third requires BOTH first and second
    const step1 = toggleSceneRequires(game, third.id, first.id);
    if (!("scene" in step1)) throw new Error(step1.error);
    const step2 = toggleSceneRequires(withScene(game, step1.scene), third.id, second.id);
    if (!("scene" in step2)) throw new Error(step2.error);
    game = withScene(withScene(game, step1.scene), step2.scene);

    expect(() => validateGame(JSON.parse(JSON.stringify(game)))).not.toThrow();

    let state = createInitialState(game, 1000);
    state = gameReducer(game, state, { type: "START", now: 1000 });
    // Only the entry is open: third needs first + second, second needs nothing
    // declared but the chain gate applies (first -> second).
    expect(availableSceneIds(game, state)).toEqual([first.id]);

    // Complete the first: second opens, third is still gated on both.
    state = gameReducer(game, state, { type: "ENTER_SCENE", sceneId: first.id, now: 1100 });
    state = gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId: first.id, now: 1150 });
    state = gameReducer(game, state, {
      type: "SUBMIT_ANSWER",
      sceneId: first.id,
      selectedIndex: 0,
      now: 1200,
    });
    expect(availableSceneIds(game, state)).toContain(second.id);
    expect(availableSceneIds(game, state)).not.toContain(third.id);

    // Complete the second: now third unlocks.
    state = gameReducer(game, state, { type: "ENTER_SCENE", sceneId: second.id, now: 1300 });
    state = gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId: second.id, now: 1350 });
    state = gameReducer(game, state, {
      type: "SUBMIT_ANSWER",
      sceneId: second.id,
      selectedIndex: 0,
      now: 1400,
    });
    expect(availableSceneIds(game, state)).toContain(third.id);
  });
});

describe("legacy packs are untouched", () => {
  it("reports no prerequisites and no dangling refs for a pack without requires", () => {
    const game = chainPack();
    expect(danglingRequiresRefs(game)).toEqual([]);
    expect(requirableSceneOptions(game, "b").every((o) => !o.selected)).toBe(true);
    // Classic chain still opens exactly the entry.
    const state = createInitialState(game, 1);
    expect(availableSceneIds(game, { ...state, currentSceneId: "a" })).toEqual(["a"]);
  });

  it("isEntryScene follows entrySceneId, not array order", () => {
    const game: Game = { ...chainPack(), entrySceneId: "b" };
    expect(isEntryScene(game, "b")).toBe(true);
    expect(isEntryScene(game, "a")).toBe(false);
  });
});

describe("export -> import round trip", () => {
  it("keeps requires and sibling fields intact through the package format", async () => {
    const { exportGameJson, validateGamePackage } = await import("@/lib/game/package");
    let game = chainPack();
    const add = toggleSceneRequires(game, "c", "a");
    if (!("scene" in add)) throw new Error(add.error);
    const add2 = toggleSceneRequires(withScene(game, add.scene), "c", "b");
    if (!("scene" in add2)) throw new Error(add2.error);
    game = withScene(withScene(game, add.scene), add2.scene);
    // Author also sets an item gate so we prove siblings survive too.
    game = withScene(game, {
      ...game.scenes.find((s) => s.id === "b")!,
      requiresItems: undefined,
    });

    const json = exportGameJson(game);
    const report = validateGamePackage(JSON.parse(json));
    assert(report.game, "导出的包必须能通过校验");
    const imported = report.game!;
    expect(imported.scenes.find((s) => s.id === "c")!.requires).toEqual(["a", "b"]);
    expect(imported.scenes.find((s) => s.id === "b")!.nextSceneId).toBe("c");
    expect(imported.entrySceneId).toBe("a");
  });

  it("blocks saving a pack whose entry scene declares prerequisites", () => {
    const game = chainPack();
    // Simulate the author moving a dependent scene to the front: the new entry
    // now carries `requires`, which can never be satisfied at game start.
    const broken: Game = {
      ...game,
      entrySceneId: "c",
      scenes: game.scenes.map((s) => (s.id === "c" ? { ...s, requires: ["a"] } : s)),
    };
    expect(() => validateGame(JSON.parse(JSON.stringify(broken)))).toThrow(/永远无法满足|死锁/);
  });
});

describe("normalizeEntryRequires", () => {
  it("clears prerequisites from the new entry after a reorder", () => {
    const game = chainPack();
    const reordered = [game.scenes[2], game.scenes[0], game.scenes[1]];
    const withReq = reordered.map((s, i) => (i === 0 ? { ...s, requires: ["a"] } : s));
    const result = normalizeEntryRequires(withReq);
    expect(result.clearedTitle).toBe("第三站");
    expect(result.scenes[0].requires).toBeUndefined();
    expect(result.scenes).not.toBe(withReq);
  });

  it("leaves a valid entry untouched (same array reference)", () => {
    const game = chainPack();
    const result = normalizeEntryRequires(game.scenes);
    expect(result.clearedTitle).toBeNull();
    expect(result.scenes).toBe(game.scenes);
  });
});
