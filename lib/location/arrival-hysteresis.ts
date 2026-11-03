/**
 * Arrival hysteresis - decide WHEN a ring containment becomes an arrival.
 *
 * The engine (`lib/game/state.ts` FIX_UPDATE) flips `locked -> arrived` on the
 * first fix inside the ring and `arrived -> locked` on the first fix outside.
 * That is correct for a clean signal, but a real phone at the ring edge
 * produces a fix sequence like:
 *
 *   45m in, 55m out, 48m in, 52m out ...   (radius 50 m)
 *
 * Each "in" re-stamps `arrivedAt`, and each re-stamp is a brand-new arrival
 * event downstream (`lib/game/arrival.ts` event key), so the prompt + sound
 * can fire repeatedly while the player stands still. B-01 audit scenario G.
 *
 * This module adds a per-scene state machine BETWEEN the raw distance fix and
 * the engine:
 *
 *   1. ENTER confirmation (F5): a scene only becomes "inside" after
 *      `confirmFixes` consecutive reliable fixes within the enter radius.
 *      A fix is unreliable for confirmation when its reported accuracy is
 *      worse than the ring it claims to be in (`accuracyM > enterRadiusM`)
 *      - such a fix neither advances nor resets the counter, and never flips
 *      the confirmed state by itself.
 *   2. EXIT hysteresis (F6): the confirmed "inside" state only clears when
 *      the player is beyond `exitRadiusFactor * radius` (default 1.5x).
 *      Between the enter radius and the exit radius the state HOLDS - a
 *      light GPS drift never revokes an arrival that was just confirmed.
 *   3. Repeats (F7): because oscillation inside the exit radius can no
 *      longer produce an outside->inside transition, it can no longer
 *      produce a second `arrivedAt` stamp. Genuine re-arrivals (walk out
 *      beyond the exit radius and back) still stamp fresh and still prompt -
 *      reward idempotency remains the engine's `grantedRewardIds`, which is
 *      untouched.
 *
 * The module is pure state, no timers and no storage: it advances exactly
 * once per fix handed to `update()`. `fixKey` lets callers feed the same fix
 * through several render passes without double-counting.
 *
 * Defaults are initial candidates from the B-01 plan (2 fixes / 1.5x) and
 * are validated by `tests/location/arrival-hysteresis.test.ts`; both are
 * constructor-tunable so field calibration can adjust them without code
 * edits.
 */

export interface ArrivalHysteresisConfig {
  /** Reliable fixes inside the enter radius required to confirm an arrival. */
  confirmFixes: number;
  /** Exit ring = base radius * this factor. Must be >= 1. */
  exitRadiusFactor: number;
  /**
   * A fix whose accuracy exceeds its enter radius cannot confirm an arrival
   * (the error bar is bigger than the claim). Kept as a named knob so field
   * data can tighten or relax it.
   */
  rejectAccuracyBeyondEnterRadius: boolean;
}

export const ARRIVAL_HYSTERESIS_DEFAULTS: Readonly<ArrivalHysteresisConfig> = {
  confirmFixes: 2,
  exitRadiusFactor: 1.5,
  rejectAccuracyBeyondEnterRadius: true,
};

/** Per-scene machine state. */
export interface SceneArrivalState {
  /** Confirmed containment (already announced upstream exactly once). */
  inside: boolean;
  /** Consecutive reliable fixes inside the enter radius since last reset. */
  consecutiveInside: number;
}

export interface ArrivalFixInput {
  /** Raw distance from the player to the target, in metres. */
  distanceM: number;
  /** The scene's base trigger radius, in metres. */
  baseRadiusM: number;
  /**
   * The effective enter radius (base radius plus any accuracy slack the
   * caller's product settings grant), in metres.
   */
  enterRadiusM: number;
  /** Reported GPS accuracy of this fix, in metres (null when unknown). */
  accuracyM: number | null;
}

export interface ArrivalStepResult {
  /** Confirmed containment after this fix. */
  inside: boolean;
  /** True only on the fix that confirms a fresh outside->inside transition. */
  justEntered: boolean;
  /** True only on the fix that clears inside via the exit radius. */
  justExited: boolean;
  /** True when this fix was ignored as unreliable (state held, counter kept). */
  unreliableFix: boolean;
}

function clampConfig(config: ArrivalHysteresisConfig): ArrivalHysteresisConfig {
  return {
    confirmFixes: Math.max(1, Math.floor(config.confirmFixes)),
    exitRadiusFactor: Math.max(1, config.exitRadiusFactor),
    rejectAccuracyBeyondEnterRadius: config.rejectAccuracyBeyondEnterRadius,
  };
}

