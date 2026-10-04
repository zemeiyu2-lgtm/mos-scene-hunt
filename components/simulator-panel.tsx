"use client";

/**
 * DEV GPS SIMULATOR panel.
 *
 * Spec section 9 requires the loop to be testable without walking to the
 * coordinates, and requires the entry point to be absent in production.
 *
 * Two guards enforce that:
 *  1. `isSimulatorAvailable()` is false in a production build unless the operator
 *     explicitly opts in via NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1.
 *  2. Nothing in the render path exists unless that check passes.
 *
 * Behaviour: type coordinates, tap a preset, drag the marker on the map, or
 * "walk to" the active target at a fixed speed to watch the trigger fire.
 */

import { useEffect, useRef, useState } from "react";
import {
  SIMULATOR_PRESETS,
  bearing,
  bearingToCompass,
  distanceToLocation,
  formatDistance,
  interpolate,
  isSimulatorAvailable,
  parseCoordinateInput,
  resolveRadius,
  simulatorAvailabilityReason,
} from "@/lib/location";
import { useSettings } from "./providers";
import { useGps } from "./gps-provider";
import { useHunt } from "./hunt-provider";
import { KV } from "./ui";

export function SimulatorPanel({ activeSceneId }: { activeSceneId?: string | null }) {
  const available = isSimulatorAvailable();
  const { settings, update } = useSettings();
  const { fix, injectFix, status } = useGps();
  const { game, distances, statuses } = useHunt();

  const [open, setOpen] = useState(false);
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);

  const walkTimer = useRef<number | null>(null);
  const coord = settings.simulatorCoordinate;

  // Mirror the current coordinate into the text fields whenever it changes from
  // an external source (map drag, preset, walk tick).
  useEffect(() => {
    if (!coord) return;
    setLatText(coord.lat.toFixed(6));
    setLngText(coord.lng.toFixed(6));
  }, [coord?.lat, coord?.lng]);

  useEffect(
    () => () => {
      if (walkTimer.current) window.clearInterval(walkTimer.current);
    },
    [],
  );

  if (!available) return null;

  const apply = (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("坐标必须是数字。");
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError("坐标超出合法范围。");
      return;
    }
    setError(null);
    update({ simulatorEnabled: true, simulatorCoordinate: { lat, lng } });
  };

  const activeScene = game?.scenes.find((s) => s.id === activeSceneId) ?? null;

  /** Animate the simulated player towards the active scene's centre. */
  const startWalk = () => {
    if (!coord || !activeScene) return;
    const target = { lat: activeScene.location.lat, lng: activeScene.location.lng };
    const total = distanceToLocation(coord, activeScene.location);
    const tickMs = 250;
    const speedMps = 20; // Fast enough to observe, slow enough to watch the ring close.
    let current = { ...coord };
    let travelled = 0;

    setWalking(true);
    if (walkTimer.current) window.clearInterval(walkTimer.current);

    walkTimer.current = window.setInterval(() => {
      const step = (speedMps * tickMs) / 1000;
      travelled += step;
      const fraction = total > 0 ? Math.min(1, travelled / total) : 1;
      current = interpolate(current, target, total > 0 ? step / total : 1);
      update({ simulatorCoordinate: { lat: current.lat, lng: current.lng } });

      const remaining = distanceToLocation(current, activeScene.location);
      if (fraction >= 1 || remaining <= 1) {
        if (walkTimer.current) window.clearInterval(walkTimer.current);
        walkTimer.current = null;
        setWalking(false);
      }
    }, tickMs);
  };

  const stopWalk = () => {
    if (walkTimer.current) window.clearInterval(walkTimer.current);
    walkTimer.current = null;
    setWalking(false);
  };

  const jumpToActiveScene = () => {
    if (!activeScene) return;
    // Land 20 m short of the centre so the player can watch the radius trigger
    // rather than appearing already inside it.
    const r = resolveRadius(activeScene.location) + 20;
    const metresPerDegLat = 111_320;
    apply(activeScene.location.lat - r / metresPerDegLat, activeScene.location.lng);
  };

  const activeDistance = activeScene ? distances[activeScene.id]?.distance ?? null : null;
  const activeBearing =
    coord && activeScene
      ? bearingToCompass(
          bearing(coord, {
            lat: activeScene.location.lat,
            lng: activeScene.location.lng,
          }),
        )
      : null;

  const enabled = settings.simulatorEnabled && coord !== null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[600] p-3">
      <div className="pointer-events-auto mx-auto w-full max-w-[480px]">
        {open ? (
          <div className="card p-3 shadow-sheet">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="chip bg-purple-100 text-purple-700">DEV</span>
                <span className="text-[13px] font-semibold">GPS 模拟器</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost h-8 min-h-0 px-2 text-[12px]"
                onClick={() => setOpen(false)}
              >
                收起
              </button>
            </div>

            <label className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[13px]">启用模拟定位</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--accent)]"
                checked={settings.simulatorEnabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  if (on && !coord) {
                    // Default to the hunt start so enabling never yields NaN.
                    const start = game?.startLocation;
                    update({
                      simulatorEnabled: true,
                      simulatorCoordinate: start ? { lat: start.lat, lng: start.lng } : null,
                    });
                  } else {
                    update({ simulatorEnabled: on });
                  }
                }}
              />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-[var(--muted)]">纬度 lat</span>
                <input
                  className="input mt-1 h-11 min-h-0 text-[14px]"
                  inputMode="decimal"
                  value={latText}
                  onChange={(e) => setLatText(e.target.value)}
                  placeholder="14.583200"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[var(--muted)]">经度 lng</span>
                <input
                  className="input mt-1 h-11 min-h-0 text-[14px]"
                  inputMode="decimal"
                  value={lngText}
                  onChange={(e) => setLngText(e.target.value)}
                  placeholder="120.979400"
                />
              </label>
            </div>

            {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary h-9 min-h-0 px-3 text-[13px]"
                onClick={() => {
                  const { coord: parsed, valid } = parseCoordinateInput(latText, lngText);
                  if (!valid) {
                    setError("坐标格式不正确，请检查数值范围。");
                    return;
                  }
                  apply(parsed.lat, parsed.lng);
                }}
              >
                应用坐标
              </button>
              <button
                type="button"
                className="btn btn-secondary h-9 min-h-0 px-3 text-[13px]"
                onClick={jumpToActiveScene}
                disabled={!activeScene}
              >
                跳到目标附近
              </button>
              {walking ? (
                <button
                  type="button"
                  className="btn btn-secondary h-9 min-h-0 px-3 text-[13px]"
                  onClick={stopWalk}
                >
                  停止行走
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary h-9 min-h-0 px-3 text-[13px]"
                  onClick={startWalk}
                  disabled={!coord || !activeScene}
                >
                  模拟走向目标
                </button>
              )}
            </div>

            <p className="mt-3 text-[11px] font-semibold text-[var(--muted)]">快速预设</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SIMULATOR_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="chip border border-[var(--line)] bg-[var(--surface)] text-[11px]"
                  onClick={() => apply(preset.coordinate.lat, preset.coordinate.lng)}
                >
                  {preset.label}
                </button>
              ))}
              {statuses.map((row, index) => (
                <button
                  key={row.scene.id}
                  type="button"
                  className="chip border border-[var(--line)] bg-[var(--surface)] text-[11px]"
                  onClick={() =>
                    apply(row.scene.location.lat, row.scene.location.lng)
                  }
                >
                  {index + 1}. {row.scene.location.name ?? row.scene.title}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-xl bg-[var(--surface)] p-2">
              <KV
                k="当前模拟位置"
                v={coord ? `${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}` : "未设置"}
                mono
              />
              <KV
                k="到当前目标"
                v={
                  activeDistance === null
                    ? "—"
                    : `${formatDistance(activeDistance)} · ${activeBearing ?? ""}`
                }
                mono
              />
              <KV
                k="定位来源"
                v={fix?.simulated ? "模拟器" : fix ? "真实设备" : "无"}
              />
              <KV k="GPS 状态" v={status} />
            </div>

            <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">
              提示：也可以直接在地图上拖动紫色玩家标记。模拟定位仅用于开发与演示，
              生产构建默认不包含此面板。
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="card flex w-full items-center justify-between px-3 py-2 shadow-sheet"
            onClick={() => setOpen(true)}
          >
            <span className="flex items-center gap-2">
              <span className="chip bg-purple-100 text-purple-700">DEV</span>
              <span className="text-[13px] font-semibold">GPS 模拟器</span>
              {enabled ? (
                <span className="text-[11px] text-purple-600">
                  · 已启用 {coord ? `${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}` : ""}
                </span>
              ) : null}
            </span>
            <span className="text-[12px] text-[var(--muted)]">展开 ▾</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Inline notice explaining why the simulator is hidden, for non-dev builds. */
export function SimulatorUnavailableNotice() {
  const reason = simulatorAvailabilityReason();
  if (!reason) return null;
  return <p className="text-[11px] text-[var(--muted)]">{reason}</p>;
}

/** Compute a point `metres` north of a coordinate. Exported for tests. */
export function offsetNorth(lat: number, lng: number, metres: number) {
  return { lat: lat + metres / 111_320, lng };
}

/** Re-export so screens can avoid importing straight from lib. */
export { isSimulatorAvailable };
