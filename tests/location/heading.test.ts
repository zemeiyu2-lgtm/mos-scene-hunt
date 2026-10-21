/**
 * Heading smoothing tests (issue 1).
 *
 * The map's direction tail must glide smoothly, must never spin the long way
 * round through 0/360, and must never fabricate a direction when the device
 * has none.
 */
import { describe, expect, it } from "vitest";
import { headingDelta, smoothHeading } from "@/lib/location/heading";

describe("headingDelta", () => {
  it("returns the shortest arc", () => {
    expect(headingDelta(350, 10)).toBe(20); // across north, not -340
    expect(headingDelta(10, 350)).toBe(-20);
    expect(headingDelta(90, 180)).toBe(90);
    expect(headingDelta(180, 90)).toBe(-90);
  });
});

describe("smoothHeading", () => {
  it("snaps to the first sample when there is no previous heading", () => {
    expect(smoothHeading(null, 350)).toBe(350);
  });

  it("moves part of the way toward the new sample", () => {
    const next = smoothHeading(0, 100, 0.4);
    expect(next).toBeCloseTo(40, 5);
  });

  it("glides across north without spinning backwards", () => {
    const next = smoothHeading(350, 10, 0.5);
    expect(next).toBeCloseTo(0, 5); // 350 + 20*0.5 = 360 -> wraps to 0, through north
  });

  it("stays inside 0-360 and is finite", () => {
    let value = 359;
    for (let i = 0; i < 50; i++) {
      value = smoothHeading(value, (i * 137) % 360, 0.4);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(360);
    }
  });

  it("ignores non-finite samples instead of producing NaN", () => {
    expect(smoothHeading(45, Number.NaN)).toBe(45);
    expect(smoothHeading(null, Number.NaN)).toBe(0);
  });
});
