/**
 * Map tile providers.
 *
 * Deliberately in its own module, free of any Leaflet import.
 *
 * `game-map.tsx` imports `leaflet`, which touches `window` at module scope and
 * therefore cannot be evaluated on the server. Screens and settings still need
 * the provider list, so it lives here rather than being re-exported from the map
 * module - a re-export would drag Leaflet back into the server bundle and break
 * static prerendering.
 */

import { geoapifyProvider, getGeoapifyConfig } from "./geoapify";

export type TileProviderId = "osm" | "osm-hot" | "carto-voyager";

export interface TileProvider {
  id: TileProviderId | "geoapify";
  url: string;
  attribution: string;
  maxZoom: number;
  label: string;
}

export const TILE_PROVIDERS: Record<TileProviderId, TileProvider> = {
  osm: {
    id: "osm",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    label: "OpenStreetMap 标准",
  },
  "osm-hot": {
    id: "osm-hot",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/">HOT</a>',
    maxZoom: 20,
    label: "OpenStreetMap HOT（高对比）",
  },
  "carto-voyager": {
    id: "carto-voyager",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    label: "CARTO Voyager",
  },
};

export const TILE_PROVIDER_LIST = Object.values(TILE_PROVIDERS);

/**
 * Resolve the tile layer the Leaflet engine should actually paint.
 *
 * Geoapify is a *vendor switch*, not a user-facing style: when the build opts
 * into it, the vendor's raster tiles replace the OSM/CARTO layer wholesale and
 * the in-app provider preference is ignored. Returning an explicit `blocked`
 * reason keeps a missing key visible instead of silently dropping back to OSM —
 * a fallback would make the cost/compliance comparison meaningless.
 */
export function resolveActiveTiles(
  preferred: TileProviderId,
  env: { engine?: string | null; key?: string | null; style?: string | null } = {},
): { provider: TileProvider; blocked: string | null } {
  const engine = (env.engine ?? process.env.NEXT_PUBLIC_MAP_ENGINE ?? "").trim().toLowerCase();
  if (engine === "geoapify") {
    const config = getGeoapifyConfig(
      env.key ?? process.env.NEXT_PUBLIC_GEOAPIFY_KEY,
      env.style ?? process.env.NEXT_PUBLIC_GEOAPIFY_STYLE,
    );
    if (!config) {
      return {
        provider: TILE_PROVIDERS[preferred] ?? TILE_PROVIDERS["osm-hot"],
        blocked: "missing-key",
      };
    }
    return { provider: geoapifyProvider(config), blocked: null };
  }
  return { provider: TILE_PROVIDERS[preferred] ?? TILE_PROVIDERS["osm-hot"], blocked: null };
}
