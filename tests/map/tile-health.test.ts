/**
 * Raster tile health rules (lib/map/tile-health.ts, B-03 / B-02 UX-07).
 *
 * Leaflet shows a failed basemap as plain grey squares and reports nothing, so
 * the player cannot tell "still loading" from "no network". The thresholds here
 * are the difference between a helpful banner and a false alarm on a train.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_TILE_RULES, evaluateTileHealth, nextTileProvider } from "@/lib/map/tile-health";

describe("evaluateTileHealth", () => {
  it("stays 'loading' while tiles are arriving", () => {
    expect(evaluateTileHealth({ loaded: 0, errors: 0, elapsedMs: 500 })).toBe("loading");
    expect(evaluateTileHealth({ loaded: 0, errors: 1, elapsedMs: 1_000 })).toBe("loading");
  });

  it("any successful tile means the layer works, even with errors elsewhere", () => {
    expect(evaluateTileHealth({ loaded: 1, errors: 12, elapsedMs: 30_000 })).toBe("ok");
  });

  it("a burst of errors with nothing rendered fails fast", () => {
    expect(
      evaluateTileHealth({ loaded: 0, errors: DEFAULT_TILE_RULES.errorThreshold, elapsedMs: 5_000 }),
    ).toBe("failed");
  });

  it("does not fail on a single error inside the observation window", () => {
    expect(evaluateTileHealth({ loaded: 0, errors: 1, elapsedMs: 4_500 })).toBe("loading");
  });

  it("a few errors that never recover fail once the grace period ends", () => {
    expect(evaluateTileHealth({ loaded: 0, errors: 2, elapsedMs: 11_999 })).toBe("loading");
    expect(evaluateTileHealth({ loaded: 0, errors: 2, elapsedMs: 12_000 })).toBe("failed");
  });

  it("a silent layer (no events at all) is never declared failed by this rule", () => {
    // Silence is the watchdog's business, not the tile layer's: claiming the
    // basemap is broken because nothing has been requested yet would be a lie.
    expect(evaluateTileHealth({ loaded: 0, errors: 0, elapsedMs: 60_000 })).toBe("loading");
  });

  it("honours custom rules", () => {
    const rules = { errorThreshold: 2, errorGraceMs: 3_000, minObservationMs: 1_000 };
    expect(evaluateTileHealth({ loaded: 0, errors: 2, elapsedMs: 1_500 }, rules)).toBe("failed");
    expect(evaluateTileHealth({ loaded: 0, errors: 1, elapsedMs: 3_000 }, rules)).toBe("failed");
  });
});

describe("nextTileProvider", () => {
  const ids = ["osm", "osm-hot", "carto-voyager"] as const;

  it("cycles through the provider list", () => {
    expect(nextTileProvider(ids, "osm")).toBe("osm-hot");
    expect(nextTileProvider(ids, "osm-hot")).toBe("carto-voyager");
    expect(nextTileProvider(ids, "carto-voyager")).toBe("osm");
  });

  it("falls back to the first provider for an unknown id", () => {
    expect(nextTileProvider(ids, "nope" as (typeof ids)[number])).toBe("osm");
  });
});
