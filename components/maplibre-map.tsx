"use client";

/**
 * MapLibre engine — serves both vector vendors behind one adapter.
 *
 * OpenFreeMap and Protomaps differ only in *where the style comes from*
 * (hosted style URL vs. generated from a PMTiles archive); every game overlay
 * is identical, so they share this component and swap `resolveStyle()`.
 *
 * Contract: same props as `game-map.tsx`, same coordinate meaning (WGS84 in,
 * WGS84 out), same DOM hooks (`data-role="scene-marker"`,
 * `data-role="player-marker"`). The only thing that differs from the Leaflet
 * engine is the painter.
 *
 * What this file must never do: project a coordinate back into the game, or
 * compute an arrival distance. Those stay in `lib/location` on the raw fix.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import type { GameMapProps, MapLoadMetrics } from "@/lib/map/map-contract";
import { resolveMapEngine } from "@/lib/map/engine";
import { resolveStyle } from "@/lib/map/maplibre-style";
import {
  describeMaplibreBlock,
  loadMaplibre,
  registerPmtiles,
  type MaplibreModule,
} from "@/lib/map/maplibre-loader";
import { boundsOf, circleRing, padBounds, type LngLat } from "@/lib/map/geo";
import {
  PLAYER_MARKER_SIZE,
  SCENE_MARKER_SIZE,
  huntHandleHtml,
  isValidPoint,
  playerMarkerHtml,
  ringColor,
  ringFillOpacity,
  ringStrokeOpacity,
  sceneMarkerHtml,
  vertexHtml,
} from "@/lib/map/marker-html";
import { resolveRadius } from "@/lib/location";
import { NAV_BLUE } from "@/lib/visual-tokens";

const RINGS_SOURCE = "mos-rings";
const HALO_SOURCE = "mos-halo";
const HUNT_SOURCE = "mos-hunt";

/**
 * The SDK namespace, loaded on demand.
 *
 * `maplibre-gl` touches `window` at import time, so it arrives through
 * `import()` in the boot effect. Marker construction happens in later effects
 * (which only run once `ready` is true) and reads this variable.
 */
let maplibreNamespace: MaplibreModule | null = null;

/** GeoJSON feature collection helper — keeps the layer updates one-liners. */
type BenchFeature = {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
};

function featureCollection(features: BenchFeature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: features as unknown as GeoJSON.Feature[] };
}

