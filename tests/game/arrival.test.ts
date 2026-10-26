/**
 * Arrival prompt bookkeeping.
 *
 * These cover the decision that used to be "always auto-navigate on a fresh
 * arrival": should the map raise the arrival card for this event, exactly once?
 * The rules under test are the ones that protect real players:
 *   - no prompt before arriving, and none for a stale arrival;
 *   - one prompt per arrival event, whatever the GPS/render churn;
 *   - a genuine re-arrival (engine re-stamps arrivedAt) is announced again;
 *   - the same scene id in a different game is a different event.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRESH_ARRIVAL_WINDOW_MS,
  PROMPT_REPEAT_GUARD_MS,
  RELOAD_SUPPRESS_MS,
  SERVED_ARRIVALS_KEY,
  SERVED_TARGETS_KEY,
  arrivalEventKey,
  arrivalTargetKey,
  isFreshArrival,
  loadServedArrivals,
  loadServedTargets,
  pruneServedArrivals,
  saveServedArrivals,
  saveServedTargets,
} from "@/lib/game/arrival";
import { decideArrivalPrompt } from "@/lib/game/arrival-decision";

const GAME = "demo-hunt";
const OTHER_GAME = "igsl-eight-transformations";
const SCENE = "clock-tower";
const NOW = 1_700_000_000_000;

describe("arrivalEventKey", () => {
  it("binds the game, the scene and the arrival stamp", () => {
    expect(arrivalEventKey(GAME, SCENE, NOW)).toBe(`${GAME}/${SCENE}/${NOW}`);
  });

  it("does not collide across games that reuse a scene id", () => {
    const a = arrivalEventKey(GAME, SCENE, NOW);
    const b = arrivalEventKey(OTHER_GAME, SCENE, NOW);
    expect(a).not.toBe(b);
  });

  it("treats each arrival stamp as its own event", () => {
    expect(arrivalEventKey(GAME, SCENE, NOW)).not.toBe(arrivalEventKey(GAME, SCENE, NOW + 1));
  });

  it("returns null when identity is incomplete", () => {
    expect(arrivalEventKey(undefined, SCENE, NOW)).toBeNull();
    expect(arrivalEventKey(GAME, "", NOW)).toBeNull();
    expect(arrivalEventKey(GAME, SCENE, undefined)).toBeNull();
    expect(arrivalEventKey(GAME, SCENE, 0)).toBeNull();
  });
});

describe("isFreshArrival", () => {
  it("rejects a missing stamp", () => {
    expect(isFreshArrival(undefined, NOW)).toBe(false);
  });

  it("accepts a stamp inside the fresh window", () => {
    expect(isFreshArrival(NOW - 1_000, NOW)).toBe(true);
    expect(isFreshArrival(NOW - FRESH_ARRIVAL_WINDOW_MS, NOW)).toBe(true);
  });

  it("rejects an arrival older than the fresh window", () => {
    expect(isFreshArrival(NOW - FRESH_ARRIVAL_WINDOW_MS - 1, NOW)).toBe(false);
    expect(isFreshArrival(NOW - 5 * 60_000, NOW)).toBe(false);
  });

  it("treats a future stamp as fresh rather than swallowing the arrival", () => {
    expect(isFreshArrival(NOW + 60_000, NOW)).toBe(true);
  });
});

describe("decideArrivalPrompt", () => {
  const base = { gameId: GAME, sceneId: SCENE, arrivedAt: NOW, lastServed: new Map<string, number>() };

  it("does not prompt while the player has not arrived", () => {
    expect(decideArrivalPrompt({ ...base, sceneId: null, now: NOW })).toBe(false);
  });

  it("does not prompt without an arrival stamp", () => {
    expect(decideArrivalPrompt({ ...base, arrivedAt: undefined, now: NOW })).toBe(false);
  });

  it("does not prompt for a stale arrival (e.g. progress restored after a refresh)", () => {
    expect(decideArrivalPrompt({ ...base, now: NOW + FRESH_ARRIVAL_WINDOW_MS + 1 })).toBe(false);
  });

  it("prompts on a fresh arrival", () => {
    expect(decideArrivalPrompt({ ...base, now: NOW })).toBe(true);
  });

  it("prompts once per arrival event, however many times it is asked", () => {
    const lastServed = new Map<string, number>();
    expect(decideArrivalPrompt({ ...base, now: NOW, lastServed })).toBe(true);
    lastServed.set(arrivalEventKey(GAME, SCENE, NOW)!, NOW);
    // Repeated GPS callbacks / re-renders / remounts within the guard window.
    expect(decideArrivalPrompt({ ...base, now: NOW + 50, lastServed })).toBe(false);
    expect(decideArrivalPrompt({ ...base, now: NOW + 3_000, lastServed })).toBe(false);
    expect(decideArrivalPrompt({ ...base, now: NOW + PROMPT_REPEAT_GUARD_MS - 1, lastServed })).toBe(false);
  });

  it("prompts again when the player leaves and walks back in (new arrival stamp)", () => {
    const lastServed = new Map<string, number>();
    expect(decideArrivalPrompt({ ...base, now: NOW, lastServed })).toBe(true);
    lastServed.set(arrivalEventKey(GAME, SCENE, NOW)!, NOW);

    // Engine re-stamps arrivedAt when the player crosses the ring again. The
    // stored record is `locked` with the previous stamp, which is what a
    // walk-out leaves behind.
    const reArrivedAt = NOW + 90_000;
    const reArrival = decideArrivalPrompt({
      ...base,
      arrivedAt: reArrivedAt,
      now: reArrivedAt,
      lastServed,
      persistedStatus: "locked",
      persistedArrivedAt: NOW,
      hadProgressOnLoad: true,
      firstEvaluation: false,
    });
    expect(reArrival).toBe(true);
  });

  it("does not let a cooldown for one scene block another target", () => {
    const lastServed = new Map<string, number>();
    lastServed.set(arrivalEventKey(GAME, SCENE, NOW)!, NOW);
    // A different scene arriving at the same instant must still be announced.
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: "fountain",
        arrivedAt: NOW,
        now: NOW,
        lastServed,
      }),
    ).toBe(true);
  });

  it("does not let one game's arrival suppress another game's arrival", () => {
    const lastServed = new Map<string, number>();
    lastServed.set(arrivalEventKey(GAME, SCENE, NOW)!, NOW);
    expect(
      decideArrivalPrompt({
        gameId: OTHER_GAME,
        sceneId: SCENE,
        arrivedAt: NOW,
        now: NOW,
        lastServed,
      }),
    ).toBe(true);
  });

  it("never treats a missing game id as a wildcard match", () => {
    expect(decideArrivalPrompt({ ...base, gameId: undefined, now: NOW })).toBe(false);
  });
});

describe("pruneServedArrivals", () => {
  it("keeps the map untouched below the cap", () => {
    const map = new Map<string, number>([["a", NOW]]);
    pruneServedArrivals(map, NOW, 10);
    expect(map.size).toBe(1);
  });

  it("drops only entries whose guard window has elapsed", () => {
    const map = new Map<string, number>([
      ["stale", NOW - PROMPT_REPEAT_GUARD_MS - 1],
      ["fresh", NOW],
    ]);
    // Two extra entries push it past a cap of 2.
    map.set("stale2", NOW - PROMPT_REPEAT_GUARD_MS - 5);
    pruneServedArrivals(map, NOW, 2);
    expect(map.has("fresh")).toBe(true);
    expect(map.has("stale")).toBe(false);
    expect(map.has("stale2")).toBe(false);
  });

  it("bounds a long session so the map cannot grow forever", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const at = NOW + i * (PROMPT_REPEAT_GUARD_MS + 1);
      map.set(`k${i}`, at);
      pruneServedArrivals(map, at, 50);
    }
    expect(map.size).toBeLessThanOrEqual(50);
  });
});

/* ------------------------------------------------------------------ */
/* Persistence across a full page reload                               */
/* ------------------------------------------------------------------ */

