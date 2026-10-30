/**
 * Auto-demo autopilot helper tests.
 *
 * The autopilot must never guess: the chain follows the pack's own wiring, the
 * target is the first un-completed station, reflective questions auto-pick the
 * first option while graded questions must pick the correct one, and text
 * challenges are never auto-answered. The kiosk deep link is an exact-match
 * flag, so a random ?demo=whatever URL cannot silently turn on the autopilot.
 */

import { describe, expect, it } from "vitest";
import {
  autoChoiceIndex,
  demoSceneChain,
  demoPhaseLabel,
  nextDemoTarget,
  urlRequestsDemo,
} from "@/lib/demo/autopilot";
import type { Game } from "@/lib/game/types";

/** A linear three-scene chain, mirroring the official showcase pack. */
const game: Game = {
  id: "demo-hunt",
  language: "zh-CN",
  title: "Demo Hunt",
  description: "autopilot fixture",
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
        question: "reflective?",
        options: ["one", "two"],
        answer: 1,
        reflective: true,
      },
      reward: { type: "keyword", title: "k1", value: "k1" },
    },
    {
      id: "b",
      title: "B",
      story: "story b",
      location: { lat: 0, lng: 0.0005, radius: 50 },
      nextSceneId: "c",
      challenge: {
        type: "choice",
        question: "graded?",
        options: ["wrong", "right"],
        answer: 1,
      },
      reward: { type: "keyword", title: "k2", value: "k2" },
    },
    {
      id: "c",
      title: "C",
      story: "story c",
      location: { lat: 0, lng: 0.001, radius: 50 },
      nextSceneId: null,
      challenge: {
        type: "text",
        question: "keyword?",
        answer: ["钥匙"],
      },
      reward: { type: "badge", title: "finish" },
    },
  ],
};

describe("demoSceneChain", () => {
  it("follows nextSceneId from the entry scene", () => {
    expect(demoSceneChain(game)).toEqual(["a", "b", "c"]);
  });

  it("falls back to pack order for a broken chain", () => {
    const broken: Game = {
      ...game,
      scenes: [
        { ...game.scenes[0], nextSceneId: "missing" },
        game.scenes[1],
        game.scenes[2],
      ],
    };
    const chain = demoSceneChain(broken);
    expect(chain).toHaveLength(3);
    expect(chain[0]).toBe("a");
    expect(new Set(chain)).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("nextDemoTarget", () => {
  const statusById = {
    a: "completed",
    b: "challenging",
    c: "locked",
  } as any;

  it("picks the first un-completed station in chain order", () => {
    expect(nextDemoTarget(["a", "b", "c"], statusById)).toBe("b");
  });

  it("returns null when every station is completed", () => {
    const done = { a: "completed", b: "completed", c: "completed" } as any;
    expect(nextDemoTarget(["a", "b", "c"], done)).toBeNull();
  });

  it("starts from the beginning on a fresh hunt", () => {
    expect(nextDemoTarget(["a", "b", "c"], {})).toBe("a");
  });
});

describe("autoChoiceIndex", () => {
  it("auto-picks the first option for reflective questions", () => {
    expect(autoChoiceIndex(game.scenes[0].challenge)).toBe(0);
  });

  it("must submit the correct option for graded questions", () => {
    expect(autoChoiceIndex(game.scenes[1].challenge)).toBe(1);
  });

  it("never guesses text or keyword answers", () => {
    expect(autoChoiceIndex(game.scenes[2].challenge)).toBeNull();
    expect(autoChoiceIndex(null)).toBeNull();
  });
});

describe("urlRequestsDemo", () => {
  it("accepts only the exact demo=1 flag", () => {
    expect(urlRequestsDemo("?demo=1")).toBe(true);
    expect(urlRequestsDemo("")).toBe(false);
    expect(urlRequestsDemo("?demo=0")).toBe(false);
    expect(urlRequestsDemo("?demo=true")).toBe(false);
    expect(urlRequestsDemo("?other=1")).toBe(false);
  });
});

describe("demoPhaseLabel", () => {
  it("maps every scene status to a short Chinese label", () => {
    expect(demoPhaseLabel("available")).toBe("前往站点");
    expect(demoPhaseLabel("locked")).toBe("前往站点");
    expect(demoPhaseLabel("arrived")).toBe("已到达");
    expect(demoPhaseLabel("challenging")).toBe("回答中");
    expect(demoPhaseLabel("completed")).toBe("已完成");
    expect(demoPhaseLabel(undefined)).toBe("准备中");
  });
});
