/**
 * Cross-type dependency deadlock tests (recovery batch 2 addendum).
 *
 * Task edges (requires / chain predecessors) and item edges (requiresItems ->
 * item producers) can form cycles that neither `detectRequiresCycles` (task
 * edges only) nor the self-producer check can see. A pack where B needs an
 * item that only C can mint, while C sits behind B, can never be played - the
 * validator must reject it. A pack where another *reachable* scene also mints
 * the same kind is fine and must NOT be rejected.
 */

import { describe, expect, it } from "vitest";
import { validateGame } from "@/lib/game/types";
import type { Game, Scene } from "@/lib/game/types";

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

const item = (value: string) => ({ type: "item" as const, title: value, value });

/** Chain a -> b -> c; b needs the item only c (behind b) can mint. Deadlock. */
const deadlockPack: Game = {
  id: "deadlock-hunt",
  language: "zh-CN",
  title: "Deadlock Hunt",
  description: "cross-type deadlock fixture",
  version: "1.0.0",
  startLocation: { lat: 0, lng: 0 },
  entrySceneId: "a",
  scenes: [
    scene("a", { nextSceneId: "b" }),
    scene("b", { requiresItems: ["kind-c"], nextSceneId: "c" }),
    scene("c", { reward: item("kind-c") }),
  ],
};

/** Same shape, but d also mints kind-c and is reachable via requires: [a]. */
const controlPack: Game = {
  id: "control-hunt",
  language: "zh-CN",
  title: "Control Hunt",
  description: "reachable alternate producer fixture",
  version: "1.0.0",
  startLocation: { lat: 0, lng: 0 },
  entrySceneId: "a",
  scenes: [
    scene("a", { nextSceneId: "b" }),
    scene("b", { requiresItems: ["kind-c"], nextSceneId: "c" }),
    scene("c", { reward: item("kind-c") }),
    scene("d", { requires: ["a"], reward: item("kind-c") }),
  ],
};

describe("cross-type dependency deadlocks", () => {
  it("rejects a pack where the only item producer sits behind the gated scene", () => {
    expect(() => validateGame(deadlockPack)).toThrowError(/永远无法|死锁/);
  });

  it("accepts a pack where another reachable scene mints the same kind", () => {
    const { issues } = validateGame(controlPack);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
