import { describe, expect, it } from "vitest";
import { TILE_PROVIDERS, TILE_PROVIDER_LIST } from "../../lib/map/tiles";

describe("map tile configuration", () => {
  it("uses the official OSM standard tile endpoint", () => {
    expect(TILE_PROVIDERS.osm.url).toBe(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    );
  });

  it("includes readable OSM attribution and a supported zoom level", () => {
    expect(TILE_PROVIDERS.osm.attribution).toContain("openstreetmap.org/copyright");
    expect(TILE_PROVIDERS.osm.attribution).toContain("contributors");
    expect(TILE_PROVIDERS.osm.maxZoom).toBe(19);
  });

  it("keeps provider configuration centralized for future replacement", () => {
    expect(TILE_PROVIDER_LIST).toContainEqual(TILE_PROVIDERS.osm);
    expect(new Set(TILE_PROVIDER_LIST.map((provider) => provider.id)).size).toBe(
      TILE_PROVIDER_LIST.length,
    );
  });
});
