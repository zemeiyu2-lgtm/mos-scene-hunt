/**
 * End-to-end gate coverage for the acceptance pack (content/acceptance-15m-check.json).
 *
 * Unit tests prove the *engine* honours `requires` / `requiresItems` /
 * branching; this file proves the *shipped acceptance pack* actually exercises
 * them, so a future edit that quietly flattens the pack back to a linear chain
 * fails CI instead of silently losing its purpose.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  availableSceneIds,
  createInitialState,
  gameReducer,
  isGameComplete,
  type GameState,
} from "@/lib/game/state";
import { validateGame } from "@/lib/game/types";

const raw = readFileSync(
  path.join(process.cwd(), "content", "acceptance-15m-check.json"),
  "utf8",
);
const { game } = validateGame(JSON.parse(raw));

type Answer = { choice?: number; text?: string };

function solve(sceneId: string, answer: Answer, now: number): GameState {
  state = gameReducer(game, state, { type: "ENTER_SCENE", sceneId, now });
  state = gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId, now: now + 50 });
  state = gameReducer(game, state, {
    type: "SUBMIT_ANSWER",
    sceneId,
    now: now + 100,
    ...(answer.choice !== undefined ? { selectedIndex: answer.choice } : {}),
    ...(answer.text !== undefined ? { text: answer.text } : {}),
  });
  return state;
}

let state: GameState;

beforeEach(() => {
  state = gameReducer(game, createInitialState(game), { type: "START", now: 1000 });
});

describe("acceptance pack: 15m radius requirement", () => {
  it("sets every scene trigger radius to exactly 15 metres", () => {
    const radii = game.scenes.map((s) => s.location.radius);
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.every((r) => r === 15)).toBe(true);
  });
});

describe("acceptance pack: gating", () => {
  it("opens only the entry scene at the start", () => {
    expect(availableSceneIds(game, state)).toEqual(["acc-intro"]);
  });

  it("unlocks the timed scene after the intro is solved", () => {
    solve("acc-intro", { choice: 0 }, 1100);
    expect(availableSceneIds(game, state)).toEqual(["acc-timed"]);
  });

  it("grants the item reward that later gates the finale", () => {
    solve("acc-intro", { choice: 0 }, 1100);
    solve("acc-timed", { text: "acc-clock" }, 1200);
    const lens = state.inventory.find((i) => i.value === "field-lens");
    expect(lens?.type).toBe("item");
  });

  it("reward types cover keyword, item, story and badge by the end", () => {
    solve("acc-intro", { choice: 0 }, 1100);
    solve("acc-timed", { text: "acc-clock" }, 1200);
    solve("acc-fork", { choice: 0 }, 1300);
    solve("acc-left", { text: "长廊" }, 1400);
    solve("acc-right", { text: "水池" }, 1500);
    solve("acc-final", { choice: 0 }, 1600);
    const types = new Set(state.inventory.map((i) => i.type));
    expect([...types].sort()).toEqual(["badge", "item", "keyword", "story"]);
  });

  it("keeps the finale locked until BOTH branch scenes are done", () => {
    solve("acc-intro", { choice: 0 }, 1100);
    solve("acc-timed", { text: "acc-clock" }, 1200);
    solve("acc-fork", { choice: 0 }, 1300);
    solve("acc-left", { text: "长廊" }, 1400);
    expect(availableSceneIds(game, state)).not.toContain("acc-final");
    expect(availableSceneIds(game, state)).toContain("acc-right");
  });

  it("records the branch choice as a route", () => {
    solve("acc-intro", { choice: 0 }, 1100);
    solve("acc-timed", { text: "acc-clock" }, 1200);
    solve("acc-fork", { choice: 1 }, 1300);
    expect(state.routes?.["acc-fork"]).toBe("acc-right");
  });

  it("completes the whole hunt", () => {
    solve("acc-intro", { choice: 0 }, 1100);
    solve("acc-timed", { text: "acc-clock" }, 1200);
    solve("acc-fork", { choice: 0 }, 1300);
    solve("acc-left", { text: "长廊" }, 1400);
    solve("acc-right", { text: "水池" }, 1500);
    solve("acc-final", { choice: 0 }, 1600);
    expect(isGameComplete(game, state)).toBe(true);
  });
});

describe("acceptance pack: pack-level safety", () => {
  it("has no unopenable scenes", () => {
    // Guards against the classic authoring trap: an item gate whose producer is
    // itself locked behind the gated scene.
    const kindsProduced = new Set(
      game.scenes
        .filter((s) => s.reward?.type === "item")
        .map((s) => s.reward!.value ?? s.reward!.title),
    );
    for (const scene of game.scenes) {
      for (const kind of scene.requiresItems ?? []) {
        expect(kindsProduced.has(kind)).toBe(true);
      }
    }
  });

  it("states plainly that treasure redemption is not a product feature", () => {
    const finale = game.scenes.find((s) => s.id === "acc-final");
    expect(finale?.challenge?.explanation).toContain("当前版本不提供线上核销");
  });

  it("is not advertised as official content and flags every coordinate as unverified", () => {
    expect(game.author).toContain("非正式内容");
    expect(game.description).toContain("未经实地测量");
    for (const scene of game.scenes) {
      expect(scene.location.name ?? "").toContain("待现场核对");
    }
  });
});
