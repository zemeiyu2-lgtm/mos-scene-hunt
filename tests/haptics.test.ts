// @vitest-environment jsdom

/**
 * B-01D vibration feedback (lib/haptics.ts).
 *
 * Contract: progressive enhancement only - supported devices get exactly one
 * light pulse, unsupported browsers and misbehaving APIs degrade silently,
 * and nothing here can block the arrival prompt or the reward flow.
 */

import { describe, expect, it, vi } from "vitest";
import { vibrateOnArrival } from "@/lib/haptics";

function fakeNavigator(vibrate?: unknown): Pick<Navigator, "vibrate"> {
  return (vibrate === undefined ? {} : { vibrate }) as unknown as Pick<Navigator, "vibrate">;
}

describe("vibrateOnArrival", () => {
  it("fires exactly one short pulse when the API is supported", () => {
    const vibrate = vi.fn(() => true);
    expect(vibrateOnArrival(fakeNavigator(vibrate))).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    // Light: a single short pulse, never a persistent or strong pattern.
    expect(vibrate).toHaveBeenCalledWith(30);
  });

  it("returns false and never throws when the API is unsupported", () => {
    expect(vibrateOnArrival(fakeNavigator())).toBe(false);
    expect(vibrateOnArrival(undefined)).toBe(false);
  });

  it("swallows API exceptions and returns false", () => {
    const vibrate = vi.fn(() => {
      throw new Error("NotAllowedError");
    });
    expect(vibrateOnArrival(fakeNavigator(vibrate))).toBe(false);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("treats a refused pulse (falsy return) as not vibrated", () => {
    const vibrate = vi.fn(() => false);
    expect(vibrateOnArrival(fakeNavigator(vibrate))).toBe(false);
  });

  it("uses the page navigator when no target is passed", () => {
    const original = window.navigator.vibrate;
    const vibrate = vi.fn(() => true);
    try {
      Object.defineProperty(window.navigator, "vibrate", {
        configurable: true,
        value: vibrate,
      });
      expect(vibrateOnArrival()).toBe(true);
      expect(vibrate).toHaveBeenCalledWith(30);
    } finally {
      if (original) {
        Object.defineProperty(window.navigator, "vibrate", {
          configurable: true,
          value: original,
        });
      }
    }
  });
});
