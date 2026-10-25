/**
 * Item gating / combine-task tests (recovery batch 2).
 *
 * Covers the minimal "hold items -> combine at a scene" mechanic:
 *   - item rewards mint inventory records; gating matches item KIND ids
 *     (`value ?? title`), not reward record ids
 *   - a combine scene is a plain scene gated by `requiresItems`
 *   - the combine result is minted through the normal reward pipeline
 *   - `requires` (task gate) and `requiresItems` (item gate) are independent
 *     and both must hold when both are declared
 *   - saves round-trip; tampered items/completions are stripped on reconcile
 *   - packs without `requiresItems` behave exactly as before
 *   - schema validation rejects unusable item references
 *   - the Markdown round trip does not silently drop the new fields
 */

import { describe, expect, it } from "vitest";
import {
  availableSceneIds,
  createInitialState,
  gameReducer,
  reconcileState,
  rewardId,
  statusOf,
  type GameState,
} from "@/lib/game/state";
import { validateGame } from "@/lib/game/types";
import { gameToMarkdown, markdownToGame } from "@/lib/game/package";
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
    reward: { type: "keyword", title: `kw-${id}`, value: `kw-${id}` },
    ...overrides,
  };
}

const item = (value: string, title = value) => ({
  type: "item" as const,
  title,
  value,
});

/**
 * gather -> gather2 is the classic chain. gather/gather2 both mint the SAME
 * item kind "bronze-key" through different reward records. combine is gated
 * purely by holding that kind; "after" requires the combine task; "side"
 * mints another kind; "both" needs a task AND an item.
 */
const itemGame: Game = {
  id: "items-hunt",
  language: "zh-CN",
  title: "Items Hunt",
  description: "requiresItems fixture",
  version: "1.0.0",
  startLocation: { lat: 0, lng: 0 },
  entrySceneId: "gather",
  scenes: [
    scene("gather", { nextSceneId: "gather2", reward: item("bronze-key", "铜钥匙") }),
    scene("gather2", { reward: item("bronze-key", "铜钥匙") }),
    scene("combine", {
      requiresItems: ["bronze-key"],
      reward: item("treasure-map", "藏宝图"),
    }),
    scene("after", { requires: ["combine"], reward: { type: "keyword", title: "opened", value: "opened" } }),
    scene("side", { requires: ["gather"], reward: item("special-item", "信物") }),
    scene("both", {
      requires: ["gather2"],
      requiresItems: ["special-item"],
      reward: { type: "badge", title: "both", value: "both" },
    }),
  ],
};

function fresh(game: Game = itemGame): GameState {
  return createInitialState(game, T);
}

function solve(game: Game, state: GameState, id: string, now = T): GameState {
  state = gameReducer(game, state, { type: "ENTER_SCENE", sceneId: id, now });
  state = gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId: id, now });
  return gameReducer(game, state, { type: "SUBMIT_ANSWER", sceneId: id, now, text: "go" });
}

describe("item rewards mint inventory records", () => {
  it("puts the correct item into inventory on completion", () => {
    const s = solve(itemGame, fresh(), "gather");
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0]).toMatchObject({
      id: rewardId(itemGame.scenes[0]),
      type: "item",
      value: "bronze-key",
      title: "铜钥匙",
      sceneId: "gather",
    });
  });

  it("treats different records of the same item kind as one held kind", () => {
    let s = solve(itemGame, fresh(), "gather");
    s = solve(itemGame, s, "gather2", T + 1);
    // Two scenes minted the same kind: record ids differ, kind matches both.
    const records = s.inventory.filter((i) => i.value === "bronze-key");
    expect(records).toHaveLength(2);
    expect(records[0].id).not.toBe(records[1].id);
    // Holding the kind unlocks the combine scene exactly once over.
    expect(statusOf(itemGame, s, "combine")).toBe("available");
    expect(availableSceneIds(itemGame, s).filter((id) => id === "combine")).toHaveLength(1);
  });

  it("never double-grants a task reward on repeated submissions", () => {
    let s = solve(itemGame, fresh(), "gather");
    const afterFirst = s;
    for (let i = 0; i < 5; i++) {
      s = gameReducer(itemGame, s, {
        type: "SUBMIT_ANSWER",
        sceneId: "gather",
        now: T + i,
        text: "go",
      });
    }
    expect(s).toBe(afterFirst);
    expect(s.inventory.filter((i) => i.value === "bronze-key")).toHaveLength(1);
  });
});

