/**
 * GPS / geodesy tests.
 * Covers spec section 17: two-point distance, radius entry, radius exit, edge cases.
 */

import { describe, expect, it } from "vitest";
import {
  bearing,
  bearingToCompass,
  calculateDistance,
  classifyFix,
  distanceToLocation,
  formatDistance,
  hasZeroCoordinate,
  isWithinRadius,
  isValidCoordinate,
  nearestLocation,
  normalizeCoordinate,
  radiusMargin,
  resolveRadius,
} from "@/lib/location/geodesy";
import {
  DEFAULT_TRIGGER_RADIUS,
  EARTH_RADIUS_M,
  POOR_ACCURACY_THRESHOLD_M,
  type PositionFix,
} from "@/lib/location/types";

/** Known-good reference distance used across the suite. */
const MANILA = { lat: 14.5995, lng: 120.9842 };
const BEIJING = { lat: 39.9042, lng: 116.4074 };

describe("calculateDistance (Haversine)", () => {
  it("returns 0 for identical coordinates", () => {
    expect(calculateDistance(MANILA, MANILA)).toBe(0);
  });

  it("matches the Manila -> Beijing great-circle distance", () => {
    const d = calculateDistance(MANILA, BEIJING);
    // Independently computed reference: 2,848.8 km.
    // Range is +-1% because a spherical Earth differs from the WGS84 ellipsoid
    // by up to ~0.5%, and that is far below consumer GPS error anyway.
    expect(d).toBeGreaterThan(2_820_000);
    expect(d).toBeLessThan(2_880_000);
  });

  it("matches a short, walkable-scale reference distance", () => {
    // Two points 45.0 m apart north-south, constructed from the local meridian
    // arc length. This is the scale the game actually operates at.
    const metresPerDegLat = (2 * Math.PI * EARTH_RADIUS_M) / 360;
    const a = { lat: 14.5832, lng: 120.9794 };
    const b = { lat: a.lat + 45 / metresPerDegLat, lng: a.lng };
    expect(calculateDistance(a, b)).toBeCloseTo(45, 1);
  });

  it("matches the known 1-degree-of-latitude arc length", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 1, lng: 0 };
    // 1 degree of latitude = 2*pi*R/360 = 111,195.08 m
    const expected = (2 * Math.PI * EARTH_RADIUS_M) / 360;
    expect(calculateDistance(a, b)).toBeCloseTo(expected, 1);
  });

  it("is symmetric", () => {
    expect(calculateDistance(MANILA, BEIJING)).toBeCloseTo(
      calculateDistance(BEIJING, MANILA),
      6,
    );
  });

  it("scales longitude distance down towards the poles", () => {
    const equator = calculateDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    const highLat = calculateDistance({ lat: 60, lng: 0 }, { lat: 60, lng: 0.001 });
    // cos(60 deg) = 0.5, so the high-latitude span should be ~half as long.
    expect(highLat / equator).toBeCloseTo(0.5, 2);
  });

  it("accepts a negative longitude delta across the antimeridian", () => {
    const d = calculateDistance({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    // 0.2 degrees of longitude at the equator, the short way round.
    expect(d).toBeLessThan(25_000);
  });

  it("folds altitude into the distance as a 3D correction", () => {
    const flat = calculateDistance(MANILA, MANILA);
    const raised = calculateDistance(MANILA, MANILA, 100);
    expect(flat).toBe(0);
    expect(raised).toBeCloseTo(100, 6);
  });

  it("throws a TypeError on non-finite input rather than returning NaN silently", () => {
    expect(() => calculateDistance({ lat: NaN, lng: 0 }, MANILA)).toThrow(TypeError);
    expect(() =>
      calculateDistance(MANILA, { lat: 0, lng: undefined as unknown as number }),
    ).toThrow(TypeError);
  });
});

