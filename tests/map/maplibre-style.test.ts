import { describe, expect, it } from "vitest";

import {
  DEFAULT_PMTILES_URL,
  buildProtomapsStyle,
  isPublicPmtiles,
  resolveOpenFreeMapStyle,
  resolvePmtilesUrl,
  resolveProtomapsFlavor,
  resolveStyle,
} from "@/lib/map/maplibre-style";

describe("OpenFreeMap styles", () => {
  it("resolves to the hosted style URL, no key involved", () => {
    const style = resolveStyle({ engine: "openfreemap" });
    expect(style.remote).toBe(true);
    expect(style.style).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(style.attribution).toContain("OpenStreetMap");
  });

  it("honours the style override and rejects unknown values", () => {
    expect(resolveOpenFreeMapStyle("bright")).toBe("bright");
    expect(resolveOpenFreeMapStyle("not-a-style")).toBe("liberty");
  });
});

describe("Protomaps styles", () => {
  it("builds an inline style from the PMTiles archive", () => {
    const spec = buildProtomapsStyle("https://example.com/planet.pmtiles", "light", "en");
    expect(spec.version).toBe(8);
    const source = spec.sources.protomaps as { url: string; type: string };
    expect(source.type).toBe("vector");
    expect(source.url).toBe("pmtiles://https://example.com/planet.pmtiles");
    expect(spec.layers.length).toBeGreaterThan(30);
    expect(spec.glyphs).toContain("{fontstack}");
  });

  it("uses the official flavour names, not raw strings", () => {
    // The v5 `layers()` API takes a flavour *object*; passing the string "light"
    // would silently produce an empty palette. This is the regression pin.
    const dark = buildProtomapsStyle(DEFAULT_PMTILES_URL, "dark", "en");
    const light = buildProtomapsStyle(DEFAULT_PMTILES_URL, "light", "en");
    const darkIds = dark.layers.map((layer) => layer.id).sort();
    const lightIds = light.layers.map((layer) => layer.id).sort();
    expect(darkIds).toEqual(lightIds);
    expect(lightIds).toContain("background");
    expect(resolveProtomapsFlavor("nonsense")).toBe("light");
  });

  it("flags the shared public build as hotlinked", () => {
    expect(isPublicPmtiles(resolvePmtilesUrl(null))).toBe(true);
    expect(isPublicPmtiles("https://cdn.example.com/tiles/planet.pmtiles")).toBe(false);
    expect(resolvePmtilesUrl("  ")).toBe(DEFAULT_PMTILES_URL);
  });

  it("resolves through the unified entrypoint", () => {
    const style = resolveStyle({ engine: "protomaps" });
    expect(style.remote).toBe(false);
    expect(style.label).toBe("protomaps:light:public-build");
  });
});
