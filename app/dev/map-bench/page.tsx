"use client";

/**
 * Vendor bench probe — a diagnostics page, not a product screen.
 *
 * It renders the *real* `MapView` (so what is measured is what the game would
 * get) with a fixture that exercises every overlay the game uses: player fix +
 * accuracy halo, three targets with trigger rings, a hunt-area circle, a
 * polygon hunt area, and authoring click/drag.
 *
 * Reachable only at `/dev/map-bench`. Nothing here is imported by the product.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapView } from "@/components/map-view";
import type { MapSceneEntry } from "@/lib/map/map-contract";
import { MAP_ENGINE_LABEL, resolveMapEngine } from "@/lib/map/engine";
import type { HuntArea, Scene } from "@/lib/game/types";
import type { PositionFix } from "@/lib/location";

interface CityPreset {
  id: string;
  label: string;
  center: { lat: number; lng: number };
  /** Targets sit a short walk from the centre, inside the hunt area. */
  targets: Array<{ lat: number; lng: number; title: string }>;
}

const CITIES: CityPreset[] = [
  {
    id: "manila",
    label: "Manila · Rizal Park",
    center: { lat: 14.5832, lng: 120.9794 },
    targets: [
      { lat: 14.58356, lng: 120.97981, title: "Rizal Monument" },
      { lat: 14.58241, lng: 120.98102, title: "Chinese Garden" },
      { lat: 14.58462, lng: 120.97811, title: "Museo Pambata" },
    ],
  },
  {
    id: "singapore",
    label: "Singapore · Marina Bay",
    center: { lat: 1.2834, lng: 103.8607 },
    targets: [
      { lat: 1.28394, lng: 103.86112, title: "Merlion Park" },
      { lat: 1.28268, lng: 103.85961, title: "Esplanade" },
      { lat: 1.28451, lng: 103.86204, title: "Marina Bay Sands" },
    ],
  },
  {
    id: "new-york",
    label: "New York · Times Square",
    center: { lat: 40.758, lng: -73.9855 },
    targets: [
      { lat: 40.75838, lng: -73.98512, title: "One Times Square" },
      { lat: 40.75742, lng: -73.98651, title: "Broadway & 44th" },
      { lat: 40.75911, lng: -73.98442, title: "TKTS Booth" },
    ],
  },
];

const ZOOMS = [10, 12, 15, 17] as const;

function buildScenes(city: CityPreset): Scene[] {
  return city.targets.map(
    (target, index) =>
      ({
        id: `probe-${city.id}-${index}`,
        title: target.title,
        story: "benchmark fixture",
        location: { ...target, radius: 60, name: target.title },
        nextSceneId: null,
      }) as unknown as Scene,
  );
}

