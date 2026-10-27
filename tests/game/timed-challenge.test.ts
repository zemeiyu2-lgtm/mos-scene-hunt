/**
 * Timed challenge V1.0 - rules, engine behaviour and authoring helpers.
 *
 * Product rules under test (confirmed by the product owner):
 *   1. the clock starts when the question becomes answerable, not when the map
 *      or the game home loads;
 *   2. a timeout can be retried;
 *   3. every retry gets a fresh, independent full window (no carry-over);
 *   4. attempt counts are recorded;
 *   5. questions without a limit keep the V0.1 behaviour.
 *
 * Time is always injected (`now`), so nothing here sleeps - a 30 minute limit is
 * as fast to test as a 5 second one.
 */

import { describe, expect, it } from "vitest";
import { createInitialState, gameReducer, reconcileState, type GameState } from "@/lib/game/state";
import { validateGame, type Game, type Scene } from "@/lib/game/types";
import {
  attemptNumber,
  formatClock,
  formatLimit,
  hasTimeLimit,
  parseTimeLimitInput,
  remainingMs,
  timeLimitInputValue,
  timeLimitMs,
  timedPhase,
  withTimeLimitSeconds,
} from "@/lib/game/timed-challenge";

const T = 1_700_000_000_000;
const MIN = 60_000;

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: id.toUpperCase(),
    story: `story ${id}`,
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "choice", question: "q", options: ["A", "B"], answer: 0 },
    reward: { type: "keyword", title: id, value: id },
    ...overrides,
  };
}

/** One timed scene (`s1`) as the entry, so it is answerable immediately. */
function timedGame(limitSeconds = 30, extra: Scene[] = []): Game {
  return {
    id: "timed-hunt",
    language: "zh-CN",
    title: "Timed Hunt",
    description: "timed fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "s1",
    scenes: [
      scene("s1", {
        challenge: {
          type: "choice",
          question: "q",
          options: ["A", "B"],
          answer: 0,
          timeLimitSeconds: limitSeconds,
        },
      }),
      ...extra,
    ],
  };
}

function untimedGame(): Game {
  return {
    id: "untimed-hunt",
    language: "zh-CN",
    title: "Untimed Hunt",
    description: "untimed fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "u1",
    scenes: [scene("u1")],
  };
}

function open(game: Game, state: GameState, id: string, now: number): GameState {
  return gameReducer(game, state, { type: "OPEN_CHALLENGE", sceneId: id, now });
}

function submit(
  game: Game,
  state: GameState,
  id: string,
  now: number,
  index = 0,
): GameState {
  return gameReducer(game, state, {
    type: "SUBMIT_ANSWER",
    sceneId: id,
    now,
    selectedIndex: index,
  });
}

function expire(game: Game, state: GameState, id: string, now: number): GameState {
  return gameReducer(game, state, { type: "EXPIRE_ATTEMPT", sceneId: id, now });
}

function retry(game: Game, state: GameState, id: string, now: number): GameState {
  return gameReducer(game, state, { type: "RETRY_ATTEMPT", sceneId: id, now });
}

