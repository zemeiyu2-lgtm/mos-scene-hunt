/**
 * Map engine contract.
 *
 * Every engine (Leaflet/OSM, AMap world, MapLibre/OpenFreeMap,
 * MapLibre/Protomaps, Leaflet/Geoapify) implements exactly this contract.
 * Nothing here may import a map SDK: the type module is pulled into server
 * components during prerender, and every SDK in this repo touches `window` at
 * import time.
 *
 * Rule enforced by this file: the engines may differ in *how* they paint, never
 * in *what* they are given. Every coordinate crossing this boundary is WGS84
 * decimal degrees straight from the game data / GPS fix. No engine is allowed
 * to hand a projected or display-datum coordinate back to the game.
 */

import type { SceneStatus } from "@/lib/game/state";
import type { HuntArea, Scene } from "@/lib/game/types";
import type { PositionFix } from "@/lib/location";
import type { TileHealth } from "./tile-health";

/** A scene rendered on the map, with everything the marker needs precomputed. */
export interface MapSceneEntry {
  scene: Scene;
  status: SceneStatus;
  isActive: boolean;
  distance: number | null;
  inRange: boolean;
}

export interface GameMapProps {
  player: PositionFix | null;
  entries: MapSceneEntry[];
  huntArea?: HuntArea;
  tileProvider: "osm" | "osm-hot" | "carto-voyager";
  /** Called when the developer drags the simulated player marker. */
  onSimulatedDrag?: (lat: number, lng: number) => void;
  /** When true, the player marker is draggable (simulator only). */
  draggablePlayer?: boolean;
  /** Fit the view to the imported game's valid scene coordinates and play area. */
  fitToHunt?: boolean;
  /**
   * Bump to re-run the fit explicitly (e.g. a "重置视野" button). Regular
   * re-renders, scene edits and selection changes never re-fit on their own —
   * the designer owns the viewport once the first fit has happened.
   */
  fitToken?: number;
  /** Start location from the active game package; used when scene coordinates are placeholders. */
  mapCenter?: { lat: number; lng: number };
  /** Re-centre on the player when this value changes. */
  recenterToken?: number;
  /** Device compass heading in degrees clockwise from north; null until available. */
  heading?: number | null;
  /** Optional authoring interactions. Gameplay never supplies these. */
  editable?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  onSceneDrag?: (sceneId: string, lat: number, lng: number) => void;
  /** Called when an author taps a scene marker to select that scene. */
  onSceneSelect?: (sceneId: string) => void;
  onHuntAreaDrag?: (lat: number, lng: number) => void;
  /**
   * True while the designer is actively drawing a polygon boundary. Switches
   * the cursor to a crosshair, shows numbered vertex dots for the points
   * placed so far, and shows the "依次点击边界点" guidance overlay.
   */
  drawingMode?: boolean;
  /**
   * Outage-acceptance hook: the adapter calls it exactly once when it concludes
   * it cannot paint (SDK load failure, style never loads, vendor key rejected).
   * `MapView` uses it to switch to the backup engine. Null-reason callers are
   * not expected; any truthy reason triggers the swap.
   */
  onEngineFailure?: (reason: string) => void;
  /**
   * Runtime tile override for the Leaflet renderer (outage fallback for the
   * Geoapify engine): when non-null it replaces the resolved provider without
   * a rebuild. Ignored by non-Leaflet adapters.
   */
  forceProvider?: "osm" | "osm-hot" | "carto-voyager" | null;
  /**
   * B-03: bumped by the screen to rebuild the Leaflet tile layer after a
   * failed load (Leaflet's tile cache keeps the failed URLs otherwise).
   * Ignored by non-Leaflet adapters.
   */
  tileRetryToken?: number;
  /**
   * B-03: reports raster tile health (loading/ok/failed) so the screen can
   * offer a retry. Ignored by non-Leaflet adapters.
   */
  onTileHealthChange?: (health: TileHealth) => void;
}

/** Identifies which SDK actually painted, for probes and reports. */
export type MapRuntimeId =
  | "leaflet"
  | "amap"
  | "maplibre-openfreemap"
  | "maplibre-protomaps"
  | "leaflet-geoapify";

/** Shared runtime metrics, so probes can compare engines without SDK access. */
export interface MapLoadMetrics {
  engine: MapRuntimeId;
  /** Milliseconds from component mount to the engine reporting "ready". */
  readyMs: number | null;
  /** Milliseconds from mount to the first `idle` (steady) frame, engines that report it. */
  idleMs: number | null;
  /** Number of tile/image requests that failed after the engine was ready. */
  tileErrors: number;
  /** Number of console errors / script load failures observed during boot. */
  bootErrors: string[];
  /** Set when the engine could not start at all. */
  blocked: string | null;
  /** Last observed zoom (single element), kept for probe assertions. */
  zooms: number[];
}

declare global {
  interface Window {
    __mosMapEngine?: MapRuntimeId;
    __mosMapMetrics?: MapLoadMetrics;
    /** Narrow view of the live map instance, enough for probes to drive it. */
    __mosMap?: {
      getZoom(): number;
      getCenter(): { lat: number; lng: number };
      jumpTo(options: { center?: [number, number]; zoom?: number }): void;
    };
  }
}