describe("requiresItems gating on the combine scene", () => {
  it("keeps the combine scene locked while any required item is missing", () => {
    const s = fresh();
    expect(statusOf(itemGame, s, "combine")).toBe("locked");
    expect(availableSceneIds(itemGame, s)).not.toContain("combine");
  });

  it("opens the combine scene once all required items are held", () => {
    const s = solve(itemGame, fresh(), "gather");
    expect(statusOf(itemGame, s, "combine")).toBe("available");
    expect(availableSceneIds(itemGame, s)).toContain("combine");
  });

  it("rejects direct reducer entry, challenge and submission on a locked combine scene", () => {
    const s = fresh();
    const entered = gameReducer(itemGame, s, { type: "ENTER_SCENE", sceneId: "combine", now: T });
    expect(entered).toBe(s);
    const opened = gameReducer(itemGame, s, { type: "OPEN_CHALLENGE", sceneId: "combine", now: T });
    expect(opened).toBe(s);
    const answered = gameReducer(itemGame, s, {
      type: "SUBMIT_ANSWER",
      sceneId: "combine",
      now: T,
      text: "go",
    });
    expect(answered).toBe(s);
  });

  it("mints the combine result through the normal reward pipeline", () => {
    let s = solve(itemGame, fresh(), "gather");
    s = solve(itemGame, s, "combine", T + 1);
    expect(s.scenes.combine.status).toBe("completed");
    expect(s.inventory.filter((i) => i.value === "treasure-map")).toHaveLength(1);
  });

  it("never double-grants the combine result", () => {
    let s = solve(itemGame, fresh(), "gather");
    s = solve(itemGame, s, "combine", T + 1);
    const afterFirst = s;
    for (let i = 0; i < 5; i++) {
      s = gameReducer(itemGame, s, {
        type: "SUBMIT_ANSWER",
        sceneId: "combine",
        now: T + 2 + i,
        text: "go",
      });
    }
    expect(s).toBe(afterFirst);
    expect(s.inventory.filter((i) => i.value === "treasure-map")).toHaveLength(1);
  });

  it("unlocks tasks that require the completed combine scene", () => {
    let s = solve(itemGame, fresh(), "gather");
    s = solve(itemGame, s, "combine", T + 1);
    expect(statusOf(itemGame, s, "after")).toBe("available");
  });
});

describe("task gate and item gate are independent", () => {
  it("requires both `requires` and `requiresItems` when both are declared", () => {
    let s = fresh();
    // Neither gate open.
    expect(statusOf(itemGame, s, "both")).toBe("locked");

    // Item gate satisfied only: completing gather2 alone does not open "both"
    // because "special-item" has not been earned. Note the task gate uses the
    // scene's own state - completing tasks never mints items by itself.
    s = solve(itemGame, s, "gather");
    s = solve(itemGame, s, "gather2", T + 1);
    expect(statusOf(itemGame, s, "both")).toBe("locked");

    // Task gate satisfied only: "special-item" held, but gather2 incomplete
    // (use a state where side was completed first through its own gate).
    let s2 = solve(itemGame, fresh(), "gather");
    s2 = solve(itemGame, s2, "side", T + 1);
    expect(statusOf(itemGame, s2, "both")).toBe("locked");

    // Both gates open.
    s = solve(itemGame, s, "side", T + 2);
    expect(statusOf(itemGame, s, "both")).toBe("available");
  });
});

describe("save/restore integrity with items", () => {
  it("keeps items and statuses consistent across a JSON round trip", () => {
    let s = solve(itemGame, fresh(), "gather");
    s = solve(itemGame, s, "gather2", T + 1);
    s = solve(itemGame, s, "combine", T + 2);
    const restored = reconcileState(itemGame, JSON.parse(JSON.stringify(s)), T + 60_000);
    expect(statusOf(itemGame, restored, "gather")).toBe("completed");
    expect(statusOf(itemGame, restored, "gather2")).toBe("completed");
    expect(statusOf(itemGame, restored, "combine")).toBe("completed");
    expect(statusOf(itemGame, restored, "after")).toBe("available");
    expect(restored.inventory.filter((i) => i.value === "bronze-key")).toHaveLength(2);
    expect(restored.inventory.filter((i) => i.value === "treasure-map")).toHaveLength(1);
  });

  it("strips a forged item whose kind does not match its source reward", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      // gather is not completed here, and even if it were, its reward mints
      // "bronze-key", not "master-key". Both forgery shapes must die.
      inventory: [
        {
          id: "gather:item:master-key",
          type: "item",
          title: "万能钥匙",
          value: "master-key",
          sceneId: "gather",
          acquiredAt: T,
        },
      ],
    };
    const restored = reconcileState(itemGame, persisted, T + 1000);
    expect(restored.inventory).toEqual([]);
    expect(statusOf(itemGame, restored, "combine")).toBe("locked");
  });

  it("strips a combine completion whose required item has no legitimate source", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        // gather claimed complete so the bronze-key record's sceneId passes the
        // naive check, but "combine" is completed WITHOUT any legit item source
        // chain: gather completed legitimately mints bronze-key... so instead
        // forge a combine completion with NO inventory at all.
        combine: {
          sceneId: "combine",
          status: "completed",
          attempts: 0,
          grantedRewardIds: ["x"],
          completedAt: T,
        },
      },
      inventory: [],
    };
    const restored = reconcileState(itemGame, persisted, T + 1000);
    expect(restored.scenes.combine.status).toBe("locked");
    expect(restored.scenes.combine.grantedRewardIds).toEqual([]);
  });

  it("strips a completion gated on an item whose source scene is not completed", () => {
    const base = fresh();
    const persisted: Partial<GameState> = {
      ...base,
      scenes: {
        ...base.scenes,
        // bronze-key record claims sceneId "gather", but gather is NOT
        // completed: the record is stale, so the combine completion claiming
        // to have used it must be stripped too.
        gather: { sceneId: "gather", status: "locked", attempts: 0, grantedRewardIds: [] },
        combine: {
          sceneId: "combine",
          status: "completed",
          attempts: 0,
          grantedRewardIds: ["x"],
          completedAt: T,
        },
      },
      inventory: [
        {
          id: "gather:item:bronze-key",
          type: "item",
          title: "铜钥匙",
          value: "bronze-key",
          sceneId: "gather",
          acquiredAt: T,
        },
      ],
    };
    const restored = reconcileState(itemGame, persisted, T + 1000);
    expect(restored.inventory).toEqual([]);
    expect(restored.scenes.combine.status).toBe("locked");
  });
});