describe("timing helpers", () => {
  it("treats a missing, zero, negative or non-numeric limit as untimed", () => {
    expect(timeLimitMs(undefined)).toBeNull();
    expect(timeLimitMs({ type: "choice", question: "q" })).toBeNull();
    expect(timeLimitMs({ type: "choice", question: "q", timeLimitSeconds: 0 })).toBeNull();
    expect(timeLimitMs({ type: "choice", question: "q", timeLimitSeconds: -30 })).toBeNull();
    expect(timeLimitMs({ type: "choice", question: "q", timeLimitSeconds: Number.NaN })).toBeNull();
    expect(hasTimeLimit({ type: "choice", question: "q", timeLimitSeconds: 90 })).toBe(true);
  });

  it("converts seconds to milliseconds", () => {
    expect(timeLimitMs({ type: "choice", question: "q", timeLimitSeconds: 90 })).toBe(90_000);
  });

  it("formats the countdown as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(900)).toBe("0:01"); // rounds up so the last second is visible
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(600_000)).toBe("10:00");
  });

  it("formats the configured limit for the player", () => {
    expect(formatLimit({ type: "choice", question: "q", timeLimitSeconds: 30 })).toBe("30 秒");
    expect(formatLimit({ type: "choice", question: "q", timeLimitSeconds: 120 })).toBe("2 分钟");
    expect(formatLimit({ type: "choice", question: "q", timeLimitSeconds: 90 })).toBe("1 分 30 秒");
    expect(formatLimit({ type: "choice", question: "q" })).toBe("");
  });

  it("reports the timed phase from stored data and now", () => {
    const timed = { type: "choice" as const, question: "q", timeLimitSeconds: 30 };
    expect(timedPhase(timed, null, T)).toBe("idle");
    expect(timedPhase(timed, { attempts: 0 }, T)).toBe("idle");
    expect(timedPhase(timed, { attempts: 0, attemptStartedAt: T }, T + 1_000)).toBe("running");
    expect(timedPhase(timed, { attempts: 0, attemptStartedAt: T }, T + 30_000)).toBe("expired");
    expect(
      timedPhase(timed, { attempts: 1, attemptStartedAt: T, timedOutAt: T + 30_000 }, T + 31_000),
    ).toBe("expired");
    expect(timedPhase({ type: "choice", question: "q" }, { attempts: 3 }, T)).toBe("untimed");
  });

  it("computes the remaining window without ever going negative", () => {
    const timed = { type: "choice" as const, question: "q", timeLimitSeconds: 30 };
    expect(remainingMs(timed, { attempts: 0, attemptStartedAt: T }, T)).toBe(30_000);
    expect(remainingMs(timed, { attempts: 0, attemptStartedAt: T }, T + 12_000)).toBe(18_000);
    expect(remainingMs(timed, { attempts: 0, attemptStartedAt: T }, T + 99_000)).toBe(0);
    expect(remainingMs(timed, { attempts: 0 }, T)).toBeNull();
  });

  it("numbers the attempt in progress as attempts + 1", () => {
    expect(attemptNumber(null)).toBe(1);
    expect(attemptNumber({ attempts: 0 })).toBe(1);
    expect(attemptNumber({ attempts: 2 })).toBe(3);
  });
});

describe("designer limit input", () => {
  it("treats an empty field as untimed", () => {
    expect(parseTimeLimitInput("")).toEqual({ seconds: null, error: null });
    expect(parseTimeLimitInput("   ")).toEqual({ seconds: null, error: null });
  });

  it("accepts positive whole seconds", () => {
    expect(parseTimeLimitInput("90")).toEqual({ seconds: 90, error: null });
    expect(parseTimeLimitInput(" 120 ")).toEqual({ seconds: 120, error: null });
  });

  it("rejects zero, negatives, fractions and non-numbers", () => {
    expect(parseTimeLimitInput("0").error).toBeTruthy();
    expect(parseTimeLimitInput("-30").error).toBeTruthy();
    expect(parseTimeLimitInput("2.5").error).toBeTruthy();
    expect(parseTimeLimitInput("abc").error).toBeTruthy();
  });

  it("sets and clears the field without touching siblings", () => {
    const base = { type: "choice" as const, question: "q", hint: "h" };
    const withLimit = withTimeLimitSeconds(base, 90);
    expect(withLimit).toEqual({ ...base, timeLimitSeconds: 90 });
    const cleared = withTimeLimitSeconds(withLimit, null);
    expect(cleared).toEqual(base);
    expect("timeLimitSeconds" in cleared).toBe(false);
  });

  it("round-trips the displayed value", () => {
    expect(timeLimitInputValue(undefined)).toBe("");
    expect(timeLimitInputValue({ type: "choice", question: "q" })).toBe("");
    expect(timeLimitInputValue({ type: "choice", question: "q", timeLimitSeconds: 90 })).toBe("90");
  });
});

