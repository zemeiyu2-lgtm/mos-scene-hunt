/**
 * Trigger-radius editor parsing tests (issue 7).
 *
 * The requirement: the *legal minimum* must be savable, values just below the
 * floor must fail loudly (never silently), and ordinary / maximum values round
 * cleanly to whole metres.
 */
import { describe, expect, it } from "vitest";
import {
  parseTriggerRadius,
  TRIGGER_RADIUS_EDITOR_MAX,
  TRIGGER_RADIUS_EDITOR_MIN,
} from "@/lib/game/trigger-radius";

describe("parseTriggerRadius", () => {
  it("accepts the legal minimum", () => {
    const result = parseTriggerRadius(TRIGGER_RADIUS_EDITOR_MIN);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(5);
  });

  it("rejects a value just below the minimum with a readable error", () => {
    const result = parseTriggerRadius(TRIGGER_RADIUS_EDITOR_MIN - 1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("最小");
    expect(result.value).toBeUndefined();
  });

  it("accepts an ordinary value", () => {
    expect(parseTriggerRadius(15)).toEqual({ ok: true, value: 15 });
  });

  it("accepts the legal maximum", () => {
    expect(parseTriggerRadius(TRIGGER_RADIUS_EDITOR_MAX)).toEqual({
      ok: true,
      value: TRIGGER_RADIUS_EDITOR_MAX,
    });
  });

  it("rejects a value above the maximum", () => {
    const result = parseTriggerRadius(TRIGGER_RADIUS_EDITOR_MAX + 1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("最大");
  });

  it("rounds fractional metres to whole metres", () => {
    expect(parseTriggerRadius(12.4)).toEqual({ ok: true, value: 12 });
    expect(parseTriggerRadius(12.6)).toEqual({ ok: true, value: 13 });
  });

  it("accepts numeric strings with whitespace", () => {
    expect(parseTriggerRadius(" 20 ")).toEqual({ ok: true, value: 20 });
  });

  it("rejects zero and negatives (the runtime validator's hard floor)", () => {
    for (const bad of [0, -1, "0", "-10"]) {
      const result = parseTriggerRadius(bad);
      expect(result.ok, `expected ${bad} to be rejected`).toBe(false);
    }
  });

  it("rejects empty and non-numeric input", () => {
    for (const bad of ["", "   ", "abc", "1.2.3"]) {
      const result = parseTriggerRadius(bad);
      expect(result.ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
      expect(result.error).toContain("请输入数字");
    }
  });

  it("rejects NaN and Infinity", () => {
    expect(parseTriggerRadius(Number.NaN).ok).toBe(false);
    expect(parseTriggerRadius(Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});
