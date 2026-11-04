/**
 * Geoapify raster tiles.
 *
 * Geoapify is the only vendor in this bench that needs an account key. The key
 * is read from `NEXT_PUBLIC_GEOAPIFY_KEY` at build time. What this module will
 * never do: ship a placeholder key, borrow a key found in a blog post, or
 * silently fall back to another provider when the key is missing. A missing key
 * is a *state the product must show*, not a state to paper over.
 *
 * Tile endpoint (raster, 256 px, XYZ):
 *   https://maps.geoapify.com/v1/tile/{style}/{z}/{x}/{y}.png?apiKey=KEY
 * Cost: 4 map tiles = 1 credit, 3,000 credits/day on the Free plan.
 */

import type { TileProvider } from "./tiles";

export type GeoapifyStyle = "osm-bright" | "osm-clean" | "positron" | "dark-matter" | "klokantech-basic";

export const GEOAPIFY_STYLES: Array<{ id: GeoapifyStyle; label: string }> = [
  { id: "osm-bright", label: "OSM Bright" },
  { id: "osm-clean", label: "OSM Clean（浅色）" },
  { id: "positron", label: "Positron（极简）" },
  { id: "dark-matter", label: "Dark Matter（深色）" },
  { id: "klokantech-basic", label: "Klokan Basic" },
];

export const GEOAPIFY_ATTRIBUTION =
  'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> ' +
  '| <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export interface GeoapifyConfig {
  key: string;
  style: GeoapifyStyle;
}

function readStyle(raw?: string | null): GeoapifyStyle {
  const value = (raw ?? "").trim().toLowerCase();
  const found = GEOAPIFY_STYLES.find((style) => style.id === value);
  return found ? found.id : "osm-bright";
}

/**
 * Build-time configuration. `null` means "no key configured", which the map
 * renders as an explicit blocked panel rather than as blank tiles.
 */
export function getGeoapifyConfig(
  keyRaw?: string | null,
  styleRaw?: string | null,
): GeoapifyConfig | null {
  const key = (keyRaw ?? "").trim();
  if (!key) return null;
  return { key, style: readStyle(styleRaw) };
}

export function geoapifyTileUrl(style: GeoapifyStyle, key: string): string {
  return `https://maps.geoapify.com/v1/tile/${style}/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(key)}`;
}

/** Leaflet tile provider descriptor for the configured Geoapify style. */
export function geoapifyProvider(config: GeoapifyConfig): TileProvider {
  return {
    id: "geoapify",
    url: geoapifyTileUrl(config.style, config.key),
    attribution: GEOAPIFY_ATTRIBUTION,
    // Geoapify raster tiles stop at z20; the game only asks for 17.
    maxZoom: 20,
    label: `Geoapify ${GEOAPIFY_STYLES.find((s) => s.id === config.style)?.label ?? config.style}`,
  };
}

/**
 * Classify a non-200 tile response.
 *
 * Geoapify answers 401 with a JSON body (`{"statusCode":401,"error":
 * "Unauthorized","message":"Invalid apiKey"}`) and 429 when the plan quota is
 * exhausted. Both are permanent for the session, so the UI must name the cause
 * instead of showing grey squares.
 */
export function classifyGeoapifyFailure(status: number, body?: string): string | null {
  const text = (body ?? "").toLowerCase();
  if (status === 401 || text.includes("invalid apikey") || text.includes("unauthorized")) {
    return "invalid-key";
  }
  if (status === 402 || status === 403) return "plan-restricted";
  if (status === 429 || text.includes("quota") || text.includes("limit")) return "quota-exceeded";
  if (status >= 500) return "service-error";
  return null;
}

export function describeGeoapifyBlock(reason: string | null): string {
  switch (reason) {
    case "missing-key":
      return "未配置 Geoapify Key。地图不会显示，也不会回退到其他供应商。";
    case "invalid-key":
      return "Geoapify 拒绝了当前 Key（401 Invalid apiKey）。请在控制台确认 Key 有效、且已激活 Map Tiles。";
    case "quota-exceeded":
      return "Geoapify 免费额度已用尽或被限流（429）。免费计划为 3,000 credits/天、5 请求/秒。";
    case "plan-restricted":
      return "当前 Geoapify 计划不允许该瓦片样式（402/403）。";
    case "service-error":
      return "Geoapify 服务端错误（5xx）。";
    case "network-error":
      return "无法连接 Geoapify 瓦片服务（网络错误或被拦截）。";
    default:
      return "Geoapify 地图当前不可用。";
  }
}