describe("untimed questions keep the V0.1 behaviour", () => {
  it("can be answered long after opening, with no attempt bookkeeping", () => {
    const game = untimedGame();
    let s = createInitialState(game, T);
    s = open(game, s, "u1", T);
    s = submit(game, s, "u1", T + 45 * MIN);
    expect(s.scenes.u1.status).toBe("completed");
    expect(s.scenes.u1.attempts).toBe(0);
    expect(s.scenes.u1.attemptStartedAt).toBeUndefined();
    expect(s.scenes.u1.timedOutAt).toBeUndefined();
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0].type).toBe("keyword");
  });

  it("ignores expiry/retry actions", () => {
    const game = untimedGame();
    const s0 = open(game, createInitialState(game, T), "u1", T);
    expect(expire(game, s0, "u1", T + 99 * MIN)).toBe(s0);
    expect(retry(game, s0, "u1", T + 99 * MIN)).toBe(s0);
  });
});

describe("clock start", () => {
  it("starts when the question becomes answerable", () => {
    const game = timedGame();
    const s = open(game, createInitialState(game, T), "s1", T);
    expect(s.scenes.s1.attemptStartedAt).toBe(T);
    expect(s.scenes.s1.attempts).toBe(0);
  });

  it("does not restart an attempt that is already running", () => {
    const game = timedGame();
    let s = open(game, createInitialState(game, T), "s1", T);
    s = open(game, s, "s1", T + 10_000); // back button / deep link / re-render
    expect(s.scenes.s1.attemptStartedAt).toBe(T);
  });

  it("does not hand out a new window after an expiry", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    s = open(game, s, "s1", T + 30_001);
    expect(s.scenes.s1.attemptStartedAt).toBeUndefined();
    expect(s.scenes.s1.timedOutAt).toBe(T + 30_000);
  });
});

describe("grading inside the window", () => {
  it("completes a correct answer and stops the clock", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = submit(game, s, "s1", T + 12_000);
    expect(s.scenes.s1.status).toBe("completed");
    expect(s.scenes.s1.completedAt).toBe(T + 12_000);
    expect(s.scenes.s1.attemptStartedAt).toBeUndefined();
    expect(s.scenes.s1.timedOutAt).toBeUndefined();
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0].type).toBe("keyword");
  });

  it("grants the reward exactly once even if the scene is revisited", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = submit(game, s, "s1", T + 1_000);
    const again = submit(game, s, "s1", T + 2_000);
    expect(again).toBe(s);
    expect(again.inventory).toHaveLength(1);
  });

  it("still allows the last millisecond of the window", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = submit(game, s, "s1", T + 29_999);
    expect(s.scenes.s1.status).toBe("completed");
  });
});

describe("expiry", () => {
  it("does nothing before the deadline", () => {
    const game = timedGame(30);
    const s = open(game, createInitialState(game, T), "s1", T);
    expect(expire(game, s, "s1", T + 29_999)).toBe(s);
  });

  it("records exactly one failed attempt at the deadline", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    expect(s.scenes.s1.attempts).toBe(1);
    expect(s.scenes.s1.status).toBe("challenging");
    expect(s.scenes.s1.timedOutAt).toBe(T + 30_000);
    expect(s.scenes.s1.attemptStartedAt).toBeUndefined();
    expect(s.inventory).toHaveLength(0);
  });

  it("stays idempotent when the timer fires repeatedly", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    const once = s;
    for (const tick of [T + 30_250, T + 30_500, T + 60_000]) {
      s = expire(game, s, "s1", tick);
      expect(s).toBe(once);
    }
    expect(s.scenes.s1.attempts).toBe(1);
  });
});

describe("late submissions are never graded", () => {
  it("converts an over-deadline submission into the expiry it actually is", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = submit(game, s, "s1", T + 30_000);
    expect(s.scenes.s1.status).toBe("challenging");
    expect(s.scenes.s1.attempts).toBe(1);
    expect(s.scenes.s1.timedOutAt).toBe(T + 30_000);
    expect(s.inventory).toHaveLength(0);
    expect(s.scenes.s1.completedAt).toBeUndefined();
  });

  it("refuses a submission once the attempt is marked expired", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    const expired = s;
    expect(submit(game, s, "s1", T + 30_001)).toBe(expired);
    expect(submit(game, s, "s1", T + 90 * MIN)).toBe(expired);
  });

  it("counts a timer tick racing a submit only once", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    s = submit(game, s, "s1", T + 30_100);
    expect(s.scenes.s1.attempts).toBe(1);
  });
});

