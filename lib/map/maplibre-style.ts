/**
 * MapLibre style construction for the two vector vendors.
 *
 * OpenFreeMap: a hosted, no-key public instance. We consume their published
 * style URL verbatim — copying their style JSON into this repo would mean we
 * own a fork we cannot keep current, and OpenFreeMap restyles on their side.
 *
 * Protomaps: the basemap ships as one PMTiles archive and *no* style. The
 * official `@protomaps/basemaps` package generates the layer stack from the
 * archive's own schema, which is why it is a dependency rather than a
 * hand-written 500-line JSON we would have to keep in sync with v4 → v5.
 *
 * Both paths return a WGS84 (EPSG:3857 / web-mercator) style. Neither path
 * touches any game coordinate.
 */

import type { StyleSpecification } from "maplibre-gl";
import { layers, namedFlavor } from "@protomaps/basemaps";

export type OpenFreeMapStyle = "liberty" | "bright" | "positron" | "dark" | "fiord";

export const OPENFREEMAP_STYLES: Array<{ id: OpenFreeMapStyle; label: string }> = [
  { id: "liberty", label: "Liberty（信息均衡）" },
  { id: "bright", label: "Bright（高对比）" },
  { id: "positron", label: "Positron（极简浅色）" },
  { id: "dark", label: "Dark" },
  { id: "fiord", label: "Fiord（深蓝）" },
];

export const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export const PROTOMAPS_ATTRIBUTION =
  '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> · ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** Public daily build. Hotlinking is discouraged by Protomaps; see the report. */
export const DEFAULT_PMTILES_URL = "https://latest.protomaps.com/v4.pmtiles";

export const PROTOMAPS_GLYPHS =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
export const PROTOMAPS_SPRITE = "https://protomaps.github.io/basemaps-assets/sprites/v4/light";

export type ProtomapsFlavor = "light" | "dark" | "white" | "grayscale" | "black";

export interface StyleRequest {
  engine: "openfreemap" | "protomaps";
  /** OpenFreeMap style id; ignored for Protomaps. */
  openfreemapStyle?: string | null;
  /** PMTiles endpoint; defaults to the public daily build. */
  pmtilesUrl?: string | null;
  /** Protomaps flavour; ignored for OpenFreeMap. */
  flavor?: string | null;
  /** Label language. `en` is the international default. */
  language?: string | null;
}

export interface ResolvedStyle {
  /** Either a style URL (OpenFreeMap) or an inline spec (Protomaps). */
  style: string | StyleSpecification;
  /** True when the style must be fetched before MapLibre can render. */
  remote: boolean;
  attribution: string;
  /** Echoed into metrics so a screenshot can be matched to its source. */
  label: string;
}

export function resolveOpenFreeMapStyle(raw?: string | null): OpenFreeMapStyle {
  const value = (raw ?? "").trim().toLowerCase();
  return OPENFREEMAP_STYLES.find((style) => style.id === value)?.id ?? "liberty";
}

export function resolveProtomapsFlavor(raw?: string | null): ProtomapsFlavor {
  const value = (raw ?? "").trim().toLowerCase();
  const allowed: ProtomapsFlavor[] = ["light", "dark", "white", "grayscale", "black"];
  return (allowed as string[]).includes(value) ? (value as ProtomapsFlavor) : "light";
}

export function resolvePmtilesUrl(raw?: string | null): string {
  const value = (raw ?? "").trim();
  return value || DEFAULT_PMTILES_URL;
}

/** True when the endpoint is the shared public build rather than self-hosted. */
export function isPublicPmtiles(url: string): boolean {
  return /^https:\/\/(latest\.protomaps\.com|build\.protomaps\.com)\//i.test(url);
}

export function buildProtomapsStyle(
  pmtilesUrl: string,
  flavor: ProtomapsFlavor = "light",
  language = "en",
): StyleSpecification {
  return {
    version: 8,
    glyphs: PROTOMAPS_GLYPHS,
    sprite: PROTOMAPS_SPRITE,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        attribution: PROTOMAPS_ATTRIBUTION,
      },
    },
    // v5 API: `layers(source, flavorObject, { lang })`. Passing the flavour name
    // as a string is the v4 signature and silently produces an empty palette.
    layers: layers("protomaps", namedFlavor(flavor), { lang: language }) as StyleSpecification["layers"],
  };
}

export function resolveStyle(request: StyleRequest): ResolvedStyle {
  if (request.engine === "openfreemap") {
    const id = resolveOpenFreeMapStyle(request.openfreemapStyle);
    return {
      style: `https://tiles.openfreemap.org/styles/${id}`,
      remote: true,
      attribution: OPENFREEMAP_ATTRIBUTION,
      label: `openfreemap:${id}`,
    };
  }
  const url = resolvePmtilesUrl(request.pmtilesUrl);
  const flavor = resolveProtomapsFlavor(request.flavor);
  return {
    style: buildProtomapsStyle(url, flavor, (request.language ?? "en").trim() || "en"),
    remote: false,
    attribution: PROTOMAPS_ATTRIBUTION,
    label: `protomaps:${flavor}${isPublicPmtiles(url) ? ":public-build" : ":self-hosted"}`,
  };
}
