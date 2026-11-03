/**
 * Haptic feedback - progressive enhancement only.
 *
 * A short single pulse on arrival gives outdoor players a second channel when
 * the screen is hard to see or the sound is still gesture-locked. Rules:
 *
 *  - Vibration API only, no dependencies, no permissions to ask for.
 *  - Unsupported devices (iOS Safari has no navigator.vibrate) return false
 *    and nothing else happens - never an error, never a fallback UI.
 *  - Any API misbehaviour is swallowed: haptics must never block or break the
 *    arrival prompt, the sound, or the reward flow.
 *  - One short pulse per call; callers key it per arrival so boundary noise
 *    cannot re-buzz.
 */

/** Duration of the arrival pulse in ms. Deliberately light (~one tick). */
const ARRIVAL_PULSE_MS = 30;

export type VibrateTarget = Pick<Navigator, "vibrate">;

/**
 * Fire the arrival pulse. Returns true only when the browser accepted a
 * vibration; false means unsupported, refused, or failed - all equally silent.
 */
export function vibrateOnArrival(target?: VibrateTarget): boolean {
  let nav: VibrateTarget | undefined = target;
  if (!nav && typeof navigator !== "undefined") nav = navigator as VibrateTarget;
  if (!nav || typeof nav.vibrate !== "function") return false;
  try {
    return nav.vibrate(ARRIVAL_PULSE_MS) === true;
  } catch {
    return false;
  }
}
