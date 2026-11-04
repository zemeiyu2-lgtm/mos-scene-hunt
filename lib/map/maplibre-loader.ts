/**
 * MapLibre + PMTiles loader.
 *
 * Both `maplibre-gl` and `pmtiles` are browser-only (they touch `window` and
 * `document` at import time), so they are loaded through `import()` from an
 * effect rather than imported at module scope. That also keeps the Leaflet
 * production bundle free of ~800 KB of extra SDK when the engine is not opted
 * in: `map-view.tsx` never imports this file for the default build.
 *
 * PMTiles works over plain HTTP Range requests, so the archive needs no tile
 * server: `pmtiles` reads the directory, and MapLibre asks it for tiles. A
 * CDN that answers `Accept-Ranges: bytes` (Cloudflare R2, S3, Tigris) is
 * enough. This is verified, not assumed, in tests/map/pmtiles.test.ts.
 */

export type MaplibreModule = typeof import("maplibre-gl");

export type LoadResult =
  | { status: "ok"; maplibregl: MaplibreModule }
  | { status: "blocked"; reason: string };

let modulePromise: Promise<MaplibreModule> | null = null;
const registeredProtocols = new Set<string>();

export async function loadMaplibre(): Promise<LoadResult> {
  try {
    if (!modulePromise) modulePromise = import("maplibre-gl");
    const maplibregl = await modulePromise;
    return { status: "ok", maplibregl };
  } catch (error) {
    modulePromise = null;
    return { status: "blocked", reason: `sdk-load-failed:${String(error).slice(0, 120)}` };
  }
}

/**
 * Register a PMTiles archive with MapLibre. Idempotent per URL: MapLibre's
 * protocol registry is global, and registering the same scheme twice throws.
 *
 * The registration itself is pure bookkeeping — it never touches the network —
 * so a dead endpoint would otherwise surface as a silently blank map: the map
 * boots "ready" while every tile fetch fails late and quietly. The eager
 * Range probe converts that into a boot-time, classifiable failure.
 */
export async function registerPmtiles(maplibregl: MaplibreModule, url: string): Promise<void> {
  if (registeredProtocols.has(url)) return;
  const probe = await fetch(url, { headers: { Range: "bytes=0-16383" } });
  if (!probe.ok) {
    throw new Error(`pmtiles-unreachable: HTTP ${probe.status}`);
  }
  const { Protocol } = await import("pmtiles");
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  registeredProtocols.add(url);
}

/** Test seam: forget which protocols were registered. */
export function resetPmtilesRegistration(): void {
  registeredProtocols.clear();
  modulePromise = null;
}

export function describeMaplibreBlock(reason: string | null): string {
  if (!reason) return "";
  if (reason.startsWith("sdk-load-failed")) {
    return "MapLibre SDK 加载失败，请检查构建产物或网络。";
  }
  if (reason === "style-load-failed") {
    return "地图样式加载失败（样式 URL 或 PMTiles 端点不可达）。";
  }
  if (reason === "pmtiles-unreachable") {
    return "PMTiles 端点不可达或未返回 Range 响应，无法按需读取瓦片。";
  }
  return "地图引擎当前不可用。";
}
