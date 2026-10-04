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

export type TileProviderId = "osm" | "osm-hot" | "carto-voyager";

export interface TileProvider {
  id: TileProviderId;
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
