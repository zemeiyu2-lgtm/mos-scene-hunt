/**
 * Arrival hysteresis (lib/location/arrival-hysteresis.ts).
 *
 * B-01B acceptance: two-fix entry confirmation, accuracy-aware fix
 * rejection, exit-only-beyond-the-exit-ring (1.5x default), no
 * boundary-oscillation re-triggering, and fixKey dedupe so re-renders
 * cannot double-count.
 */

import { describe, expect, it } from "vitest";
import {
  ARRIVAL_HYSTERESIS_DEFAULTS,
  ArrivalHysteresis,
  stepSceneArrival,
} from "@/lib/location/arrival-hysteresis";

/** Convenience: one walking fix at a given distance, radius 50 m. */
function fix(distanceM: number, accuracyM: number | null = 10) {
  return { distanceM, baseRadiusM: 50, enterRadiusM: 50, accuracyM };
}

describe("stepSceneArrival - entry confirmation (F5)", () => {
  it("does not confirm on the first fix inside the ring", () => {
    const { state, result } = stepSceneArrival(undefined, fix(30));
    expect(result.inside).toBe(false);
    expect(result.justEntered).toBe(false);
    expect(state.consecutiveInside).toBe(1);
  });

  it("confirms on the second consecutive fix inside the ring", () => {
    const first = stepSceneArrival(undefined, fix(30));
    const second = stepSceneArrival(first.state, fix(28));
    expect(second.result.inside).toBe(true);
    expect(second.result.justEntered).toBe(true);
  });

  it("resets the counter when a fix lands outside the enter radius", () => {
    const first = stepSceneArrival(undefined, fix(30));
    const outside = stepSceneArrival(first.state, fix(90));
    expect(outside.state.consecutiveInside).toBe(0);
    const again = stepSceneArrival(outside.state, fix(30));
    expect(again.result.inside).toBe(false);
    expect(again.state.consecutiveInside).toBe(1);
  });

  it("rejects a fix whose accuracy is worse than the ring it claims (F5)", () => {
    const first = stepSceneArrival(undefined, fix(30, 10));
    // accuracy 80 m > enter radius 50 m: unreliable, machine must hold.
    const noisy = stepSceneArrival(first.state, fix(30, 80));
    expect(noisy.result.unreliableFix).toBe(true);
    expect(noisy.result.inside).toBe(false);
    // The unreliable fix neither advanced nor reset the count.
    expect(noisy.state.consecutiveInside).toBe(1);
    const confirm = stepSceneArrival(noisy.state, fix(30, 10));
    expect(confirm.result.justEntered).toBe(true);
  });

  it("never flips state on a non-finite distance", () => {
    const first = stepSceneArrival(undefined, fix(30));
    const bad = stepSceneArrival(first.state, fix(Number.NaN));
    expect(bad.result.unreliableFix).toBe(true);
    expect(bad.state.inside).toBe(false);
  });
});

describe("stepSceneArrival - exit hysteresis (F6)", () => {
  function confirmed() {
    const a = stepSceneArrival(undefined, fix(30));
    return stepSceneArrival(a.state, fix(30)).state;
  }

  it("holds 'inside' for drift between the enter and exit radius", () => {
    const state = confirmed();
    // 1.2x radius = 60 m: inside the exit ring (75 m), outside the enter ring.
    const drift = stepSceneArrival(state, fix(60));
    expect(drift.result.inside).toBe(true);
    expect(drift.result.justExited).toBe(false);
  });

  it("clears 'inside' only beyond the exit radius (1.5x default)", () => {
    const state = confirmed();
    const held = stepSceneArrival(state, fix(70));
    expect(held.result.inside).toBe(true);
    const exited = stepSceneArrival(held.state, fix(80));
    expect(exited.result.inside).toBe(false);
    expect(exited.result.justExited).toBe(true);
  });

  it("a single noisy reading cannot revoke a confirmed arrival", () => {
    const state = confirmed();
    const noisy = stepSceneArrival(state, fix(200, 900));
    expect(noisy.result.unreliableFix).toBe(true);
    expect(noisy.state.inside).toBe(true);
  });

  it("config can tighten the exit factor", () => {
    const state = confirmed();
    const tight = stepSceneArrival(
      state,
      fix(60),
      { ...ARRIVAL_HYSTERESIS_DEFAULTS, exitRadiusFactor: 1.1 },
    );
    expect(tight.result.justExited).toBe(true);
  });

  it("does not confirm from inside the buffer band", () => {
    const first = stepSceneArrival(undefined, fix(90));
    // 1.3x radius: past the enter ring, inside the exit ring, never confirmed.
    const buffered = stepSceneArrival(first.state, fix(65));
    expect(buffered.result.inside).toBe(false);
    expect(buffered.result.justEntered).toBe(false);
  });
});

describe("ArrivalHysteresis - boundary oscillation (F7, audit scenario G)", () => {
  it("standing at the ring edge produces exactly ONE justEntered and no flapping", () => {
    const h = new ArrivalHysteresis();
    // Realistic edge sequence: walk-in (confirm), then drift across the line.
    const edge = [45, 48, 52, 47, 55, 49, 53, 46, 50, 48];
    const transitions: string[] = [];
    for (const d of edge) {
      const r = h.update("s1", fix(d), `k${d}`);
      if (r.justEntered) transitions.push(`enter@${d}`);
      if (r.justExited) transitions.push(`exit@${d}`);
    }
    // After confirmation (second fix), oscillation within the exit ring
    // must never produce another transition in either direction.
    expect(transitions).toEqual(["enter@48"]);
    expect(h.isInside("s1")).toBe(true);
  });

  it("a genuine walk-out beyond the exit ring and back re-arms arrival", () => {
    const h = new ArrivalHysteresis();
    h.update("s1", fix(30), "k1");
    const entered = h.update("s1", fix(30), "k2");
    expect(entered.justEntered).toBe(true);

    // Walk far away, then come back.
    h.update("s1", fix(300), "k3");
    expect(h.isInside("s1")).toBe(false);
    h.update("s1", fix(40), "k4");
    const reentered = h.update("s1", fix(40), "k5");
    expect(reentered.justEntered).toBe(true);
  });

  it("the same fixKey never double-counts", () => {
    const h = new ArrivalHysteresis();
    h.update("s1", fix(30), "fix-A");
    h.update("s1", fix(30), "fix-A"); // re-render with the same fix
    h.update("s1", fix(30), "fix-A");
    // Still only ONE fix has been counted.
    expect(h.isInside("s1")).toBe(false);
    const r = h.update("s1", fix(30), "fix-B");
    expect(r.justEntered).toBe(true);
  });

  it("tracks scenes independently and resets cleanly", () => {
    const h = new ArrivalHysteresis();
    h.update("a", fix(30), "k1");
    h.update("a", fix(30), "k2");
    h.update("b", fix(30), "k1");
    expect(h.isInside("a")).toBe(true);
    expect(h.isInside("b")).toBe(false);
    expect(h.size).toBe(2);
    h.resetScene("a");
    expect(h.isInside("a")).toBe(false);
    h.update("b", fix(30), "k2");
    h.resetAll();
    expect(h.size).toBe(0);
  });

  it("confirmFixes is configurable", () => {
    const h = new ArrivalHysteresis({ confirmFixes: 1 });
    const r = h.update("s1", fix(30), "k1");
    expect(r.justEntered).toBe(true);
  });
});
