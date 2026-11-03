import { describe, expect, it } from "vitest";

import {
  MAP_ENGINE_LABEL,
  fallbackEngineFor,
  resolveMapEngine,
} from "@/lib/map/engine";
import { TILE_PROVIDERS, resolveActiveTiles } from "@/lib/map/tiles";

describe("map engine outage fallback", () => {
  it("falls back to the production Leaflet engine from every vector vendor", () => {
    expect(fallbackEngineFor("openfreemap")).toBe("leaflet");
    expect(fallbackEngineFor("protomaps")).toBe("leaflet");
    expect(fallbackEngineFor("geoapify")).toBe("leaflet");
  });

  it("has no fallback beyond the Leaflet engine itself", () => {
    expect(fallbackEngineFor("leaflet")).toBeNull();
    expect(fallbackEngineFor("amap")).toBeNull();
  });

  it("keeps the backup engine inside the known engine set with a label", () => {
    for (const engine of ["openfreemap", "protomaps", "geoapify"] as const) {
      const backup = fallbackEngineFor(engine);
      expect(backup).not.toBeNull();
      expect(MAP_ENGINE_LABEL[backup as keyof typeof MAP_ENGINE_LABEL]).toBeTruthy();
    }
  });

  it("resolveMapEngine still maps vendor aliases (fallback operates on resolved ids)", () => {
    expect(resolveMapEngine("ofm")).toBe("openfreemap");
    expect(resolveMapEngine("pmtiles")).toBe("protomaps");
    expect(resolveMapEngine("geoapify")).toBe("geoapify");
    expect(resolveMapEngine("")).toBe("leaflet");
  });
});

describe("forced tile provider (geoapify outage fallback)", () => {
  it("a forced provider replaces the geoapify vendor and clears the block", () => {
    // Without force: an opt-in build without a key is blocked.
    const blocked = resolveActiveTiles("osm", { engine: "geoapify", key: "" });
    expect(blocked.blocked).toBe("missing-key");
    // With force: MapView swaps the tiles to plain OSM at runtime.
    // (game-map reads TILE_PROVIDERS[forceProvider] directly; the descriptor
    // must be complete so a swap never paints an empty layer.)
    const forced = TILE_PROVIDERS["osm"];
    expect(forced.url).toContain("openstreetmap.org");
    expect(forced.attribution).toContain("OpenStreetMap");
    expect(forced.maxZoom).toBeGreaterThanOrEqual(19);
  });

  it("does not touch the production default resolution", () => {
    const plain = resolveActiveTiles("osm");
    expect(plain.blocked).toBeNull();
    expect(plain.provider.id).toBe("osm");
  });
});