export default function MaplibreMap({
  player,
  entries,
  huntArea,
  mapCenter,
  onSimulatedDrag,
  draggablePlayer = false,
  fitToHunt = false,
  fitToken = 0,
  recenterToken,
  heading = null,
  editable = false,
  onMapClick,
  onSceneDrag,
  onSceneSelect,
  onHuntAreaDrag,
  drawingMode = false,
  onEngineFailure,
}: GameMapProps) {
  const engineChoice = resolveMapEngine(process.env.NEXT_PUBLIC_MAP_ENGINE);
  const styleEngine = engineChoice === "protomaps" ? "protomaps" : "openfreemap";
  const runtimeId = styleEngine === "protomaps" ? "maplibre-protomaps" : "maplibre-openfreemap";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  const sceneMarkersRef = useRef<Map<string, { marker: MapLibreMarker; iconKey: string }>>(
    new Map(),
  );
  const playerMarkerRef = useRef<MapLibreMarker | null>(null);
  const huntHandleRef = useRef<MapLibreMarker | null>(null);
  const vertexMarkersRef = useRef<MapLibreMarker[]>([]);

  // Callbacks are read through refs at event time: MapLibre handlers are bound
  // once, and a stale closure would call a removed component's setState.
  const dragCallbackRef = useRef(onSimulatedDrag);
  dragCallbackRef.current = onSimulatedDrag;
  const mapClickCallbackRef = useRef(onMapClick);
  mapClickCallbackRef.current = onMapClick;
  const sceneDragCallbackRef = useRef(onSceneDrag);
  sceneDragCallbackRef.current = onSceneDrag;
  const sceneSelectCallbackRef = useRef(onSceneSelect);
  sceneSelectCallbackRef.current = onSceneSelect;
  const huntAreaDragCallbackRef = useRef(onHuntAreaDrag);
  huntAreaDragCallbackRef.current = onHuntAreaDrag;
  const drawingModeRef = useRef(drawingMode);
  drawingModeRef.current = drawingMode;
  // Outage hook goes through a ref too: the boot effect is mount-only and must
  // not re-run (or read a stale closure) because the parent re-rendered.
  const engineFailureRef = useRef(onEngineFailure);
  engineFailureRef.current = onEngineFailure;

  /** Announce that this engine cannot paint; MapView swaps to the backup. */
  const reportFailure = useCallback((reason: string) => {
    engineFailureRef.current?.(reason);
  }, []);

  /** Initial view, frozen before boot so the mount effect has no prop deps. */
  const initialView = useMemo<[number, number]>(() => {
    if (player && isValidPoint(player.lat, player.lng)) return [player.lng, player.lat];
    const first = entries.find((entry) =>
      isValidPoint(entry.scene.location.lat, entry.scene.location.lng),
    );
    if (first) return [first.scene.location.lng, first.scene.location.lat];
    if (mapCenter && isValidPoint(mapCenter.lat, mapCenter.lng)) {
      return [mapCenter.lng, mapCenter.lat];
    }
    // Same fallback as the Leaflet and AMap engines: Rizal Park, Manila.
    return [120.9794, 14.5832];
  }, [player, entries, mapCenter]);
  const initialViewRef = useRef(initialView);

  /* ---------------------------------------------------------------- */
  /* Boot                                                             */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const metrics: MapLoadMetrics = {
      engine: runtimeId,
      readyMs: null,
      idleMs: null,
      tileErrors: 0,
      bootErrors: [],
      blocked: null,
      zooms: [],
    };
    window.__mosMapEngine = runtimeId;
    window.__mosMapMetrics = metrics;

    const styleRequest = resolveStyle({
      engine: styleEngine,
      openfreemapStyle: process.env.NEXT_PUBLIC_OFM_STYLE,
      pmtilesUrl: process.env.NEXT_PUBLIC_PMTILES_URL,
      flavor: process.env.NEXT_PUBLIC_PROTOMAPS_FLAVOR,
      language: "en",
    });

    let bootTimer: number | null = null;

    void (async () => {
      const loaded = await loadMaplibre();
      if (cancelled) return;
      if (loaded.status === "blocked") {
        metrics.blocked = loaded.reason;
        setBlocked("sdk-load-failed");
        reportFailure(`sdk-load-failed:${loaded.reason}`);
        return;
      }
      const container = containerRef.current;
      if (!container) {
        metrics.blocked = "map-init-error";
        setBlocked("map-init-error");
        reportFailure("map-init-error:missing-container");
        return;
      }

      try {
        const maplibregl = loaded.maplibregl;
        maplibreNamespace = maplibregl;
        if (styleEngine === "protomaps") {
          const url = (process.env.NEXT_PUBLIC_PMTILES_URL ?? "").trim();
          await registerPmtiles(maplibregl, url || "https://latest.protomaps.com/v4.pmtiles");
        }

        const map = new maplibregl.Map({
          container,
          style: styleRequest.style,
          center: initialViewRef.current,
          zoom: 16,
          minZoom: 2,
          maxZoom: 19,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        window.__mosMap = map as unknown as Window["__mosMap"];

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(
          new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }),
          "bottom-left",
        );

        map.on("error", (event) => {
          const raw = (event as { error?: unknown }).error;
          const message =
            raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "map-error";
          const isTile = /tile|pmtiles|range|fetch|403|404|429|500/i.test(message);
          if (isTile) metrics.tileErrors += 1;
          if (metrics.bootErrors.length < 8) metrics.bootErrors.push(message.slice(0, 160));
        });

        map.on("load", () => {
          if (cancelled) return;
          metrics.readyMs = Math.round(
            (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
          );
          metrics.zooms = [map.getZoom()];
          installOverlays(map);
          setReady(true);
        });

        map.once("idle", () => {
          if (cancelled) return;
          metrics.idleMs = Math.round(
            (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
          );
        });

        map.on("zoomend", () => {
          metrics.zooms = [map.getZoom()];
        });

        if (editable) {
          map.getCanvas().style.cursor = "crosshair";
        }

        // A style that never loads emits `error` but never `load`; without this
        // timer the page would sit on a spinner forever and look like a hang.
        bootTimer = window.setTimeout(() => {
          if (cancelled || metrics.readyMs !== null) return;
          metrics.blocked = "style-load-failed";
          setBlocked("style-load-failed");
          reportFailure("style-load-failed");
        }, 12_000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const pmtilesDown = message.startsWith("pmtiles-unreachable");
        metrics.blocked = pmtilesDown ? "pmtiles-unreachable" : "map-init-error";
        metrics.bootErrors.push(message.slice(0, 160));
        setBlocked(metrics.blocked);
        reportFailure(pmtilesDown ? "pmtiles-unreachable" : `map-init-error:${message.slice(0, 80)}`);
      }
    })();

    return () => {
      cancelled = true;
      if (bootTimer !== null) window.clearTimeout(bootTimer);
      const map = mapRef.current;
      mapRef.current = null;
      sceneMarkersRef.current.clear();
      playerMarkerRef.current = null;
      huntHandleRef.current = null;
      vertexMarkersRef.current = [];
      if (window.__mosMap === (map as unknown as Window["__mosMap"])) delete window.__mosMap;
      try {
        map?.remove();
      } catch {
        // Removing a half-initialised map can throw; refs are already cleared.
      }
    };
    // Mount/unmount only; every other input is synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /* Authoring click                                                  */
  /* ---------------------------------------------------------------- */

  // Bound reactively: the designer enters authoring mode by toggling a prop,
  // so a mount-time bind would silently miss every later `editable` change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !editable) return;
    const onClick = (event: MapMouseEvent) => {
      mapClickCallbackRef.current?.(event.lngLat.lat, event.lngLat.lng);
    };
    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [editable, ready]);

  /**
   * Add the empty game sources and their layers once the style is live.
   * Layers are added above the basemap on purpose: the trigger rings are
   * translucent, and putting them under road labels made the active target
   * unreadable at z17 during the first pass.
   */
  const installOverlays = useCallback((map: MapLibreMap) => {
    const empty = featureCollection([]);
    map.addSource(HUNT_SOURCE, { type: "geojson", data: empty });
    map.addSource(RINGS_SOURCE, { type: "geojson", data: empty });
    map.addSource(HALO_SOURCE, { type: "geojson", data: empty });

    map.addLayer({
      id: "mos-hunt-fill",
      type: "fill",
      source: HUNT_SOURCE,
      paint: { "fill-color": "#5b6b9a", "fill-opacity": ["get", "fillOpacity"] },
    });
    map.addLayer({
      id: "mos-hunt-line",
      type: "line",
      source: HUNT_SOURCE,
      paint: {
        "line-color": "#5b6b9a",
        "line-width": 2,
        "line-opacity": ["get", "lineOpacity"],
      },
    });

    map.addLayer({
      id: "mos-rings-fill",
      type: "fill",
      source: RINGS_SOURCE,
      paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fillOpacity"] },
    });
    map.addLayer({
      id: "mos-rings-line",
      type: "line",
      source: RINGS_SOURCE,
      filter: ["!=", ["get", "dashed"], true],
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["get", "width"],
        "line-opacity": ["get", "strokeOpacity"],
      },
    });
    map.addLayer({
      id: "mos-rings-line-dashed",
      type: "line",
      source: RINGS_SOURCE,
      filter: ["==", ["get", "dashed"], true],
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["get", "width"],
        "line-opacity": ["get", "strokeOpacity"],
        "line-dasharray": [2, 2],
      },
    });

    map.addLayer({
      id: "mos-halo-fill",
      type: "fill",
      source: HALO_SOURCE,
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
    });
    map.addLayer({
      id: "mos-halo-line",
      type: "line",
      source: HALO_SOURCE,
      paint: {
        "line-color": ["get", "color"],
        "line-width": 1,
        "line-opacity": 0.5,
      },
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Trigger rings                                                    */
  /* ---------------------------------------------------------------- */

  const ringsSignature = useMemo(
    () =>
      entries
        .map(
          (entry) =>
            `${entry.scene.id}:${entry.status}:${entry.inRange ? 1 : 0}:${entry.isActive ? 1 : 0}:${resolveRadius(entry.scene.location)}`,
        )
        .join("|"),
    [entries],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(RINGS_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const features = entries.flatMap((entry) => {
      const { lat, lng } = entry.scene.location;
      if (!isValidPoint(lat, lng)) return [];
      const radius = resolveRadius(entry.scene.location);
      const ring = circleRing(lat, lng, radius);
      if (ring.length === 0) return [];
      return [
        {
          type: "Feature" as const,
          geometry: { type: "Polygon" as const, coordinates: [ring] },
          properties: {
            color: ringColor(entry.status),
            fillOpacity: ringFillOpacity(entry.status, entry.inRange),
            strokeOpacity: ringStrokeOpacity(entry.status),
            width: entry.isActive ? 2.5 : 1.5,
            dashed: entry.status === "locked",
          },
        },
      ];
    });

    source.setData(featureCollection(features));
  }, [ringsSignature, entries, ready]);

  /* ---------------------------------------------------------------- */
  /* Hunt area                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(HUNT_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const isPolygon = huntArea?.shape === "polygon";
    const points = huntArea?.points ?? [];

    if (!huntArea || (isPolygon && points.length === 0)) {
      source.setData(featureCollection([]));
      huntHandleRef.current?.remove();
      huntHandleRef.current = null;
      return;
    }

    if (isPolygon) {
      const ring = points
        .filter((point) => isValidPoint(point.lat, point.lng))
        .map((point) => [point.lng, point.lat] as LngLat);
      if (ring.length < 2) {
        source.setData(featureCollection([]));
        return;
      }
      ring.push(ring[0]);
      source.setData(
        featureCollection([
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [ring] },
            properties: { fillOpacity: 0.06, lineOpacity: 0.7 },
          },
        ]),
      );
      return;
    }

    const ring = circleRing(huntArea.center.lat, huntArea.center.lng, huntArea.radiusMeters);
    source.setData(
      featureCollection([
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] },
          properties: { fillOpacity: 0.035, lineOpacity: 0.55 },
        },
      ]),
    );

    // MapLibre circles are not draggable either; a centre handle keeps the
    // authoring gesture without re-implementing a drag layer.
    if (editable) {
      if (!huntHandleRef.current) {
        const element = document.createElement("div");
        element.innerHTML = huntHandleHtml();
        element.style.cursor = "grab";
        const handle = createMarker(map, element, [huntArea.center.lng, huntArea.center.lat], true);
        if (handle) {
          handle.on("dragend", () => {
            const position = handle.getLngLat();
            huntAreaDragCallbackRef.current?.(position.lat, position.lng);
          });
          huntHandleRef.current = handle;
        }
      } else {
        huntHandleRef.current.setLngLat([huntArea.center.lng, huntArea.center.lat]);
      }
    } else if (huntHandleRef.current) {
      huntHandleRef.current.remove();
      huntHandleRef.current = null;
    }
  }, [huntArea, editable, ready]);

  /* ---------------------------------------------------------------- */
  /* Drawing vertices                                                 */
  /* ---------------------------------------------------------------- */

  const verticesSignature = useMemo(
    () =>
      `${drawingMode ? 1 : 0}:` +
      (huntArea?.shape === "polygon" ? (huntArea.points ?? []) : [])
        .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
        .join("|"),
    [drawingMode, huntArea?.shape, huntArea?.points],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    vertexMarkersRef.current.forEach((marker) => marker.remove());
    vertexMarkersRef.current = [];
    if (!drawingMode || huntArea?.shape !== "polygon") return;

    vertexMarkersRef.current = (huntArea.points ?? [])
      .filter((point) => isValidPoint(point.lat, point.lng))
      .map((point, index) => {
        const element = document.createElement("div");
        element.innerHTML = vertexHtml(index + 1);
        const marker = createMarker(map, element, [point.lng, point.lat], false);
        return marker;
      })
      .filter((marker): marker is MapLibreMarker => marker !== null);
  }, [verticesSignature, drawingMode, huntArea?.shape, huntArea?.points, ready]);

  /* ---------------------------------------------------------------- */
  /* Scene markers                                                    */
  /* ---------------------------------------------------------------- */

  const markersSignature = useMemo(
    () => entries.map((e) => `${e.scene.id}:${e.status}:${e.isActive ? 1 : 0}`).join("|"),
    [entries],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const store = sceneMarkersRef.current;
    const seen = new Set<string>();

    entries.forEach((entry, index) => {
      const { lat, lng } = entry.scene.location;
      if (!isValidPoint(lat, lng)) return;
      seen.add(entry.scene.id);
      const glyph =
        entry.status === "completed" ? "✓" : (entry.scene.mapStyle?.icon ?? String(index + 1));
      const html = sceneMarkerHtml({
        status: entry.status,
        isActive: entry.isActive,
        glyph,
        sceneId: entry.scene.id,
      });
      const iconKey = `${entry.status}|${entry.isActive ? 1 : 0}|${index}|${entry.scene.mapStyle?.icon ?? ""}`;
      const existing = store.get(entry.scene.id);

      if (existing) {
        existing.marker.setLngLat([lng, lat]);
        if (existing.iconKey !== iconKey) {
          const element = existing.marker.getElement();
          element.innerHTML = html;
          existing.marker.setOffset(sceneOffset(entry.isActive));
        }
        existing.marker.setDraggable(editable);
        existing.iconKey = iconKey;
        return;
      }

      const element = document.createElement("div");
      element.innerHTML = html;
      const marker = createMarker(map, element, [lng, lat], editable);
      if (!marker) return;
      marker.setOffset(sceneOffset(entry.isActive));

      element.addEventListener("click", (event) => {
        event.stopPropagation();
        // While drawing the hunt area a marker click must still land as a
        // vertex, otherwise the drawing flow silently drops points.
        if (drawingModeRef.current) {
          const position = marker.getLngLat();
          mapClickCallbackRef.current?.(position.lat, position.lng);
          return;
        }
        sceneSelectCallbackRef.current?.(entry.scene.id);
      });
      marker.on("dragend", () => {
        const position = marker.getLngLat();
        sceneDragCallbackRef.current?.(entry.scene.id, position.lat, position.lng);
      });

      store.set(entry.scene.id, { marker, iconKey });
    });

    for (const [id, record] of store) {
      if (!seen.has(id)) {
        record.marker.remove();
        store.delete(id);
      }
    }
  }, [markersSignature, entries, editable, ready]);

  /* ---------------------------------------------------------------- */
  /* Player marker + accuracy halo                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const haloSource = map.getSource(HALO_SOURCE) as GeoJSONSource | undefined;

    if (!player || !isValidPoint(player.lat, player.lng)) {
      playerMarkerRef.current?.remove();
      playerMarkerRef.current = null;
      haloSource?.setData(featureCollection([]));
      return;
    }

    const simulated = Boolean(player.simulated);
    const html = playerMarkerHtml(simulated, heading);

    if (!playerMarkerRef.current) {
      const element = document.createElement("div");
      element.innerHTML = html;
      element.style.width = `${PLAYER_MARKER_SIZE}px`;
      element.style.height = `${PLAYER_MARKER_SIZE}px`;
      const marker = createMarker(map, element, [player.lng, player.lat], draggablePlayer);
      if (marker) {
        marker.on("dragend", () => {
          const position = marker.getLngLat();
          dragCallbackRef.current?.(position.lat, position.lng);
        });
        playerMarkerRef.current = marker;
      }
    } else {
      playerMarkerRef.current.setLngLat([player.lng, player.lat]);
      playerMarkerRef.current.getElement().innerHTML = html;
      playerMarkerRef.current.setDraggable(draggablePlayer);
    }

    const haloRing = circleRing(player.lat, player.lng, Math.max(5, player.accuracy), 48);
    haloSource?.setData(
      featureCollection([
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [haloRing] },
          properties: { color: simulated ? "#a855f7" : NAV_BLUE },
        },
      ]),
    );
  }, [player, draggablePlayer, heading, ready]);

  /* ---------------------------------------------------------------- */
  /* Viewport: fit-to-hunt or follow player                            */
  /* ---------------------------------------------------------------- */

  const fitDoneRef = useRef(false);
  const lastFitTokenRef = useRef<number | null>(null);
  const lastCentredAtRef = useRef(0);

  const fitTo = useCallback((points: LngLat[], padMeters: number) => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    const bounds = boundsOf(points);
    if (!bounds) return;
    map.fitBounds(padBounds(bounds, padMeters), {
      padding: { top: 80, bottom: 80, left: 80, right: 80 },
      maxZoom: 17,
      duration: 0,
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !entries.length) return;

    if (fitToHunt) {
      const firstFit = !fitDoneRef.current;
      const tokenFit = lastFitTokenRef.current !== fitToken;
      if (!firstFit && !tokenFit) return;
      lastFitTokenRef.current = fitToken;
      fitDoneRef.current = true;

      const points: LngLat[] = [];
      let padMeters = 40;
      entries.forEach((entry) => {
        const { lat, lng } = entry.scene.location;
        if (!isValidPoint(lat, lng)) return;
        points.push([lng, lat]);
      });
      if (huntArea?.shape === "polygon" && huntArea.points?.length) {
        huntArea.points.forEach((point) => {
          if (!isValidPoint(point.lat, point.lng)) return;
          points.push([point.lng, point.lat]);
        });
      } else if (huntArea && isValidPoint(huntArea.center.lat, huntArea.center.lng)) {
        padMeters = Math.max(padMeters, huntArea.radiusMeters);
        points.push([huntArea.center.lng, huntArea.center.lat]);
      }

      if (points.length === 0) {
        const fallback: LngLat =
          mapCenter && isValidPoint(mapCenter.lat, mapCenter.lng)
            ? [mapCenter.lng, mapCenter.lat]
            : [120.9794, 14.5832];
        map.jumpTo({ center: fallback, zoom: 16 });
        return;
      }
      fitTo(points, padMeters);
      return;
    }

    const now = Date.now();
    const hasFix = Boolean(player);
    const firstFix = hasFix && lastCentredAtRef.current === 0;
    const tokenRequested = recenterToken !== undefined;
    const drifted = hasFix && now - lastCentredAtRef.current > 8000;
    if (!hasFix || !(firstFix || tokenRequested || drifted)) return;
    lastCentredAtRef.current = now;
    map.jumpTo({ center: [player!.lng, player!.lat] });
  }, [fitToHunt, fitToken, recenterToken, player, entries, huntArea, mapCenter, ready, fitTo]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="map-root" data-map-engine={runtimeId}>
      <div ref={containerRef} className="h-full w-full" data-testid="maplibre-container" />
      {blocked ? (
        <div className="absolute inset-x-3 top-3 z-[1200] rounded-xl border border-amber-300 bg-amber-50/95 p-3 text-[12px] leading-relaxed text-amber-900 shadow-lg">
          <p className="font-semibold">地图未就绪</p>
          <p className="mt-1">{describeMaplibreBlock(blocked)}</p>
          <p className="mt-1 text-amber-800/80">
            当前引擎：{styleEngine === "protomaps" ? "Protomaps PMTiles" : "OpenFreeMap"}
            。本页面不会回退到其他供应商。
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Scene markers sit slightly above the point when active (label room). */
function sceneOffset(isActive: boolean): [number, number] {
  const half = SCENE_MARKER_SIZE / 2;
  return isActive ? [0, -half - 10] : [0, -half];
}

/**
 * Create a MapLibre marker.
 *
 * `maplibre-gl` is loaded with `import()` (it touches `window` at import time),
 * so the namespace lives in this module variable instead of being a static
 * import. It is assigned on the first successful load and read synchronously
 * here — every call site runs after `ready`, which only becomes true once the
 * namespace exists.
 */
function createMarker(
  map: MapLibreMap,
  element: HTMLElement,
  lngLat: [number, number],
  draggable: boolean,
): MapLibreMarker | null {
  if (!maplibreNamespace) return null;
  const marker = new maplibreNamespace.Marker({ element, anchor: "center", draggable });
  marker.setLngLat(lngLat).addTo(map);
  return marker;
}