export default function MapBenchPage() {
  const engine = resolveMapEngine(process.env.NEXT_PUBLIC_MAP_ENGINE);
  const [cityId, setCityId] = useState<string>(CITIES[0].id);
  const [showPlayer, setShowPlayer] = useState(true);
  const [showHuntCircle, setShowHuntCircle] = useState(true);
  const [polygonMode, setPolygonMode] = useState(false);
  const [editable, setEditable] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [clicked, setClicked] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<{
    readyMs: number | null;
    idleMs: number | null;
    tileErrors: number;
    blocked: string | null;
    zoom: number | null;
    requests: number;
  }>({
    readyMs: null,
    idleMs: null,
    tileErrors: 0,
    blocked: null,
    zoom: null,
    requests: 0,
  });

  const city = useMemo(() => CITIES.find((item) => item.id === cityId) ?? CITIES[0], [cityId]);

  const entries = useMemo<MapSceneEntry[]>(
    () =>
      buildScenes(city).map((scene, index) => ({
        scene,
        status: (index === 0 ? "available" : index === 1 ? "completed" : "locked") as MapSceneEntry["status"],
        isActive: index === 0,
        distance: index === 0 ? 24 : null,
        inRange: index === 0,
      })),
    [city],
  );

  const player = useMemo<PositionFix>(
    () => ({ ...city.center, accuracy: 12, timestamp: Date.now() }),
    [city],
  );

  const huntArea = useMemo<HuntArea>(() => {
    if (polygonMode) {
      const { lat, lng } = city.center;
      return {
        shape: "polygon",
        name: "Bench polygon",
        center: city.center,
        radiusMeters: 0,
        points: [
          { lat: lat + 0.0009, lng: lng - 0.0011 },
          { lat: lat + 0.0011, lng: lng + 0.0012 },
          { lat: lat - 0.0008, lng: lng + 0.001 },
          { lat: lat - 0.001, lng: lng - 0.0009 },
        ],
      } as HuntArea;
    }
    return {
      center: city.center,
      radiusMeters: 260,
      shape: "circle",
      name: "Bench circle",
    } as HuntArea;
  }, [city, polygonMode]);

  // The adapters publish readiness through the metrics object; polling it keeps
  // the product components free of diagnostics-only callbacks.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const metrics = window.__mosMapMetrics;
      const map = window.__mosMap;
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => /openfreemap|protomaps|geoapify|tile\.openstreetmap|cartocdn/.test(entry.name));
      setStatus({
        readyMs: metrics?.readyMs ?? null,
        idleMs: metrics?.idleMs ?? null,
        tileErrors: metrics?.tileErrors ?? 0,
        blocked: metrics?.blocked ?? null,
        zoom: map ? Math.round(map.getZoom() * 10) / 10 : null,
        requests: resources.length,
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const jump = useCallback(
    (zoom: number) => {
      window.__mosMap?.jumpTo({ center: [city.center.lng, city.center.lat], zoom });
    },
    [city],
  );

  useEffect(() => {
    // City change: recentre at the current zoom once the map is live.
    const timer = window.setTimeout(() => {
      const map = window.__mosMap;
      if (!map) return;
      map.jumpTo({ center: [city.center.lng, city.center.lat], zoom: map.getZoom() });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [city]);

  return (
    <main className="min-h-dvh bg-[#0b1220] text-slate-100">
      <div className="mx-auto flex max-w-md flex-col gap-3 p-3">
        <header className="rounded-xl bg-white/5 p-3">
          <h1 className="text-[15px] font-semibold">地图供应商测试台</h1>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            引擎：<span data-testid="engine-label">{MAP_ENGINE_LABEL[engine]}</span>
          </p>
        </header>

        <div className="flex flex-wrap gap-1.5" data-testid="city-picker">
          {CITIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCityId(item.id)}
              data-city={item.id}
              className={`rounded-lg px-2.5 py-1.5 text-[12px] ${
                item.id === cityId ? "bg-sky-500 text-white" : "bg-white/10 text-slate-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5" data-testid="zoom-picker">
          {ZOOMS.map((zoom) => (
            <button
              key={zoom}
              type="button"
              onClick={() => jump(zoom)}
              data-zoom={zoom}
              className={`rounded-lg px-3 py-1.5 text-[12px] ${
                status.zoom === zoom ? "bg-emerald-500 text-white" : "bg-white/10 text-slate-200"
              }`}
            >
              z{zoom}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFitToken((token) => token + 1)}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] text-black"
          >
            重新取景
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px]" data-testid="overlay-picker">
          <Toggle label="玩家定位" value={showPlayer} onChange={setShowPlayer} />
          <Toggle label="寻宝范围" value={showHuntCircle} onChange={setShowHuntCircle} />
          <Toggle label="多边形区域" value={polygonMode} onChange={setPolygonMode} />
          <Toggle label="创作者选点" value={editable} onChange={setEditable} />
        </div>

        <div className="h-[58vh] overflow-hidden rounded-xl border border-white/10">
          <MapView
            // Keyed on the authoring toggle: every engine binds its authoring
            // handlers at mount, so flipping `editable` mid-flight would leave
            // the map deaf on engines whose handlers are mount-time (Leaflet).
            key={editable ? "authoring" : "display"}
            player={showPlayer ? player : null}
            entries={entries}
            huntArea={showHuntCircle || polygonMode ? huntArea : undefined}
            tileProvider="osm"
            fitToHunt
            fitToken={fitToken}
            editable={editable}
            drawingMode={false}
            onMapClick={(lat, lng) => setClicked({ lat, lng })}
          />
        </div>

        <section
          className="rounded-xl bg-white/5 p-3 text-[11px] leading-relaxed"
          data-testid="metrics"
        >
          <p>
            ready: <b data-testid="ready-ms">{status.readyMs ?? "—"}</b> ms · idle:{" "}
            <b data-testid="idle-ms">{status.idleMs ?? "—"}</b> ms · zoom:{" "}
            <b data-testid="current-zoom">{status.zoom ?? "—"}</b>
          </p>
          <p>
            tile errors: <b data-testid="tile-errors">{status.tileErrors}</b> · requests:{" "}
            <b data-testid="request-count">{status.requests}</b>
          </p>
          <p>
            blocked: <b data-testid="blocked">{status.blocked ?? "none"}</b>
          </p>
          <p className="text-slate-400" data-testid="click-readout">
            点击坐标：
            {clicked ? `${clicked.lat.toFixed(6)}, ${clicked.lng.toFixed(6)}` : "（开启创作者选点后点击地图）"}
          </p>
        </section>
      </div>
    </main>
  );
}

function Toggle(props: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.value)}
      className={`rounded-lg px-2.5 py-1.5 ${
        props.value ? "bg-white/20 text-white" : "bg-white/5 text-slate-400"
      }`}
    >
      {props.label}
    </button>
  );
}