/**
 * Advance one scene's machine by one fix. Pure: returns the next state and
 * the transition flags, mutates nothing.
 */
export function stepSceneArrival(
  prev: SceneArrivalState | undefined,
  input: ArrivalFixInput,
  config: ArrivalHysteresisConfig = ARRIVAL_HYSTERESIS_DEFAULTS,
): { state: SceneArrivalState; result: ArrivalStepResult } {
  const cfg = clampConfig(config);
  const state: SceneArrivalState = {
    inside: prev?.inside ?? false,
    consecutiveInside: prev?.consecutiveInside ?? 0,
  };

  const exitRadiusM = input.baseRadiusM * cfg.exitRadiusFactor;

  // An unusable fix must not move the machine in either direction: neither
  // confirm an arrival nor revoke one. Counters are also held - a single
  // noisy reading in the middle of a walk-in should not restart the count.
  const unreliable =
    cfg.rejectAccuracyBeyondEnterRadius &&
    input.accuracyM !== null &&
    input.accuracyM > input.enterRadiusM;

  if (unreliable || !Number.isFinite(input.distanceM)) {
    return {
      state,
      result: { inside: state.inside, justEntered: false, justExited: false, unreliableFix: true },
    };
  }

  if (input.distanceM <= input.enterRadiusM) {
    if (state.inside) {
      return {
        state,
        result: { inside: true, justEntered: false, justExited: false, unreliableFix: false },
      };
    }
    state.consecutiveInside += 1;
    if (state.consecutiveInside >= cfg.confirmFixes) {
      state.inside = true;
      return {
        state,
        result: { inside: true, justEntered: true, justExited: false, unreliableFix: false },
      };
    }
    return {
      state,
      result: { inside: false, justEntered: false, justExited: false, unreliableFix: false },
    };
  }

  // Outside the enter ring.
  state.consecutiveInside = 0;

  if (input.distanceM > exitRadiusM) {
    // Beyond the exit ring: the only place an arrival can be revoked.
    if (state.inside) {
      state.inside = false;
      return {
        state,
        result: { inside: false, justEntered: false, justExited: true, unreliableFix: false },
      };
    }
    return {
      state,
      result: { inside: false, justEntered: false, justExited: false, unreliableFix: false },
    };
  }

  // Buffer band (enter < d <= exit): hold the confirmed state, whether
  // inside (drift must not revoke) or outside (must not confirm).
  return {
    state,
    result: { inside: state.inside, justEntered: false, justExited: false, unreliableFix: false },
  };
}

/**
 * All scenes of one hunt. Keyed by scene id; `resetAll()` on pack load or
 * hunt reset keeps the map bounded by the pack's scene count.
 */
export class ArrivalHysteresis {
  private readonly config: ArrivalHysteresisConfig;
  private readonly scenes = new Map<string, { state: SceneArrivalState; lastFixKey: string | null }>();

  constructor(config: Partial<ArrivalHysteresisConfig> = {}) {
    this.config = clampConfig({ ...ARRIVAL_HYSTERESIS_DEFAULTS, ...config });
  }

  /**
   * Feed one fix for one scene. When `fixKey` matches the previous call for
   * the scene (the same fix re-rendered), the stored result is returned
   * without advancing the machine - re-renders must not double-count.
   */
  update(sceneId: string, input: ArrivalFixInput, fixKey?: string): ArrivalStepResult {
    const entry = this.scenes.get(sceneId);
    if (entry && fixKey !== undefined && entry.lastFixKey === fixKey) {
      return {
        inside: entry.state.inside,
        justEntered: false,
        justExited: false,
        unreliableFix: false,
      };
    }
    const { state, result } = stepSceneArrival(entry?.state, input, this.config);
    this.scenes.set(sceneId, { state, lastFixKey: fixKey ?? null });
    return result;
  }

  isInside(sceneId: string): boolean {
    return this.scenes.get(sceneId)?.state.inside ?? false;
  }

  resetScene(sceneId: string): void {
    this.scenes.delete(sceneId);
  }

  /** Call on pack load / hunt reset so a previous game can never leak in. */
  resetAll(): void {
    this.scenes.clear();
  }

  /** Test/telemetry hook: how many scene machines are alive. */
  get size(): number {
    return this.scenes.size;
  }
}