describe("retry", () => {
  it("opens a fresh full window and keeps the failure count", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    s = retry(game, s, "s1", T + 40_000);
    expect(s.scenes.s1.attemptStartedAt).toBe(T + 40_000);
    expect(s.scenes.s1.timedOutAt).toBeUndefined();
    expect(s.scenes.s1.attempts).toBe(1);
  });

  it("is ignored before an expiry, so连点 cannot stack timers", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    expect(retry(game, s, "s1", T + 1_000)).toBe(s);
    // Once expired, the second tap finds nothing left to clear.
    s = expire(game, s, "s1", T + 30_000);
    const first = retry(game, s, "s1", T + 31_000);
    expect(retry(game, first, "s1", T + 31_050)).toBe(first);
    expect(first.scenes.s1.attemptStartedAt).toBe(T + 31_000);
  });

  it("does not carry elapsed time into the next attempt", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    s = retry(game, s, "s1", T + 10 * MIN); // the player walked away first
    // The whole window is available again, measured from the retry.
    s = submit(game, s, "s1", T + 10 * MIN + 29_999);
    expect(s.scenes.s1.status).toBe("completed");
  });

  it("still expires the retried attempt on its own deadline", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    s = retry(game, s, "s1", T + 31_000);
    s = expire(game, s, "s1", T + 61_000);
    expect(s.scenes.s1.attempts).toBe(2);
    expect(s.scenes.s1.timedOutAt).toBe(T + 61_000);
  });

  it("never touches progress or rewards of other scenes", () => {
    const game = timedGame(30, [scene("s2", { requires: ["s1"] })]);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    s = retry(game, s, "s1", T + 31_000);
    expect(s.scenes.s2.status).toBe("locked");
    expect(s.scenes.s2.attempts).toBe(0);
    expect(s.inventory).toHaveLength(0);
  });
});

describe("scene switching", () => {
  it("gives every question its own clock", () => {
    const game: Game = {
      ...timedGame(30),
      scenes: [
        scene("s1", {
          challenge: { type: "choice", question: "q1", options: ["A", "B"], answer: 0, timeLimitSeconds: 30 },
        }),
        scene("s2", {
          requires: ["s1"],
          challenge: { type: "choice", question: "q2", options: ["A", "B"], answer: 0, timeLimitSeconds: 30 },
        }),
      ],
    };
    let s = createInitialState(game, T);
    s = open(game, s, "s1", T);
    s = submit(game, s, "s1", T + 5_000); // s1 completed, s2 opens
    s = open(game, s, "s2", T + 60_000);
    expect(s.scenes.s2.attemptStartedAt).toBe(T + 60_000);
    // s1's leftover expiry must not leak into s2.
    expect(s.scenes.s2.timedOutAt).toBeUndefined();
    expect(s.scenes.s2.attempts).toBe(0);
  });
});

