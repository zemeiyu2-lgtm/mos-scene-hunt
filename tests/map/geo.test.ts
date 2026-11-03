import { describe, expect, it } from "vitest";

import { calculateDistance } from "@/lib/location";
import { boundsOf, circleRing, padBounds } from "@/lib/map/geo";

describe("circleRing", () => {
  it("produces a closed ring of [lng, lat] pairs", () => {
    const ring = circleRing(14.5995, 120.9842, 120, 32);
    expect(ring.length).toBe(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // GeoJSON order: longitude first.
    expect(ring[0][0]).toBeCloseTo(120.9842, 2);
  });

  it("approximates the requested radius in metres on the ground", () => {
    const center = { lat: 14.5995, lng: 120.9842 };
    const radius = 150;
    const ring = circleRing(center.lat, center.lng, radius, 64);
    for (const [lng, lat] of ring.slice(0, 16)) {
      const metres = calculateDistance(center, { lat, lng });
      // Equirectangular construction on a sphere: ±1% is well inside the
      // visual tolerance for a 150 m trigger circle.
      expect(metres).toBeGreaterThan(radius * 0.985);
      expect(metres).toBeLessThan(radius * 1.015);
    }
  });

  it("returns an empty ring for invalid input instead of throwing", () => {
    expect(circleRing(Number.NaN, 0, 100)).toEqual([]);
    expect(circleRing(14, 121, 0)).toEqual([]);
  });
});

describe("boundsOf / padBounds", () => {
  it("computes the bounding box of points", () => {
    const bounds = boundsOf([
      [120.9, 14.5],
      [121.0, 14.6],
      [120.95, 14.55],
    ]);
    expect(bounds).toEqual([
      [120.9, 14.5],
      [121.0, 14.6],
    ]);
  });

  it("returns null for no valid points", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([[Number.NaN, 14]])).toBeNull();
  });

  it("pads the box by roughly the requested metres", () => {
    const [min, max] = padBounds(
      [
        [120.9794, 14.5832],
        [120.9794, 14.5832],
      ],
      100,
    );
    const dLat = max[1] - min[1];
    expect(dLat).toBeGreaterThan(0.0017); // ~200 m / 111320 m per degree
    expect(dLat).toBeLessThan(0.0019);
  });
});