describe("legacy packs without requiresItems keep linear behaviour", () => {
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
    s = solve(legacyGame, s, "a");
    expect(availableSceneIds(legacyGame, s)).toEqual(["b"]);
    s = solve(legacyGame, s, "b", T + 1);
    expect(availableSceneIds(legacyGame, s)).toEqual(["c"]);
    s = solve(legacyGame, s, "c", T + 2);
    expect(availableSceneIds(legacyGame, s)).toEqual([]);
    expect(s.inventory.filter((i) => i.type === "keyword")).toHaveLength(3);
  });
});

describe("validateGame: requiresItems schema checks", () => {
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

  it("accepts a valid items chain without orphan warnings", () => {
    const { game, issues } = validateGame(pack(itemGame.scenes));
    expect(game.scenes).toHaveLength(6);
    expect(issues).toEqual([]);
  });

  it("allows several scenes to grant the same item kind", () => {
    const { issues } = validateGame(
      pack([
        scene("a", { nextSceneId: "b", reward: item("dup-key") }),
        scene("b", { reward: item("dup-key") }),
        scene("c", { requiresItems: ["dup-key"] }),
      ]),
    );
    expect(issues).toEqual([]);
  });

  it("rejects a required item that no item reward can produce", () => {
    // "kw-a" only exists as a keyword reward, not an item reward.
    expect(() =>
      validateGame(pack([scene("a"), scene("b", { requiresItems: ["kw-a"] })])),
    ).toThrow(/无法由本游戏包中的任何物品奖励产出/);
  });

  it("rejects a scene requiring an item only it can produce", () => {
    expect(() =>
      validateGame(
        pack([scene("a", { requiresItems: ["self-key"], reward: item("self-key") })]),
      ),
    ).toThrow(/只能由本场景自己产出/);
  });

  it("rejects non-string or empty requiresItems entries", () => {
    expect(() =>
      validateGame(pack([scene("a", { requiresItems: ["ok", ""] })])),
    ).toThrow(/物品 id 字符串数组/);
    expect(() =>
      validateGame(pack([scene("a", { requiresItems: [42 as unknown as string] })])),
    ).toThrow(/物品 id 字符串数组/);
  });
});

describe("markdown round trip preserves the new fields", () => {
  it("keeps requires and requiresItems through export/import", () => {
    const game: Game = { ...itemGame, id: "md-hunt" };
    const imported = markdownToGame(gameToMarkdown(game)) as Game;
    expect(imported.scenes.map((s) => s.id)).toEqual(itemGame.scenes.map((s) => s.id));
    expect(imported.scenes.find((s) => s.id === "combine")?.requiresItems).toEqual([
      "bronze-key",
    ]);
    expect(imported.scenes.find((s) => s.id === "after")?.requires).toEqual(["combine"]);
    expect(imported.scenes.find((s) => s.id === "both")?.requiresItems).toEqual([
      "special-item",
    ]);
  });

  it("adds no gate fields when the source pack has none", () => {
    const plain: Game = {
      id: "plain-hunt",
      language: "zh-CN",
      title: "Plain",
      description: "d",
      version: "1",
      startLocation: { lat: 0, lng: 0 },
      entrySceneId: "a",
      scenes: [scene("a", { nextSceneId: "b" }), scene("b")],
    };
    const imported = markdownToGame(gameToMarkdown(plain)) as Game;
    expect(imported.scenes.every((s) => s.requires === undefined)).toBe(true);
    expect(imported.scenes.every((s) => s.requiresItems === undefined)).toBe(true);
  });
});