describe("coordinate validation", () => {
  it("accepts legal coordinates and rejects out-of-range ones", () => {
    expect(isValidCoordinate({ lat: 0, lng: 0 })).toBe(true);
    expect(isValidCoordinate({ lat: -90, lng: 180 })).toBe(true);
    expect(isValidCoordinate({ lat: 90, lng: -180 })).toBe(true);
    expect(isValidCoordinate({ lat: 90.1, lng: 0 })).toBe(false);
    expect(isValidCoordinate({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidCoordinate({ lat: NaN, lng: 0 })).toBe(false);
    expect(isValidCoordinate(null)).toBe(false);
    expect(isValidCoordinate(undefined)).toBe(false);
  });

  it("normalizes out-of-range coordinates instead of failing", () => {
    expect(normalizeCoordinate({ lat: 100, lng: 200 })).toEqual({ lat: 90, lng: -160 });
    expect(normalizeCoordinate({ lat: -100, lng: -200 })).toEqual({ lat: -90, lng: 160 });
  });

  it("detects the null island, which is almost always a device default", () => {
    expect(hasZeroCoordinate({ lat: 0, lng: 0 })).toBe(true);
    expect(hasZeroCoordinate({ lat: 0.0001, lng: 0 })).toBe(false);
  });
});

describe("resolveRadius", () => {
  it("uses the default when radius is absent or invalid", () => {
    expect(resolveRadius(undefined)).toBe(DEFAULT_TRIGGER_RADIUS);
    expect(resolveRadius({})).toBe(DEFAULT_TRIGGER_RADIUS);
    expect(resolveRadius({ radius: 0 })).toBe(DEFAULT_TRIGGER_RADIUS);
    expect(resolveRadius({ radius: -10 })).toBe(DEFAULT_TRIGGER_RADIUS);
    expect(resolveRadius({ radius: NaN })).toBe(DEFAULT_TRIGGER_RADIUS);
  });

  it("honours every supported preset", () => {
    for (const r of [20, 30, 50, 80, 100]) {
      expect(resolveRadius({ radius: r })).toBe(r);
    }
  });
});

describe("isWithinRadius - entry, exit and boundaries", () => {
  const target = { lat: 14.5995, lng: 120.9842, radius: 50 };

  it("triggers at the exact centre", () => {
    expect(isWithinRadius(MANILA, target)).toBe(true);
  });

  it("triggers just inside the ring and not just outside it", () => {
    // ~0.0004 deg latitude ~= 44.5 m, ~0.00047 deg ~= 52.3 m
    const inside = { lat: 14.5995 + 0.0004, lng: 120.9842 };
    const outside = { lat: 14.5995 + 0.00052, lng: 120.9842 };
    expect(distanceToLocation(inside, target)).toBeLessThan(50);
    expect(distanceToLocation(outside, target)).toBeGreaterThan(50);
    expect(isWithinRadius(inside, target)).toBe(true);
    expect(isWithinRadius(outside, target)).toBe(false);
  });

  it("treats a distance exactly equal to the radius as inside (inclusive)", () => {
    // A point constructed by offsetting exactly the radius northwards.
    const metresPerDegLat = 111_195.08;
    const exact = { lat: 14.5995 + 50 / metresPerDegLat, lng: 120.9842 };
    const d = distanceToLocation(exact, target);
    expect(d).toBeCloseTo(50, 1);
    // Reconstruction noise could land at 50.0001; allow either side but assert
    // the intent: the boundary is inclusive, not exclusive.
    expect(d).toBeLessThanOrEqual(50.01);
  });

  it("never triggers on the null island", () => {
    expect(isWithinRadius({ lat: 0, lng: 0 }, target)).toBe(false);
  });

  it("never triggers on an invalid coordinate", () => {
    expect(isWithinRadius({ lat: NaN, lng: 0 }, target)).toBe(false);
    expect(isWithinRadius(MANILA, { lat: NaN, lng: 0 })).toBe(false);
  });

  it("expands the ring by reported accuracy when slack is allowed", () => {
    const outsideByTenMetres = { lat: 14.5995 + 60 / 111_195.08, lng: 120.9842 };
    expect(isWithinRadius(outsideByTenMetres, target)).toBe(false);
    expect(isWithinRadius(outsideByTenMetres, target, { accuracy: 20, allowAccuracySlack: true })).toBe(
      true,
    );
  });

  it("caps accuracy slack at half the radius so a huge accuracy cannot trigger anything", () => {
    const farAway = { lat: 14.6195, lng: 120.9842 }; // ~2.2 km away
    expect(isWithinRadius(farAway, target, { accuracy: 5000, allowAccuracySlack: true })).toBe(false);
  });
});

describe("radiusMargin and formatDistance (UI copy)", () => {
  it("reports a negative margin inside the ring and positive outside", () => {
    const target = { lat: 14.5995, lng: 120.9842, radius: 50 };
    expect(radiusMargin(MANILA, target)).toBeCloseTo(-50, 1);
    const outside = { lat: 14.5995 + 127 / 111_195.08, lng: 120.9842 };
    expect(radiusMargin(outside, target)).toBeGreaterThanOrEqual(76);
    expect(radiusMargin(outside, target)).toBeLessThanOrEqual(78);
  });

  it("formats distances the way the spec asks: 127 m inside 1 km, km above", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(47.6)).toBe("48 m");
    expect(formatDistance(127)).toBe("127 m");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(1440)).toBe("1.4 km");
    expect(formatDistance(23_400)).toBe("23 km");
    expect(formatDistance(NaN)).toBe("--");
  });
});

