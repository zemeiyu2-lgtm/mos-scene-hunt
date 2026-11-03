import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAP_ENGINE,
  MAP_ENGINE_LABEL,
  engineRenderer,
  resolveMapEngine,
} from "@/lib/map/engine";
import { resolveActiveTiles } from "@/lib/map/tiles";

describe("resolveMapEngine", () => {
  it("defaults to the production engine", () => {
    expect(DEFAULT_MAP_ENGINE).toBe("leaflet");
    expect(resolveMapEngine(undefined)).toBe("leaflet");
    expect(resolveMapEngine(null)).toBe("leaflet");
    expect(resolveMapEngine("")).toBe("leaflet");
    expect(resolveMapEngine("unknown-vendor")).toBe("leaflet");
  });

  it("accepts every bench vendor and its aliases", () => {
    expect(resolveMapEngine("openfreemap")).toBe("openfreemap");
    expect(resolveMapEngine("ofm")).toBe("openfreemap");
    expect(resolveMapEngine("maplibre")).toBe("openfreemap");
    expect(resolveMapEngine("protomaps")).toBe("protomaps");
    expect(resolveMapEngine("pmtiles")).toBe("protomaps");
    expect(resolveMapEngine("geoapify")).toBe("geoapify");
    expect(resolveMapEngine("amap")).toBe("amap");
  });

  it("is case and whitespace insensitive", () => {
    expect(resolveMapEngine("  OpenFreeMap ")).toBe("openfreemap");
    expect(resolveMapEngine("PROTOMAPS")).toBe("protomaps");
  });

  it("routes vendors to the right renderer", () => {
    expect(engineRenderer("leaflet")).toBe("leaflet");
    expect(engineRenderer("geoapify")).toBe("leaflet");
    expect(engineRenderer("amap")).toBe("amap");
    expect(engineRenderer("openfreemap")).toBe("maplibre");
    expect(engineRenderer("protomaps")).toBe("maplibre");
  });

  it("labels every engine (report uses these verbatim)", () => {
    for (const engine of Object.keys(MAP_ENGINE_LABEL)) {
      expect(MAP_ENGINE_LABEL[engine as keyof typeof MAP_ENGINE_LABEL].length).toBeGreaterThan(0);
    }
  });
});

describe("resolveActiveTiles", () => {
  it("keeps production behaviour when no engine is configured", () => {
    const { provider, blocked } = resolveActiveTiles("carto-voyager", { engine: "" });
    expect(blocked).toBeNull();
    expect(provider.id).toBe("carto-voyager");
  });

  it("falls back to osm-hot for an unknown provider id", () => {
    const { provider, blocked } = resolveActiveTiles("does-not-exist" as never, { engine: "" });
    expect(blocked).toBeNull();
    expect(provider.id).toBe("osm-hot");
  });

  it("blocks Geoapify explicitly when the key is missing", () => {
    const { provider, blocked } = resolveActiveTiles("osm", {
      engine: "geoapify",
      key: "  ",
    });
    expect(blocked).toBe("missing-key");
    // The fallback provider paints OSM, but the component must surface the
    // blocked panel; the silent-fallback outcome is the bug this test pins.
    expect(provider.id).toBe("osm");
  });

  it("builds the Geoapify raster URL with the configured style", () => {
    const { provider, blocked } = resolveActiveTiles("osm", {
      engine: "geoapify",
      key: "test-key-123",
      style: "positron",
    });
    expect(blocked).toBeNull();
    expect(provider.id).toBe("geoapify");
    expect(provider.url).toBe(
      "https://maps.geoapify.com/v1/tile/positron/{z}/{x}/{y}.png?apiKey=test-key-123",
    );
    expect(provider.attribution).toContain("Geoapify");
    expect(provider.maxZoom).toBeGreaterThanOrEqual(17);
  });
});
