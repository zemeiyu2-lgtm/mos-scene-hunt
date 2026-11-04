"use client";

/**
 * Client-only map wrapper, and the single place where the engine is chosen.
 *
 * Every engine touches `window` at import time (Leaflet at module scope, AMap
 * by injecting a script, MapLibre by touching the DOM), so each is dynamically
 * imported with `ssr: false`.
 *
 * The engine comes from `NEXT_PUBLIC_MAP_ENGINE` (build time). Default is
 * Leaflet, so a build that does not opt in behaves exactly like production and
 * no vendor bundle is ever fetched.
 *
 * Outage fallback (vendor-bench acceptance): when the opted-in engine reports
 * `onEngineFailure`, this component swaps to the backup — MapLibre vendors and
 * Geoapify both fall back to the production Leaflet+OSM engine (Geoapify by
 * forcing its tiles to OSM in place). Game state lives outside the map, so the
 * swap is purely presentational.
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import type { GameMapProps } from "@/lib/map/map-contract";
import {
  MAP_ENGINE_LABEL,
  fallbackEngineFor,
  resolveMapEngine,
} from "@/lib/map/engine";

function MapLoading() {
  return (
    <div className="map-root grid place-items-center bg-[#e8eaef]">
      <div className="flex flex-col items-center gap-2">
        <div
          className="h-7 w-7 animate-spin rounded-full border-[3px] border-white border-t-[var(--accent)]"
          role="status"
          aria-label="正在加载地图"
        />
        <p className="text-[12px] text-slate-500">正在加载地图…</p>
      </div>
    </div>
  );
}

const LazyGameMap = dynamic(() => import("./game-map"), {
  ssr: false,
  loading: MapLoading,
});

const LazyMaplibreMap = dynamic(() => import("./maplibre-map"), {
  ssr: false,
  loading: MapLoading,
});

export function MapView(props: GameMapProps) {
  const engine = resolveMapEngine(process.env.NEXT_PUBLIC_MAP_ENGINE);
  const backup = fallbackEngineFor(engine);
  // Non-null once the primary engine announced it cannot paint; carries the
  // adapter's reason string for the banner and the report.
  const [outage, setOutage] = useState<string | null>(null);

  const onEngineFailure = (reason: string) => {
    setOutage((previous) => previous ?? reason);
  };

  const banner = outage ? (
    <div
      className="absolute inset-x-3 top-3 z-[1300] rounded-xl border border-[var(--ok-border)] bg-[var(--ok-bg)] p-3 text-[12px] leading-relaxed text-[var(--ok-text)] shadow-lg"
      data-testid="map-fallback-banner"
    >
      <p className="font-semibold">地图服务中断，已切换到备用方案</p>
      <p className="mt-1">
        主引擎 {MAP_ENGINE_LABEL[engine]} 不可用（{outage}），当前由{" "}
        {backup ? MAP_ENGINE_LABEL[backup] : "备用瓦片源"} 接管。游戏进度与定位状态不受影响。
      </p>
    </div>
  ) : null;

  if (engine === "openfreemap" || engine === "protomaps") {
    if (outage && backup === "leaflet") {
      // Key change forces a clean remount on the backup engine.
      return (
        <div className="relative h-full w-full" data-map-fallback="leaflet">
          {banner}
          <LazyGameMap key="fallback-leaflet" {...props} onEngineFailure={onEngineFailure} />
        </div>
      );
    }
    return (
      <div className="relative h-full w-full">
        {banner}
        <LazyMaplibreMap {...props} onEngineFailure={onEngineFailure} />
      </div>
    );
  }

  if (engine === "amap") {
    // The AMap adapter lives on `test/amap-world-map`; this branch must not
    // pretend it can paint. Saying so is better than silently rendering OSM and
    // invalidating a comparison screenshot.
    return (
      <div className="map-root grid place-items-center bg-[#e8eaef] p-6">
        <p className="max-w-sm text-center text-[12px] leading-relaxed text-slate-600">
          当前构建选择了高德引擎，但本分支未包含高德适配器。请使用
          <code className="mx-1 rounded bg-white px-1">test/amap-world-map</code>
          分支进行高德测试。
        </p>
      </div>
    );
  }

  // Leaflet renderer: the production engine (and the backup). A Geoapify
  // opt-in build falls back in place by forcing its tiles to OSM.
  const forceProvider = outage ? ("osm" as const) : null;
  return (
    <div className="relative h-full w-full" data-map-fallback={outage ? "osm" : undefined}>
      {banner}
      <LazyGameMap
        key={outage ? "forced-osm" : "primary"}
        {...props}
        forceProvider={forceProvider}
        onEngineFailure={onEngineFailure}
      />
    </div>
  );
}

export type { GameMapProps };
// NOTE: tile provider metadata is intentionally NOT re-exported here. This module
// is imported by server components during prerender, and re-exporting from
// `game-map` would pull Leaflet (which touches `window` at import time) back into
// the server bundle. Import from `@/lib/map/tiles` instead.
