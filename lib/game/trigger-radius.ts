/**
 * Trigger-radius editor rules.
 *
 * The design slider covers the common range (10-100m, step 5). The numeric
 * input accepts the full legal range the runtime validator allows (any
 * positive number, with warnings below 10m and above 300m). The editor floor
 * and ceiling here are deliberately wider than the slider but narrower than
 * "any positive number" so obvious typos (0, 0.5, 99999) fail loudly instead
 * of silently saving a broken hunt.
 */

/** Editor floor. The runtime still warns below 10m (GPS jitter). */
export const TRIGGER_RADIUS_EDITOR_MIN = 5;
/** Editor ceiling. The runtime warns above 300m. */
export const TRIGGER_RADIUS_EDITOR_MAX = 500;

/** Slider quick-range bounds (kept in sync with the designer UI). */
export const TRIGGER_RADIUS_SLIDER_MIN = 10;
export const TRIGGER_RADIUS_SLIDER_MAX = 100;
export const TRIGGER_RADIUS_SLIDER_STEP = 5;

export interface TriggerRadiusParseResult {
  ok: boolean;
  /** The rounded value to store, present only when ok. */
  value?: number;
  /** Designer-readable reason, present only when !ok. */
  error?: string;
}

/**
 * Parse a trigger radius as typed into the numeric editor field.
 *
 * Accepts numbers and numeric strings ("15", " 20 "), rounds to whole metres,
 * and rejects non-finite input, values at or below the floor, and values above
 * the ceiling with a designer-readable error. Sub-10m values are allowed (the
 * runtime handles them with a warning, e.g. indoor tests) — the editor must be
 * able to *save* the legal minimum, not silently widen it.
 */
export function parseTriggerRadius(input: string | number): TriggerRadiusParseResult {
  const raw = typeof input === "number" ? input : Number(String(input).trim());
  if (String(input).trim() === "" || !Number.isFinite(raw)) {
    return { ok: false, error: "请输入数字，例如 15" };
  }
  const rounded = Math.round(raw);
  if (rounded < TRIGGER_RADIUS_EDITOR_MIN) {
    return {
      ok: false,
      error: `触发距离最小 ${TRIGGER_RADIUS_EDITOR_MIN}m（小于 10m 在真实 GPS 误差下很难触发）`,
    };
  }
  if (rounded > TRIGGER_RADIUS_EDITOR_MAX) {
    return { ok: false, error: `触发距离最大 ${TRIGGER_RADIUS_EDITOR_MAX}m，过大会提前触发` };
  }
  return { ok: true, value: rounded };
}
