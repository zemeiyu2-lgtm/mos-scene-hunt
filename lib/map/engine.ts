/**
 * Map engine / vendor selection.
 *
 * The engine is chosen at build time from `NEXT_PUBLIC_MAP_ENGINE`. Default is
 * `leaflet` — i.e. the current production behaviour — so any environment that
 * does not opt in keeps rendering exactly what it renders today. That property
 * is what makes this test branch non-invasive: there is no runtime vendor flag
 * to flip, and production never sets the variable.
 *
 * This module must stay SDK-free. It is imported by `map-view.tsx`, which the
 * server evaluates during prerender.
 */

export type MapEngineId = "leaflet" | "amap" | "openfreemap" | "protomaps" | "geoapify";

// Diagnostic rebuilds (preview acceptance) change this file's tree so the
// build cache cannot reuse a bundle inlined with a different engine value.
export const DEFAULT_MAP_ENGINE: MapEngineId = "leaflet";

/** Values accepted for `NEXT_PUBLIC_MAP_ENGINE`, including friendly aliases. */
export function resolveMapEngine(raw?: string | null): MapEngineId {
  const value = (raw ?? "").trim().toLowerCase();
  switch (value) {
    case "amap":
    case "amap-world":
    case "gaode":
      return "amap";
    case "openfreemap":
    case "ofm":
    case "maplibre":
      return "openfreemap";
    case "protomaps":
    case "pmtiles":
      return "protomaps";
    case "geoapify":
      return "geoapify";
    default:
      return DEFAULT_MAP_ENGINE;
  }
}

/** Which renderer a given engine choice runs on. */
export function engineRenderer(engine: MapEngineId): "leaflet" | "amap" | "maplibre" {
  if (engine === "amap") return "amap";
  if (engine === "openfreemap" || engine === "protomaps") return "maplibre";
  return "leaflet";
}

/**
 * The backup engine a primary switches to when it fails at runtime
 * (outage-acceptance scenario). MapLibre vendors fall back to the current
 * production Leaflet+OSM engine; Geoapify keeps the Leaflet renderer but its
 * tiles are forced to plain OSM via `forceProvider`. The Leaflet engine itself
 * has no further fallback — null means "already the backup".
 */
export function fallbackEngineFor(engine: MapEngineId): MapEngineId | null {
  if (engine === "openfreemap" || engine === "protomaps" || engine === "geoapify") {
    return "leaflet";
  }
  return null;
}

export const MAP_ENGINE_LABEL: Record<MapEngineId, string> = {
  leaflet: "Leaflet + OpenStreetMap（现网）",
  amap: "AMap JS API 2.0（世界地图）",
  openfreemap: "MapLibre + OpenFreeMap（Liberty）",
  protomaps: "MapLibre + Protomaps（PMTiles 自托管数据）",
  geoapify: "Leaflet + Geoapify 栅格瓦片",
};
