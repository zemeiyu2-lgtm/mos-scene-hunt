import { describe, expect, it } from "vitest";
import {
  calculateDistance,
  isPointInPolygon,
  polygonBoundingRadius,
  polygonCentroid,
} from "../../lib/location/geodesy";

/**
 * Polygon authoring geometry.
 *
 * The design screen draws the play area from map clicks, so this math decides
 * where the area is centred, how big it is, and whether a placed scene falls
 * inside. It is pure and cheap to test, so the map click flow stays thin.
 */

// A ~100m square in Rizal Park, roughly matching a real micro-hunt.
const SQUARE = [
  { lat: 14.5832, lng: 120.979 },
  { lat: 14.5832, lng: 120.98 },
  { lat: 14.5822, lng: 120.98 },
  { lat: 14.5822, lng: 120.979 },
];

describe("polygonCentroid", () => {
  it("averages the vertices", () => {
    const c = polygonCentroid(SQUARE);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(14.5827, 6);
    expect(c!.lng).toBeCloseTo(120.9795, 6);
  });

  it("ignores a repeated closing point so it does not bias the centre", () => {
    const closed = [...SQUARE, SQUARE[0]];
    const open = polygonCentroid(SQUARE);
    const withClose = polygonCentroid(closed);
    expect(withClose!.lat).toBeCloseTo(open!.lat, 9);
    expect(withClose!.lng).toBeCloseTo(open!.lng, 9);
  });

  it("returns null for an empty ring", () => {
    expect(polygonCentroid([])).toBeNull();
  });

  it("drops invalid coordinates instead of producing NaN", () => {
    const c = polygonCentroid([{ lat: 1, lng: 1 }, { lat: NaN, lng: 2 } as never]);
    expect(c!.lat).toBe(1);
    expect(c!.lng).toBe(1);
  });
});

describe("polygonBoundingRadius", () => {
  it("reaches every vertex, so a scene on a corner is still covered", () => {
    const center = polygonCentroid(SQUARE)!;
    const radius = polygonBoundingRadius(SQUARE);
    for (const p of SQUARE) {
      expect(calculateDistance(center, p)).toBeLessThanOrEqual(radius + 0.01);
    }
  });

  it("is roughly half the diagonal for a square", () => {
    // ~100m sides -> diagonal ~141m -> radius ~71m.
    const radius = polygonBoundingRadius(SQUARE);
    expect(radius).toBeGreaterThan(60);
    expect(radius).toBeLessThan(85);
  });

  it("is 0 when there is nothing to bound", () => {
    expect(polygonBoundingRadius([])).toBe(0);
  });
});

describe("isPointInPolygon", () => {
  it("accepts a point inside", () => {
    expect(isPointInPolygon({ lat: 14.5827, lng: 120.9795 }, SQUARE)).toBe(true);
  });

  it("rejects a point outside", () => {
    expect(isPointInPolygon({ lat: 14.59, lng: 120.99 }, SQUARE)).toBe(false);
  });

  it("rejects a point that is outside on one axis only", () => {
    // Same latitude band, but east of the ring.
    expect(isPointInPolygon({ lat: 14.5827, lng: 120.981 }, SQUARE)).toBe(false);
  });

  it("handles a concave ring (the L-shape a hand-drawn area produces)", () => {
    // An L: the notch at (2,2)-(4,4) is outside.
    const lShape = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 4 },
      { lat: 2, lng: 4 },
      { lat: 2, lng: 2 },
      { lat: 4, lng: 2 },
      { lat: 4, lng: 0 },
    ];
    expect(isPointInPolygon({ lat: 1, lng: 1 }, lShape)).toBe(true);
    expect(isPointInPolygon({ lat: 3, lng: 3 }, lShape)).toBe(false);
  });

  it("returns false for a degenerate ring", () => {
    expect(isPointInPolygon({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toBe(
      false,
    );
  });
});