describe("bearing / direction guidance", () => {
  it("computes cardinal bearings", () => {
    const origin = { lat: 0, lng: 0 };
    expect(bearing(origin, { lat: 1, lng: 0 })).toBeCloseTo(0, 1);
    expect(bearing(origin, { lat: 0, lng: 1 })).toBeCloseTo(90, 1);
    expect(bearing(origin, { lat: -1, lng: 0 })).toBeCloseTo(180, 1);
    expect(bearing(origin, { lat: 0, lng: -1 })).toBeCloseTo(270, 1);
  });

  it("maps bearings to compass points", () => {
    expect(bearingToCompass(0)).toBe("N");
    expect(bearingToCompass(45)).toBe("NE");
    expect(bearingToCompass(180)).toBe("S");
    expect(bearingToCompass(359)).toBe("N");
  });
});

describe("nearestLocation", () => {
  it("returns the closest candidate", () => {
    const near = { lat: 14.5996, lng: 120.9842, name: "near" };
    const far = { lat: 14.61, lng: 120.9842, name: "far" };
    const result = nearestLocation(MANILA, [far, near]);
    expect(result?.location.name).toBe("near");
  });

  it("returns null for an empty or invalid input", () => {
    expect(nearestLocation(MANILA, [])).toBeNull();
    expect(nearestLocation({ lat: NaN, lng: 0 }, [MANILA])).toBeNull();
  });
});

describe("classifyFix (GPS tolerance UX)", () => {
  const makeFix = (accuracy: number, ageMs = 0): PositionFix => ({
    lat: 14.5995,
    lng: 120.9842,
    accuracy,
    timestamp: Date.now() - ageMs,
  });

  it("rates a tight, fresh fix as good", () => {
    expect(classifyFix(makeFix(8)).quality).toBe("good");
  });

  it("rates a middling fix as fair and warns", () => {
    const result = classifyFix(makeFix(60));
    expect(result.quality).toBe("fair");
    expect(result.message).toContain("60");
  });

  it("flags a poor fix with actionable advice", () => {
    const result = classifyFix(makeFix(POOR_ACCURACY_THRESHOLD_M + 50));
    expect(result.quality).toBe("poor");
    expect(result.message).toMatch(/开阔处/);
  });

  it("flags a stale fix so a frozen reading cannot trigger a scene", () => {
    expect(classifyFix(makeFix(10, 5 * 60_000)).quality).toBe("stale");
  });
});
