"use client";

/**
 * Game map — vanilla Leaflet, no React binding layer.
 *
 * Leaflet is imperative and only exists in the browser, so this module is
 * dynamically imported with SSR disabled (see `map-view.tsx`). Everything here
 * assumes `window` exists.
 *
 * Why vanilla instead of react-leaflet: react-leaflet 5 is licensed under
 * Hippocratic-2.1, which is not an OSI-approved license. The binding adds
 * conveniences the game does not need, so the map layer is written directly
 * against Leaflet (BSD-2-Clause). The layer objects are diffed imperatively in
 * effects keyed on stable signatures; React state only describes *what* the map
 * should show, never *how* Leaflet mutates.
 *
 * What the map shows (spec section 10):
 *   - the player's position, with an accuracy halo
 *   - the current target scene
 *   - completed scenes
 *   - still-locked scenes
 *   - the direction to the current target
 */

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { bearing, bearingToCompass, formatDistance, resolveRadius } from "@/lib/location";
import type { SceneStatus } from "@/lib/game/state";
import type { HuntArea, Scene } from "@/lib/game/types";
import type { PositionFix } from "@/lib/location";

import { TILE_PROVIDERS, type TileProviderId } from "@/lib/map/tiles";

export type { TileProviderId };

/** A scene rendered on the map, with everything the marker needs precomputed. */
export interface MapSceneEntry {
  scene: Scene;
  status: SceneStatus;
  isActive: boolean;
  distance: number | null;
  inRange: boolean;
}

interface GameMapProps {
  player: PositionFix | null;
  entries: MapSceneEntry[];
  huntArea?: HuntArea;
  tileProvider: TileProviderId;
  /** Called when the developer drags the simulated player marker. */
  onSimulatedDrag?: (lat: number, lng: number) => void;
  /** When true, the player marker is draggable (simulator only). */
  draggablePlayer?: boolean;
  /** Fit the view to the whole hunt on first render. */
  fitToHunt?: boolean;
  /** Re-centre on the player when this value changes. */
  recenterToken?: number;
  /** Optional authoring interactions. Gameplay never supplies these. */
  editable?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  onSceneDrag?: (sceneId: string, lat: number, lng: number) => void;
  onHuntAreaDrag?: (lat: number, lng: number) => void;
  /**
   * True while the designer is actively drawing a polygon boundary. Switches
   * the cursor to a crosshair, shows numbered vertex dots for the points
   * placed so far, and shows the "依次点击边界点" guidance overlay.
   */
  drawingMode?: boolean;
}

/* ------------------------------------------------------------------ */
/* Icons                                                              */
/* ------------------------------------------------------------------ */

