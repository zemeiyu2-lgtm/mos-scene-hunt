/**
 * Unit tests for the designer's reward-type and item-gate editing helpers.
 *
 * The engine side of item gating is covered by tests/game/items.test.ts and
 * tests/game/dependencies.test.ts; what must not drift here is the designer's
 * guarantee that anything it writes back survives `validateGame` on read (a
 * pack that fails validation disappears from the local library on reload).
 */

import { describe, expect, it } from "vitest";
import {
  itemKindsProducedBy,
  setRewardType,
  switchSceneRewardType,
  toggleSceneRequiresItems,
} from "@/lib/game/reward-edit";
import { createBlankGame } from "@/app/design/design-game";
import { validateGame } from "@/lib/game/types";
import type { Game, Scene } from "@/lib/game/types";

function itemScene(id: string, kind: string, next: string | null = null): Scene {
  return {
    id,
    title: id,
    story: "story",
    location: { lat: 14.58, lng: 120.97, radius: 20 },
    nextSceneId: next,
    reward: { type: "item", title: kind, value: kind },
  };
}

/** A minimal valid pack: A -> B -> C, A and B mint items, C needs both. */
function pack(): Game {
  const scenes: Scene[] = [
    itemScene("s-a", "bronze-key", "s-b"),
    itemScene("s-b", "silver-key", "s-c"),
    {
      id: "s-c",
      title: "s-c",
      story: "story",
      location: { lat: 14.581, lng: 120.971, radius: 20 },
      nextSceneId: null,
      requiresItems: ["bronze-key", "silver-key"],
    },
  ];
  return {
    id: "test-pack",
    language: "zh-CN",
    title: "t",
    description: "d",
    version: "0.1.0",
    startLocation: { lat: 14.58, lng: 120.97, radius: 30 },
    entrySceneId: "s-a",
    scenes,
  };
}

describe("setRewardType", () => {
  it("starts a sensible default reward when none was authored", () => {
    expect(setRewardType(undefined, "item")).toEqual({
      type: "item",
      title: "新物品",
      value: "新物品",
    });
    expect(setRewardType(undefined, "keyword")?.title).toBe("新线索");
  });

  it("keeps the authored title when switching type", () => {
    const reward = { type: "keyword", title: "自由", value: "自由" } as const;
    expect(setRewardType(reward, "item")).toEqual({
      type: "item",
      title: "自由",
      value: "自由",
    });
  });

  it("does not mutate the input", () => {
    const reward = { type: "keyword", title: "自由", value: "自由" } as const;
    setRewardType(reward, "badge");
    expect(reward.type).toBe("keyword");
  });
});

describe("itemKindsProducedBy", () => {
  it("collects item kinds with their producers", () => {
    expect(itemKindsProducedBy(pack())).toEqual([
      { kind: "bronze-key", producerIds: ["s-a"] },
      { kind: "silver-key", producerIds: ["s-b"] },
    ]);
  });

  it("ignores non-item rewards", () => {
    const game = createBlankGame({ id: "x" });
    expect(itemKindsProducedBy(game)).toEqual([]);
  });
});

describe("toggleSceneRequiresItems", () => {
  it("removes and re-adds a kind", () => {
    const game = pack();
    const scene = game.scenes.find((s) => s.id === "s-c")!;
    // The pack fixture already gates s-c on bronze-key, so the first toggle
    // removes it and the second re-adds it.
    const removed = toggleSceneRequiresItems(scene, game, "bronze-key");
    if (!("scene" in removed)) throw new Error("expected success");
    expect(removed.scene.requiresItems).not.toContain("bronze-key");
    const added = toggleSceneRequiresItems(removed.scene, game, "bronze-key");
    if (!("scene" in added)) throw new Error("expected success");
    expect(added.scene.requiresItems).toContain("bronze-key");
  });

  it("rejects a kind only produced by the same scene", () => {
    const game = pack();
    const scene = game.scenes.find((s) => s.id === "s-a")!;
    const result = toggleSceneRequiresItems(scene, game, "bronze-key");
    expect("error" in result).toBe(true);
  });

  it("rejects a kind nobody produces", () => {
    const game = pack();
    const scene = game.scenes.find((s) => s.id === "s-c")!;
    const result = toggleSceneRequiresItems(scene, game, "ghost-key");
    expect("error" in result).toBe(true);
  });
});

describe("switchSceneRewardType", () => {
  it("strips stale requiresItems when a producer leaves the item type", () => {
    const game = pack();
    const result = switchSceneRewardType(game, "s-a", "badge");
    const c = result.game.scenes.find((s) => s.id === "s-c")!;
    expect(c.requiresItems).toEqual(["silver-key"]);
    expect(result.warnings).toHaveLength(1);
    // The cleaned pack must still pass full validation.
    expect(() => validateGame(JSON.parse(JSON.stringify(result.game)))).not.toThrow();
  });

  it("keeps gates intact for unrelated type switches", () => {
    const game = pack();
    const result = switchSceneRewardType(game, "s-a", "item");
    const c = result.game.scenes.find((s) => s.id === "s-c")!;
    expect(c.requiresItems).toEqual(["bronze-key", "silver-key"]);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not mutate the input game", () => {
    const game = pack();
    switchSceneRewardType(game, "s-a", "badge");
    const a = game.scenes.find((s) => s.id === "s-a")!;
    expect(a.reward?.type).toBe("item");
  });
});
