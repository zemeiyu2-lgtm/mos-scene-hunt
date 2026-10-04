"use client";

/**
 * Client-only wrapper around the Leaflet map.
 *
 * Leaflet touches `window` at import time, and `next/dynamic` with
 * `ssr: false` is the sanctioned escape hatch. Keeping the dynamic import in its
 * own module means screens can import `MapView` normally and stay clean.
 */

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type GameMap from "./game-map";

type GameMapProps = ComponentProps<typeof GameMap>;

const LazyGameMap = dynamic(() => import("./game-map"), {
  ssr: false,
  loading: () => (
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
  ),
});

export function MapView(props: GameMapProps) {
  return <LazyGameMap {...props} />;
}

export type { GameMapProps };
// NOTE: tile provider metadata is intentionally NOT re-exported here. This module
// is imported by server components during prerender, and re-exporting from
// `game-map` would pull Leaflet (which touches `window` at import time) back into
// the server bundle. Import from `@/lib/map/tiles` instead.