function sceneIcon(entry: MapSceneEntry, index: number): L.DivIcon {
  const statusClass =
    entry.status === "completed"
      ? "scene-marker--completed"
      : entry.status === "arrived" || entry.status === "challenging"
        ? "scene-marker--arrived"
        : entry.status === "available"
          ? "scene-marker--available"
          : "scene-marker--locked";

  const glyph =
    entry.status === "completed"
      ? "✓"
      : entry.scene.mapStyle?.icon ?? String(index + 1);

  return L.divIcon({
    className: "",
    html: `<div class="scene-marker-wrap ${entry.isActive ? "scene-marker-wrap--active" : ""}">
      <div class="scene-marker ${statusClass} ${entry.isActive ? "scene-marker--active" : ""}" data-role="scene-marker" data-scene-id="${entry.scene.id}" data-status="${entry.status}">${glyph}</div>
      ${entry.isActive ? '<div class="scene-marker__beacon"></div>' : ""}
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function playerIcon(simulated: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    // `data-role` is a stable hook for acceptance tests; the CSS class names are
    // free to change with the visual design, the role is not.
    html: `<div class="player-marker ${simulated ? "player-marker--sim" : ""}" data-role="player-marker">
             <div class="player-marker__pulse"></div>
             <div class="player-marker__dot"></div>
           </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function GameMap({
  player,
  entries,
  huntArea,
  tileProvider,
  onSimulatedDrag,
  draggablePlayer = false,
  fitToHunt = false,
  recenterToken,
  editable = false,
  onMapClick,
  onSceneDrag,
  onHuntAreaDrag,
  drawingMode = false,
}: GameMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const scaleRef = useRef<L.Control.Scale | null>(null);
  const ringsRef = useRef<Map<string, L.Circle>>(new Map());
  const sceneMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const playerMarkerRef = useRef<L.Marker | null>(null);
  const playerHaloRef = useRef<L.Circle | null>(null);
  const directionLineRef = useRef<L.Polyline | null>(null);
  const huntAreaRef = useRef<L.Circle | null>(null);
  const huntAreaPolygonRef = useRef<L.Polygon | null>(null);
  const huntAreaLineRef = useRef<L.Polyline | null>(null);
  const areaVerticesRef = useRef<L.LayerGroup | null>(null);

  // Callbacks arriving via props must not become stale closures inside Leaflet
  // event handlers, so they are read through a ref at event time.
  const dragCallbackRef = useRef(onSimulatedDrag);
  dragCallbackRef.current = onSimulatedDrag;
  const mapClickCallbackRef = useRef(onMapClick);
  mapClickCallbackRef.current = onMapClick;
  const sceneDragCallbackRef = useRef(onSceneDrag);
  sceneDragCallbackRef.current = onSceneDrag;
  const huntAreaDragCallbackRef = useRef(onHuntAreaDrag);
  huntAreaDragCallbackRef.current = onHuntAreaDrag;

  const tiles = TILE_PROVIDERS[tileProvider] ?? TILE_PROVIDERS["osm-hot"];
  const activeEntry = useMemo(() => entries.find((e) => e.isActive) ?? null, [entries]);

  // Signatures keep the imperative diffs cheap: effects only run when the
  // *meaning* of the layer changed, not on every parent re-render.
  const ringsSignature = useMemo(
    () =>
      entries
        .map(
          (e) =>
            `${e.scene.id}:${e.status}:${e.inRange ? 1 : 0}:${e.isActive ? 1 : 0}:${resolveRadius(e.scene.location)}`,
        )
        .join("|"),
    [entries],
  );
  const markersSignature = useMemo(
    () => entries.map((e) => `${e.scene.id}:${e.status}:${e.isActive ? 1 : 0}`).join("|"),
    [entries],
  );

  /* ------------------------------------------------ 创建地图（一次） */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const initialCenter: L.LatLngExpression = player
      ? [player.lat, player.lng]
      : entries.length
        ? [entries[0].scene.location.lat, entries[0].scene.location.lng]
        : [14.5832, 120.9794];

    const map = L.map(container, {
      center: initialCenter,
      zoom: 17,
      zoomControl: false,
      attributionControl: true,
      minZoom: 3,
      maxZoom: tiles.maxZoom,
    });
    mapRef.current = map;

    if (editable) {
      map.on("click", (event) => mapClickCallbackRef.current?.(event.latlng.lat, event.latlng.lng));
    }

    const scale = L.control.scale({ imperial: false, position: "bottomleft" });
    scale.addTo(map);
    scaleRef.current = scale;

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      scaleRef.current = null;
      ringsRef.current.clear();
      sceneMarkersRef.current.clear();
      playerMarkerRef.current = null;
      playerHaloRef.current = null;
      directionLineRef.current = null;
      huntAreaRef.current = null;
      huntAreaPolygonRef.current = null;
      huntAreaLineRef.current = null;
      areaVerticesRef.current = null;
    };
    // Mount/unmount only. Everything else is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------ 瓦片层 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Leaflet mutates the container's class list; swapping a TileLayer's URL in
    // place has historically been unreliable, so the layer is recreated on a
    // provider change. This mirrors the old `key={tileProvider}` remount.
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    const layer = L.tileLayer(tiles.url, {
      attribution: tiles.attribution,
      maxZoom: tiles.maxZoom,
      detectRetina: tileProvider === "carto-voyager",
    });
    layer.addTo(map);
    tileRef.current = layer;
    map.setMaxZoom(tiles.maxZoom);
  }, [tileProvider, tiles.url, tiles.attribution, tiles.maxZoom]);

  /* ------------------------------------------------ 触发圈 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const store = ringsRef.current;
    const seen = new Set<string>();

    for (const entry of entries) {
      seen.add(entry.scene.id);
      const latlng: L.LatLngExpression = [
        entry.scene.location.lat,
        entry.scene.location.lng,
      ];
      const radius = resolveRadius(entry.scene.location);
      const style: L.PathOptions = {
        color:
          entry.status === "completed"
            ? "#2ec27e"
            : entry.status === "locked"
              ? "#98a1b3"
              : "#f5a524",
        weight: entry.isActive ? 2.5 : 1.5,
        opacity: entry.status === "locked" ? 0.45 : 0.85,
        fillColor:
          entry.status === "completed"
            ? "#2ec27e"
            : entry.status === "locked"
              ? "#98a1b3"
              : "#f5a524",
        fillOpacity: entry.inRange ? 0.22 : 0.1,
        dashArray: entry.status === "locked" ? "4 6" : undefined,
      };

      const existing = store.get(entry.scene.id);
      if (existing) {
        existing.setLatLng(latlng);
        existing.setRadius(radius);
        existing.setStyle(style);
      } else {
        const ring = L.circle(latlng, { radius, ...style });
        ring.addTo(map);
        store.set(entry.scene.id, ring);
      }
    }

    for (const [id, ring] of store) {
      if (!seen.has(id)) {
        map.removeLayer(ring);
        store.delete(id);
      }
    }
  }, [ringsSignature, entries]);

  /* ------------------------------------------------ 整体寻宝区域 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const isPolygon = huntArea?.shape === "polygon";
    const points = huntArea?.points ?? [];

    if (!huntArea || (isPolygon && points.length === 0)) {
      if (huntAreaRef.current) { map.removeLayer(huntAreaRef.current); huntAreaRef.current = null; }
      if (huntAreaPolygonRef.current) { map.removeLayer(huntAreaPolygonRef.current); huntAreaPolygonRef.current = null; }
      if (huntAreaLineRef.current) { map.removeLayer(huntAreaLineRef.current); huntAreaLineRef.current = null; }
      return;
    }

    if (isPolygon) {
      if (huntAreaRef.current) { map.removeLayer(huntAreaRef.current); huntAreaRef.current = null; }
      const latlngs: L.LatLngExpression[] = points.map((p) => [p.lat, p.lng]);
      const style: L.PolylineOptions = {
        color: "#5b6b9a", weight: 2, opacity: 0.7, dashArray: "8 8", interactive: editable,
      };
      if (points.length >= 3) {
        if (huntAreaLineRef.current) { map.removeLayer(huntAreaLineRef.current); huntAreaLineRef.current = null; }
        if (!huntAreaPolygonRef.current) {
          huntAreaPolygonRef.current = L.polygon(latlngs, { ...style, fillColor: "#5b6b9a", fillOpacity: 0.06 }).addTo(map);
        } else {
          huntAreaPolygonRef.current.setLatLngs(latlngs);
        }
      } else {
        if (huntAreaPolygonRef.current) { map.removeLayer(huntAreaPolygonRef.current); huntAreaPolygonRef.current = null; }
        if (!huntAreaLineRef.current) {
          huntAreaLineRef.current = L.polyline(latlngs, style).addTo(map);
        } else {
          huntAreaLineRef.current.setLatLngs(latlngs);
        }
      }
      return;
    }

    if (huntAreaPolygonRef.current) { map.removeLayer(huntAreaPolygonRef.current); huntAreaPolygonRef.current = null; }
    if (huntAreaLineRef.current) { map.removeLayer(huntAreaLineRef.current); huntAreaLineRef.current = null; }

    const center: L.LatLngExpression = [huntArea.center.lat, huntArea.center.lng];
    if (!huntAreaRef.current) {
      huntAreaRef.current = L.circle(center, {
        radius: huntArea.radiusMeters, color: "#5b6b9a", weight: 2, opacity: 0.55,
        fillColor: "#5b6b9a", fillOpacity: 0.035, dashArray: "8 8", interactive: editable,
      }).addTo(map);
      if (editable) {
        huntAreaRef.current.on("dragend", () => {
          const center = huntAreaRef.current?.getLatLng();
          if (center) huntAreaDragCallbackRef.current?.(center.lat, center.lng);
        });
      }
    } else {
      huntAreaRef.current.setLatLng(center);
      huntAreaRef.current.setRadius(huntArea.radiusMeters);
    }
  }, [huntArea?.shape, huntArea?.center.lat, huntArea?.center.lng, huntArea?.radiusMeters, JSON.stringify(huntArea?.points ?? []), editable]);

  /* ------------------------------------------------ 绘制中的边界顶点 */
  const verticesSignature = useMemo(
    () =>
      `${drawingMode ? 1 : 0}:` +
      (huntArea?.shape === "polygon" ? huntArea.points ?? [] : [])
        .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
        .join("|"),
    [drawingMode, huntArea?.shape, huntArea?.points],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Vertices only make sense while the designer is placing them; a committed
    // area stays clean so the scene markers remain the visual focus.
    if (!drawingMode || huntArea?.shape !== "polygon") {
      if (areaVerticesRef.current) {
        map.removeLayer(areaVerticesRef.current);
        areaVerticesRef.current = null;
      }
      return;
    }

    if (!areaVerticesRef.current) {
      areaVerticesRef.current = L.layerGroup().addTo(map);
    }
    const group = areaVerticesRef.current;
    group.clearLayers();
    (huntArea.points ?? []).forEach((p, i) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#f5a524",
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip(String(i + 1), {
          permanent: true,
          direction: "center",
          className: "area-vertex-label",
        })
        .addTo(group);
    });
  }, [verticesSignature, drawingMode, huntArea?.shape, huntArea?.points]);

  /* ------------------------------------------------ 场景标记 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const store = sceneMarkersRef.current;
    const seen = new Set<string>();

    entries.forEach((entry, index) => {
      seen.add(entry.scene.id);
      const latlng: L.LatLngExpression = [
        entry.scene.location.lat,
        entry.scene.location.lng,
      ];
      const icon = sceneIcon(entry, index);

      const existing = store.get(entry.scene.id);
      if (existing) {
        existing.setLatLng(latlng);
        existing.setIcon(icon);
        if (editable && existing.dragging && !existing.dragging.enabled()) existing.dragging.enable();
        if (!editable && existing.dragging?.enabled()) existing.dragging.disable();
        if (entry.isActive) {
          existing.bindTooltip(entry.scene.title, {
            permanent: true,
            direction: "top",
            offset: [0, -22],
            className: "scene-target-tooltip",
          });
        } else if (existing.getTooltip()) {
          existing.unbindTooltip();
        }
      } else {
        const marker = L.marker(latlng, { icon, interactive: editable, draggable: editable });
        if (editable) {
          marker.on("dragend", () => {
            const pos = marker.getLatLng();
            sceneDragCallbackRef.current?.(entry.scene.id, pos.lat, pos.lng);
          });
        }
        marker.addTo(map);
        if (entry.isActive) {
          marker.bindTooltip(entry.scene.title, {
            permanent: true,
            direction: "top",
            offset: [0, -22],
            className: "scene-target-tooltip",
          });
        }
        store.set(entry.scene.id, marker);
      }
    });

    for (const [id, marker] of store) {
      if (!seen.has(id)) {
        map.removeLayer(marker);
        store.delete(id);
      }
    }
  }, [markersSignature, entries]);

  /* ------------------------------------------------ 玩家标记与精度晕 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (player) {
      const latlng: L.LatLngExpression = [player.lat, player.lng];
      const simulated = Boolean(player.simulated);

      if (!playerMarkerRef.current) {
        const marker = L.marker(latlng, {
          icon: playerIcon(simulated),
          draggable: draggablePlayer,
          zIndexOffset: 1000,
        });
        marker.on("dragend", () => {
          const cb = dragCallbackRef.current;
          if (!cb) return;
          const pos = marker.getLatLng();
          cb(pos.lat, pos.lng);
        });
        marker.addTo(map);
        playerMarkerRef.current = marker;
      } else {
        const marker = playerMarkerRef.current;
        marker.setLatLng(latlng);
        marker.setIcon(playerIcon(simulated));
        if (draggablePlayer !== marker.dragging?.enabled()) {
          if (draggablePlayer) marker.dragging?.enable();
          else marker.dragging?.disable();
        }
      }

      const haloRadius = Math.max(5, player.accuracy);
      const haloStyle: L.PathOptions = {
        color: simulated ? "#a855f7" : "#1d7ff0",
        weight: 1,
        opacity: 0.5,
        fillColor: simulated ? "#a855f7" : "#1d7ff0",
        fillOpacity: 0.12,
      };
      if (!playerHaloRef.current) {
        const halo = L.circle(latlng, { radius: haloRadius, ...haloStyle });
        halo.addTo(map);
        playerHaloRef.current = halo;
      } else {
        playerHaloRef.current.setLatLng(latlng);
        playerHaloRef.current.setRadius(haloRadius);
        playerHaloRef.current.setStyle(haloStyle);
      }
    } else {
      if (playerMarkerRef.current) {
        map.removeLayer(playerMarkerRef.current);
        playerMarkerRef.current = null;
      }
      if (playerHaloRef.current) {
        map.removeLayer(playerHaloRef.current);
        playerHaloRef.current = null;
      }
    }
  }, [player, draggablePlayer]);

  /* ------------------------------------------------ 目标方向线 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (player && activeEntry) {
      const points: L.LatLngExpression[] = [
        [player.lat, player.lng],
        [activeEntry.scene.location.lat, activeEntry.scene.location.lng],
      ];
      if (!directionLineRef.current) {
        const line = L.polyline(points, {
          color: "#f5a524",
          weight: 2,
          opacity: 0.5,
          dashArray: "3 10",
        });
        line.addTo(map);
        directionLineRef.current = line;
      } else {
        directionLineRef.current.setLatLngs(points);
      }
    } else if (directionLineRef.current) {
      map.removeLayer(directionLineRef.current);
      directionLineRef.current = null;
    }
  }, [player, activeEntry]);

  /* ------------------------------------------------ 视角：整场取景或跟随玩家 */
  const fitDoneRef = useRef(false);
  const lastFitTokenRef = useRef<string | undefined>(undefined);
  const lastCentredAtRef = useRef(0);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !entries.length) return;

    if (fitToHunt) {
      const force =
        activeEntry !== undefined &&
        activeEntry !== null &&
        activeEntry.scene.id !== lastFitTokenRef.current;
      if (fitDoneRef.current && !force) return;
      lastFitTokenRef.current = activeEntry?.scene.id;

      const points: L.LatLngExpression[] = entries.map((e) => [
        e.scene.location.lat,
        e.scene.location.lng,
      ]);
      if (player) points.push([player.lat, player.lng]);
      if (points.length === 1) {
        map.setView(points[0], 17);
      } else {
        map.fitBounds(L.latLngBounds(points).pad(0.35), { animate: !fitDoneRef.current });
      }
      fitDoneRef.current = true;
      return;
    }

    // Follow mode: recentre on an explicit token, on the first fix, or when the
    // player has drifted long enough since the last recentre.
    const now = Date.now();
    const hasFix = Boolean(player);
    const firstFix = hasFix && lastCentredAtRef.current === 0;
    const tokenRequested = recenterToken !== undefined;
    const drifted = hasFix && now - lastCentredAtRef.current > 8000;

    if (!hasFix || !(firstFix || tokenRequested || drifted)) return;
    lastCentredAtRef.current = now;
    map.setView([player!.lat, player!.lng], map.getZoom(), {
      animate: tokenRequested,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToHunt, recenterToken, player?.lat, player?.lng, activeEntry?.scene.id, entries, player]);

  /* ------------------------------------------------ 渲染 */
  const headingLabel = useMemo(() => {
    if (!player || !activeEntry) return null;
    const deg = bearing(player, {
      lat: activeEntry.scene.location.lat,
      lng: activeEntry.scene.location.lng,
    });
    return bearingToCompass(deg);
  }, [player, activeEntry]);

  return (
    <div className={`map-root ${drawingMode ? "map-root--drawing" : ""}`}>
      <div ref={containerRef} className="h-full w-full" />

      {/* Boundary-drawing guidance, kept in the DOM so it is readable by assistive tech. */}
      {drawingMode ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[600] flex justify-center p-2">
          <div className="rounded-full bg-[var(--card)]/95 px-3 py-1 text-[12px] font-semibold shadow-card backdrop-blur">
            请在地图上依次点击游戏区域的边界点 · 已选择 {huntArea?.points?.length ?? 0} 个点
            {(huntArea?.points?.length ?? 0) < 3 ? "（至少 3 个点）" : ""}
          </div>
        </div>
      ) : null}

      {/* Direction hint overlay, kept in the DOM so it is readable by assistive tech. */}
      {headingLabel && activeEntry && !drawingMode ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex justify-center p-2">
          <div className="rounded-full bg-[var(--card)]/95 px-3 py-1 text-[12px] font-medium shadow-card backdrop-blur">
            目标：{activeEntry.scene.location.name ?? activeEntry.scene.title}
            {activeEntry.distance !== null ? ` · ${formatDistance(activeEntry.distance)}` : ""} ·{" "}
            {headingLabel}
          </div>
        </div>
      ) : null}
    </div>
  );
}
