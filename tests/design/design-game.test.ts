/**
 * Tests for the blank-game factory (app/design/design-game.ts).
 *
 * The two guarantees that matter: a new game never reuses an existing storage
 * id, and the minimal default pack passes the content validator (a pack that
 * fails validation is dropped by `readAuthoredGame` on reload - the game would
 * silently vanish from the library).
 */

import { describe, expect, it } from "vitest";
import { createBlankGame, nextBlankGameId } from "@/app/design/design-game";
import { validateGame } from "@/lib/game/types";

describe("nextBlankGameId", () => {
  it("derives a stable id from the seed", () => {
    expect(nextBlankGameId([], 1_700_000_000_000)).toBe(
      `my-hunt-${(1_700_000_000_000).toString(36)}`,
    );
  });

  it("never returns an id that is already taken", () => {
    const seed = 1_700_000_000_000;
    const base = `my-hunt-${seed.toString(36)}`;
    expect(nextBlankGameId([base], seed)).not.toBe(base);
    expect(nextBlankGameId([base], seed)).toBe(`${base}-2`);
  });

  it("keeps walking the suffix until it finds a free slot", () => {
    const seed = 42;
    const base = `my-hunt-${seed.toString(36)}`;
    const id = nextBlankGameId([base, `${base}-2`, `${base}-3`], seed);
    expect(id).toBe(`${base}-4`);
  });

  it("does not collide with bundled pack ids", () => {
    const reserved = ["demo-hunt", "bsop-eight-secrets", "igsl-eight-transformations"];
    const id = nextBlankGameId(reserved, 1_700_000_000_000);
    expect(reserved).not.toContain(id);
  });
});

describe("createBlankGame", () => {
  const blank = createBlankGame({
    id: "my-hunt-test",
    startLocation: { lat: 14.58, lng: 120.97, name: "起点" },
  });

  it("uses the id it was given and has its own scene id namespace", () => {
    expect(blank.id).toBe("my-hunt-test");
    expect(blank.scenes).toHaveLength(1);
    expect(blank.entrySceneId).toBe(blank.scenes[0].id);
    expect(blank.scenes[0].id.startsWith("my-hunt-test")).toBe(true);
  });

  it("starts empty of any drawn area, so the author draws their own", () => {
    expect(blank.huntArea).toBeUndefined();
  });

  it("carries the current map centre instead of jumping to (0,0)", () => {
    expect(blank.startLocation.lat).toBe(14.58);
    expect(blank.startLocation.lng).toBe(120.97);
    expect(blank.scenes[0].location.lat).toBe(14.58);
  });

  it("survives the content validator", () => {
    expect(() => validateGame(blank)).not.toThrow();
    const { issues } = validateGame(blank);
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("is playable straight away: starter challenge and reward are valid", () => {
    const scene = blank.scenes[0];
    expect(scene.challenge?.type).toBe("choice");
    expect(scene.challenge?.options?.length).toBeGreaterThanOrEqual(2);
    expect(scene.challenge?.answer).toBe(0);
    expect(scene.reward?.title).toBeTruthy();
    expect(scene.nextSceneId).toBeNull();
  });

  it("does not share state with the caller's start location object", () => {
    const origin = { lat: 1, lng: 2 };
    const game = createBlankGame({ id: "g", startLocation: origin });
    origin.lat = 99;
    expect(game.startLocation.lat).toBe(1);
  });

  it("falls back to placeholder coordinates when no origin is given", () => {
    const game = createBlankGame({ id: "g2" });
    expect(game.startLocation).toEqual({ lat: 0, lng: 0, radius: 30, name: "起点" });
  });
});