describe("restore / reload", () => {
  it("keeps the running clock, so a reload cannot buy time", () => {
    const game = timedGame(30);
    const s = open(game, createInitialState(game, T), "s1", T);
    const restored = reconcileState(game, JSON.parse(JSON.stringify(s)), T + 20_000);
    expect(restored.scenes.s1.attemptStartedAt).toBe(T);
    expect(remainingMs(game.scenes[0].challenge, restored.scenes.s1, T + 20_000)).toBe(10_000);
    // Answering after the original deadline is still late.
    const late = submit(game, restored, "s1", T + 30_000);
    expect(late.scenes.s1.status).toBe("challenging");
    expect(late.inventory).toHaveLength(0);
  });

  it("keeps an expired attempt expired across a reload", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = expire(game, s, "s1", T + 30_000);
    const restored = reconcileState(game, JSON.parse(JSON.stringify(s)), T + 5 * MIN);
    expect(timedPhase(game.scenes[0].challenge, restored.scenes.s1, T + 5 * MIN)).toBe("expired");
    expect(submit(game, restored, "s1", T + 5 * MIN)).toBe(restored);
    expect(restored.scenes.s1.attempts).toBe(1);
  });

  it("restores a completed timed scene without a lingering clock", () => {
    const game = timedGame(30);
    let s = open(game, createInitialState(game, T), "s1", T);
    s = submit(game, s, "s1", T + 3_000);
    const restored = reconcileState(game, JSON.parse(JSON.stringify(s)), T + MIN);
    expect(restored.scenes.s1.status).toBe("completed");
    expect(restored.scenes.s1.attemptStartedAt).toBeUndefined();
    expect(restored.scenes.s1.attempts).toBe(0);
  });

  it("drops a stale clock when the author removes the limit", () => {
    const timed = timedGame(30);
    let s = open(timed, createInitialState(timed, T), "s1", T);
    s = expire(timed, s, "s1", T + 30_000);

    const untimedVersion: Game = {
      ...timed,
      version: "1.0.1",
      scenes: [{ ...timed.scenes[0], challenge: { type: "choice", question: "q", options: ["A", "B"], answer: 0 } }],
    };
    const restored = reconcileState(untimedVersion, JSON.parse(JSON.stringify(s)), T + MIN);
    expect(restored.scenes.s1.attemptStartedAt).toBeUndefined();
    expect(restored.scenes.s1.timedOutAt).toBeUndefined();
    // The question is answerable again, with the failure count preserved.
    expect(restored.scenes.s1.attempts).toBe(1);
    const done = submit(untimedVersion, restored, "s1", T + 2 * MIN);
    expect(done.scenes.s1.status).toBe("completed");
  });

  it("restores a legacy save with no timing fields at all", () => {
    const game = timedGame(30);
    const legacy = {
      gameId: game.id,
      gameVersion: "0.9.0",
      currentSceneId: "s1",
      scenes: {
        s1: {
          sceneId: "s1",
          status: "challenging",
          attempts: 2,
          grantedRewardIds: [],
        },
      },
      inventory: [],
      keywords: [],
      startedAt: T - 10 * MIN,
      lastUpdatedAt: T - MIN,
    };
    const restored = reconcileState(game, legacy as never, T);
    expect(restored.scenes.s1.attempts).toBe(2);
    expect(restored.scenes.s1.attemptStartedAt).toBeUndefined();
    // No clock was recorded, so the question opens with a fresh one rather than
    // dropping straight into "expired".
    const opened = open(game, restored, "s1", T);
    expect(opened.scenes.s1.attemptStartedAt).toBe(T);
  });
});

describe("content validation", () => {
  function packWith(extra: Record<string, unknown>): unknown {
    return {
      id: "val-timed",
      language: "zh-CN",
      title: "Validation",
      description: "validation fixture",
      version: "1.0.0",
      startLocation: { lat: 0, lng: 0 },
      entrySceneId: "a",
      scenes: [
        {
          id: "a",
          title: "A",
          story: "s",
          location: { lat: 0.001, lng: 0.001, radius: 50 },
          nextSceneId: null,
          challenge: { type: "choice", question: "q", options: ["A", "B"], answer: 0, ...extra },
          reward: { type: "keyword", title: "a", value: "a" },
        },
      ],
    };
  }

  it("accepts a pack without a limit", () => {
    const { issues } = validateGame(packWith({}));
    expect(issues.filter((i) => i.path.includes("timeLimit"))).toHaveLength(0);
  });

  it("accepts a positive limit without warnings", () => {
    const { game, issues } = validateGame(packWith({ timeLimitSeconds: 90 }));
    expect(game.scenes[0].challenge?.timeLimitSeconds).toBe(90);
    expect(issues.filter((i) => i.path.includes("timeLimit"))).toHaveLength(0);
  });

  it("rejects zero, negatives and non-numbers", () => {
    for (const bad of [0, -30, "90", Number.NaN]) {
      expect(() => validateGame(packWith({ timeLimitSeconds: bad }))).toThrow(/timeLimitSeconds/);
    }
  });

  it("warns on a limit that is too short to answer", () => {
    const { issues } = validateGame(packWith({ timeLimitSeconds: 3 }));
    expect(issues.some((i) => i.path.includes("timeLimitSeconds") && i.severity === "warning")).toBe(
      true,
    );
  });

  it("survives an export/import round trip", async () => {
    const { exportGameJson, validateGamePackage } = await import("@/lib/game/package");
    const game = timedGame(90);
    const json = exportGameJson(game);
    const report = validateGamePackage(JSON.parse(json));
    expect(report.game?.scenes[0].challenge?.timeLimitSeconds).toBe(90);
  });
});
