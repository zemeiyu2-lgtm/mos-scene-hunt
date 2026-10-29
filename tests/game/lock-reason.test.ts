/**
 * Unit tests for the quest screen's lock explanation.
 *
 * Before this module existed the quest screen printed one hardcoded sentence
 * based on `statuses[index - 1]` — it pointed at the wrong scene for every
 * pack using declarative `requires`, and said nothing useful about item gates.
 * These tests pin the behaviour for each gate combination.
 */

import { describe, expect, it } from "vitest";
import {
  describeSceneLock,
  heldItemKindsFrom,
  sceneLockReason,
} from "@/lib/game/lock-reason";
import type { Scene } from "@/lib/game/types";

function scene(partial: Partial<Scene> & Pick<Scene, "id" | "title">): Scene {
  return {
    story: "story",
    location: { lat: 14.58, lng: 120.97, radius: 15 },
    nextSceneId: null,
    challenge: { type: "choice", question: "q", options: ["a"], answer: 0 },
    reward: { type: "keyword", title: `${partial.id}-kw`, value: `${partial.id}-kw` },
    ...partial,
  };
}

const keyScene = scene({
  id: "key",
  title: "钥匙亭",
  reward: { type: "item", title: "铜钥匙", value: "brass-key" },
});

const scenes = [
  scene({ id: "a", title: "喷泉" }),
  scene({ id: "b", title: "钟楼" }),
  keyScene,
  scene({ id: "gate", title: "铁门", requires: ["b"], requiresItems: ["brass-key"] }),
];

const none = new Set<string>();

describe("sceneLockReason", () => {
  it("reports no blocking when every prerequisite is met", () => {
    const reason = sceneLockReason(
      scenes[3],
      scenes,
      new Set(["b"]),
      new Set(["brass-key"]),
    );
    expect(reason).toEqual({ tasks: [], items: [] });
  });

  it("names the incomplete prerequisite scenarios, not 'the previous row'", () => {
    const reason = sceneLockReason(scenes[3], scenes, none, new Set(["brass-key"]));
    expect(reason.tasks).toEqual(["钟楼"]);
    expect(reason.items).toEqual([]);
  });

  it("names missing item kinds by their reward title", () => {
    const reason = sceneLockReason(scenes[3], scenes, new Set(["b"]), none);
    expect(reason.tasks).toEqual([]);
    expect(reason.items).toEqual(["铜钥匙"]);
  });

  it("falls back to the raw kind when no scene produces it", () => {
    const orphan = scene({ id: "x", title: "密室", requiresItems: ["ghost-key"] });
    const reason = sceneLockReason(orphan, [...scenes, orphan], none, none);
    expect(reason.items).toEqual(["ghost-key"]);
  });

  it("returns empty arrays for classic packs that declare no gates", () => {
    const reason = sceneLockReason(scenes[1], scenes, none, none);
    expect(reason).toEqual({ tasks: [], items: [] });
  });

  it("ignores item rewards of non-item types when naming kinds", () => {
    const reason = sceneLockReason(scenes[0], scenes, none, none);
    expect(reason.items).toEqual([]);
  });
});

describe("heldItemKindsFrom", () => {
  it("only counts item-type inventory entries", () => {
    const held = heldItemKindsFrom([
      { type: "item", title: "铜钥匙", value: "brass-key" },
      { type: "keyword", title: "k", value: "k" },
      { type: "badge", title: "b" },
    ]);
    expect([...held]).toEqual(["brass-key"]);
  });

  it("falls back to the title when the item has no value", () => {
    expect(heldItemKindsFrom([{ type: "item", title: "地图残片" }]).has("地图残片")).toBe(true);
  });
});

describe("describeSceneLock", () => {
  it("describes both gates together", () => {
    const text = describeSceneLock({ tasks: ["钟楼"], items: ["铜钥匙"] }, "fallback");
    expect(text).toBe("需先完成「钟楼」，并获得「铜钥匙」");
  });

  it("describes a task gate alone", () => {
    expect(describeSceneLock({ tasks: ["喷泉", "钟楼"], items: [] }, "f")).toBe(
      "需先完成「喷泉」「钟楼」",
    );
  });

  it("describes an item gate alone", () => {
    expect(describeSceneLock({ tasks: [], items: ["铜钥匙"] }, "f")).toBe(
      "需先获得物品「铜钥匙」",
    );
  });

  it("uses the caller's fallback when no gate is declared", () => {
    expect(describeSceneLock({ tasks: [], items: [] }, "完成「前一个地点」后解锁")).toBe(
      "完成「前一个地点」后解锁",
    );
  });
});