/** Minimal localStorage/sessionStorage so the module behaves like in a browser. */
function stubStorage() {
  const make = () => {
    const store = new Map<string, string>();
    return {
      store,
      api: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    };
  };
  const local = make();
  const session = make();
  vi.stubGlobal("window", { localStorage: local.api, sessionStorage: session.api });
  return { local: local.store, session: session.store };
}

describe("served arrivals persist across reloads", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("survives a reload: the same arrival is not announced twice", () => {
    stubStorage();
    // First page load: the arrival is announced and recorded.
    const first = loadServedArrivals();
    const key = arrivalEventKey(GAME, SCENE, NOW)!;
    first.set(key, NOW);
    saveServedArrivals(first, NOW);

    // Reload: a brand-new (empty) in-memory map, same arrival stamp.
    const afterReload = loadServedArrivals();
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: NOW,
        now: NOW + 2_000,
        lastServed: afterReload,
      }),
    ).toBe(false);
  });

  it("still announces a genuinely new arrival after a reload", () => {
    stubStorage();
    const first = loadServedArrivals();
    first.set(arrivalEventKey(GAME, SCENE, NOW)!, NOW);
    saveServedArrivals(first, NOW);

    // Player walked out and came back: the engine re-stamped arrivedAt.
    const later = NOW + 5 * 60_000;
    const afterReload = loadServedArrivals();
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: later,
        now: later,
        lastServed: afterReload,
      }),
    ).toBe(true);
  });

  it("does not let one game's record suppress another game's arrival", () => {
    stubStorage();
    const first = loadServedArrivals();
    first.set(arrivalEventKey(GAME, SCENE, NOW)!, NOW);
    saveServedArrivals(first, NOW);

    const afterReload = loadServedArrivals();
    expect(
      decideArrivalPrompt({
        gameId: OTHER_GAME,
        sceneId: SCENE,
        arrivedAt: NOW,
        now: NOW,
        lastServed: afterReload,
      }),
    ).toBe(true);
  });

  it("starts from an empty record when nothing was stored", () => {
    stubStorage();
    expect(loadServedArrivals().size).toBe(0);
  });

  it("ignores corrupt stored data instead of breaking the map", () => {
    const { local: store } = stubStorage();
    store.set(SERVED_ARRIVALS_KEY, "{not json");
    expect(loadServedArrivals().size).toBe(0);

    store.set(SERVED_ARRIVALS_KEY, JSON.stringify({ good: NOW, bad: "x", alsoBad: null }));
    const loaded = loadServedArrivals();
    expect(loaded.get("good")).toBe(NOW);
    expect(loaded.has("bad")).toBe(false);
    expect(loaded.has("alsoBad")).toBe(false);
  });

  it("caps what it writes so storage cannot grow without limit", () => {
    const { local: store } = stubStorage();
    const map = new Map<string, number>();
    for (let i = 0; i < 120; i++) {
      map.set(`g/s${i}/${NOW + i * (PROMPT_REPEAT_GUARD_MS + 1)}`, NOW + i * (PROMPT_REPEAT_GUARD_MS + 1));
    }
    const latest = NOW + 119 * (PROMPT_REPEAT_GUARD_MS + 1);
    saveServedArrivals(map, latest);
    const written = JSON.parse(store.get(SERVED_ARRIVALS_KEY) ?? "{}") as Record<string, number>;
    expect(Object.keys(written).length).toBeLessThanOrEqual(50);
  });

  it("does not throw when storage is blocked", () => {
    // No window at all (SSR) must be a no-op, not a crash.
    vi.unstubAllGlobals();
    expect(() => saveServedArrivals(new Map([["k", NOW]]), NOW)).not.toThrow();
    expect(loadServedArrivals().size).toBe(0);
  });

  it("does not throw when setItem throws (quota exceeded)", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota exceeded");
        },
        removeItem: () => undefined,
      },
    });
    expect(() => saveServedArrivals(new Map([["k", NOW]]), NOW)).not.toThrow();
    expect(store.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Reload vs. genuine re-arrival                                       */
/*                                                                     */
/* reconcileState() rolls a stored `arrived` back to `locked` on load,  */
/* so the next fix re-stamps arrivedAt for a player who never moved.    */
/* Measured on a real map: reload while standing still produces         */
/* T1 -> T2 with no movement, which is why a stamp-only key            */
/* re-announced the arrival. Elapsed time cannot separate the two       */
/* cases either (the restart stamp lands 10-70 ms after hydration,       */
/* i.e. sooner than a real walk-in).                                    */
/* ------------------------------------------------------------------ */

describe("page reload is not a new arrival", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    // Pin the clock: the served-arrival record stamps with Date.now(), so an
    // unpinned clock would put the recorded arrival decades away from NOW.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Simulate: arrival announced, save exists, then the page reloads. */
  function announceThenReload() {
    stubStorage();
    vi.setSystemTime(NOW);
    const served = loadServedArrivals();
    const targets = loadServedTargets();
    const key = arrivalEventKey(GAME, SCENE, NOW)!;
    served.set(key, NOW);
    saveServedArrivals(served, NOW);
    targets.set(arrivalTargetKey(GAME, SCENE)!, NOW);
    saveServedTargets(targets, NOW);
    return { served: loadServedArrivals(), targets: loadServedTargets() };
  }

  it("does not re-announce when the page reloads into the same arrival", () => {
    const { served } = announceThenReload();
    // Same player, never moved. Hydration rolls the stored `arrived` back to
    // `locked` (stamp kept) and the first fix re-stamps it. The previous prompt
    // is only seconds old and still recorded for this target, so the reload
    // must stay silent.
    const reloadedStamp = NOW + 8_000;
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: reloadedStamp,
        now: reloadedStamp,
        lastServed: served,
        persistedStatus: "locked",
        persistedArrivedAt: NOW,
        hadProgressOnLoad: true,
        targetServedAt: NOW,
        firstEvaluation: true,
      }),
    ).toBe(false);
  });

  it("stays silent on the follow-up stamp the engine writes after hydration", () => {
    // Observed in the browser: hydration keeps the OLD stamp, the first decision
    // correctly says nothing, and then the engine's own FIX_UPDATE replaces the
    // stamp with a NEWER one. That second decision still compares against the
    // old stored stamp, so it would look like a walk-back-in if the reload guard
    // only applied to the first decision.
    const { served } = announceThenReload();
    const engineStamp = NOW + 4_500;
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: engineStamp,
        now: engineStamp + 80,
        lastServed: served,
        persistedStatus: "locked",
        persistedArrivedAt: NOW,
        hadProgressOnLoad: true,
        targetServedAt: NOW,
        firstEvaluation: false,
      }),
    ).toBe(false);
  });

  it("announces a first visit that arrives straight from a `locked` record", () => {
    // The shape the browser probe actually produced: the document loaded while
    // the scene was still `locked` with no stamp, then the player entered the
    // ring. A save index entry exists (hydration wrote one), but the scene shows
    // no prior arrival - so this is a first visit and must be announced.
    const { served } = announceThenReload();
    const firstStamp = NOW + 8_000;
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: firstStamp,
        now: firstStamp,
        lastServed: served,
        persistedStatus: "locked",
        persistedArrivedAt: undefined,
        hadProgressOnLoad: true,
        firstEvaluation: true,
      }),
    ).toBe(true);
  });

  it("announces when the player really comes back, once the reload window has passed", () => {
    // A player who left the stop and walked back in leaves the same stored
    // record as a reload (`locked` + the old stamp). Only elapsed time since the
    // previous prompt separates them, and this is well past the reload window.
    const { served } = announceThenReload();
    const backAt = NOW + RELOAD_SUPPRESS_MS;
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: backAt,
        now: backAt,
        lastServed: served,
        persistedStatus: "locked",
        persistedArrivedAt: NOW,
        hadProgressOnLoad: true,
        targetServedAt: NOW,
        firstEvaluation: true,
      }),
    ).toBe(true);
  });

  it.each([RELOAD_SUPPRESS_MS + 1, 4 * 60_000, 9 * 60_000] as const)(
    "announces a walk-back-in %i ms after the last prompt",
    (elapsed) => {
      const { served } = announceThenReload();
      const backAt = NOW + elapsed;
      expect(
        decideArrivalPrompt({
          gameId: GAME,
          sceneId: SCENE,
          arrivedAt: backAt,
          now: backAt,
          lastServed: served,
          persistedStatus: "locked",
          persistedArrivedAt: NOW,
          hadProgressOnLoad: true,
          targetServedAt: NOW,
          firstEvaluation: true,
        }),
      ).toBe(true);
    },
  );

  it.each([10, 60, 74, 500, 2_000] as const)(
    "does not re-announce however soon after hydration the re-stamp lands (%i ms)",
    (delay) => {
      const { served } = announceThenReload();
      const reloadedStamp = NOW + delay;
      expect(
        decideArrivalPrompt({
          gameId: GAME,
          sceneId: SCENE,
          arrivedAt: reloadedStamp,
          now: reloadedStamp,
          lastServed: served,
          persistedStatus: "arrived",
          persistedArrivedAt: NOW,
          hadProgressOnLoad: true,
          targetServedAt: NOW,
          firstEvaluation: true,
        }),
      ).toBe(false);
    },
  );

  it("still announces a first visit (no saved progress when the page loaded)", () => {
    stubStorage();
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: NOW,
        now: NOW,
        lastServed: loadServedArrivals(),
        persistedStatus: "locked",
        persistedArrivedAt: undefined,
        hadProgressOnLoad: false,
        firstEvaluation: true,
      }),
    ).toBe(true);
  });

  it("announces after the saved stamp was cleared (restart) even in a reused document", () => {
    // "Restart hunt" clears the save; the map keeps running in the same
    // document, so this may even be a first evaluation of the target.
    stubStorage();
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: NOW,
        now: NOW,
        lastServed: loadServedArrivals(),
        persistedStatus: "locked",
        persistedArrivedAt: undefined,
        hadProgressOnLoad: false,
        firstEvaluation: true,
      }),
    ).toBe(true);
  });

  it("announces a real re-arrival in the same page session (player walked out and back)", () => {
    const { served } = announceThenReload();
    const reArrivedAt = NOW + 4 * 60_000;
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: reArrivedAt,
        now: reArrivedAt,
        lastServed: served,
        // The previous stamp survived the walk-out, so the reload guard does not
        // even apply here: it is a genuine transition.
        persistedStatus: "locked",
        persistedArrivedAt: NOW,
        hadProgressOnLoad: true,
        firstEvaluation: true,
      }),
    ).toBe(true);
  });

  it("announces a re-arrival late in the same page session, even with a lagging save stamp", () => {
    const { served } = announceThenReload();
    const reArrivedAt = NOW + 6 * 60_000;
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: SCENE,
        arrivedAt: reArrivedAt,
        now: reArrivedAt,
        lastServed: served,
        persistedStatus: "locked",
        persistedArrivedAt: undefined,
        hadProgressOnLoad: true,
        // Same target already evaluated earlier in this document => the player
        // must have moved. Never suppressed.
        firstEvaluation: false,
      }),
    ).toBe(true);
  });

  it("a cooldown for one scene never blocks another scene", () => {
    const { served } = announceThenReload();
    expect(
      decideArrivalPrompt({
        gameId: GAME,
        sceneId: "fountain",
        arrivedAt: NOW + 1_000,
        now: NOW + 1_000,
        lastServed: served,
        persistedStatus: "locked",
        persistedArrivedAt: undefined,
        // Not the first arrival of this document: the player moved.
        hadProgressOnLoad: true,
        firstEvaluation: false,
      }),
    ).toBe(true);
  });

  it("a first arrival in another game still acks the player on a fresh start", () => {
    const { served } = announceThenReload();
    expect(
      decideArrivalPrompt({
        gameId: OTHER_GAME,
        sceneId: SCENE,
        arrivedAt: NOW + 1_000,
        now: NOW + 1_000,
        lastServed: served,
        persistedStatus: "locked",
        persistedArrivedAt: undefined,
        // That other game had no saved progress when the document loaded.
        hadProgressOnLoad: false,
        firstEvaluation: true,
      }),
    ).toBe(true);
  });

  it("persists the per-target stamp so a reload can compare against it", () => {
    const { local } = stubStorage();
    const targets = loadServedTargets();
    targets.set(arrivalTargetKey(GAME, SCENE)!, NOW);
    saveServedTargets(targets, NOW);
    expect(local.has(SERVED_TARGETS_KEY)).toBe(true);
    expect(loadServedTargets().get(`${GAME}/${SCENE}`)).toBe(NOW);
  });
});
