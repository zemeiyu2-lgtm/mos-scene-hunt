"use client";

/**
 * Game Map screen.
 *
 * The primary play surface. Shows the player, the target, the rest of the hunt,
 * the live distance, and surfaces the arrival action the moment the trigger
 * radius is entered.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useHunt } from "@/components/hunt-provider";
import { useSettings } from "@/components/providers";
import { useGps } from "@/components/gps-provider";
import { MapView } from "@/components/map-view";
import { SimulatorPanel } from "@/components/simulator-panel";
import { StatusChip } from "@/components/ui";
import { calculateDistance, classifyFix, formatDistance, resolveRadius } from "@/lib/location";
import { TabBar } from "@/components/tab-bar";
import type { MapSceneEntry } from "@/components/game-map";
import { TILE_PROVIDER_LIST, type TileProviderId } from "@/lib/map/tiles";
import { playMusic, speak } from "@/components/sound";

export default function MapPage() {
  const router = useRouter();
  const { settings, update } = useSettings();
  const { fix, start, status, error, isSimulated, retry, simulatorAvailable } = useGps();
  const {
    game,
    loading,
    loadError,
    current,
    distances,
    statuses,
    complete,
    insideAnyScene,
    insideSceneId,
    ratio,
  } = useHunt();

  const [recenterToken, setRecenterToken] = useState(0);
  const voiceCueRef = useRef("");
  const musicStopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    musicStopRef.current?.();
    musicStopRef.current = playMusic("explore");
    return () => {
      musicStopRef.current?.();
      musicStopRef.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    const targetDistance = current ? distances[current.id] ?? null : null;
    if (!current || !targetDistance) return;
    const distance = targetDistance.distance;
    let cue: "arrive" | "near" | "approach" | "forward" | null = null;
    if (targetDistance.inRange) cue = "arrive";
    else if (distance <= 20) cue = "near";
    else if (distance <= 50) cue = "approach";
    else if (distance <= 100) cue = "forward";
    if (!cue) return;
    const token = `${current.id}:${cue}`;
    if (voiceCueRef.current === token) return;
    voiceCueRef.current = token;
    const messages = {
      forward: "下一站就在前方。",
      approach: "你正在接近下一站，留意周围。",
      near: "已经很近了。",
      arrive: "你找到了。停下来看看周围。"
    } as const;
    speak(messages[cue]);
  }, [current, distances]);

  const entries = useMemo<MapSceneEntry[]>(() => {
    return statuses.map((row) => {
      const d = distances[row.scene.id];
      return {
        scene: row.scene,
        status: row.status,
        isActive: row.isActive,
        distance: d?.distance ?? null,
        inRange: d?.inRange ?? false,
      };
    });
  }, [statuses, distances]);

  const currentDistance = current ? distances[current.id] ?? null : null;
  const currentRadius = current ? resolveRadius(current.location) : 50;
  const fixQuality = fix ? classifyFix(fix) : null;
  const huntAreaDistance = fix && game?.huntArea
    ? calculateDistance(fix, game.huntArea.center)
    : null;
  const outsideHuntArea = Boolean(
    huntAreaDistance !== null &&
      game?.huntArea &&
      huntAreaDistance > game.huntArea.radiusMeters,
  );

  // The scene the player is physically standing in, if any. Distinct from
  // "current" (the scene they *should* go to): a shortcut can put them in a
  // later scene's ring, but only a reachable one counts.
  const arrivedScene = insideSceneId
    ? statuses.find((s) => s.scene.id === insideSceneId)?.scene ?? null
    : null;

  return (
    <>
      <div className="relative h-[100dvh] w-full overflow-hidden">
        <MapView
          player={fix}
          entries={entries}
          huntArea={game?.huntArea}
          tileProvider={settings.tileProvider as TileProviderId}
          draggablePlayer={simulatorAvailable && settings.simulatorEnabled && isSimulated}
          onSimulatedDrag={(lat, lng) => update({ simulatorCoordinate: { lat, lng } })}
          fitToHunt={!fix}
          recenterToken={recenterToken}
        />

        {/* Top bar: hunt progress + GPS state. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-[500]"
          style={{ paddingTop: "calc(var(--safe-top) + 8px)" }}
        >
          <div className="page">
            <div className="map-hud pointer-events-auto flex items-center gap-2">
              <Link
                href="/quest"
                className="card flex min-w-0 flex-1 items-center gap-3 px-3 py-2"
                aria-label="查看任务列表"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">
                    {complete ? "全部完成 🎉" : current?.title ?? "加载中…"}
                  </p>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-[11px] tabular text-[var(--muted)]">
                  {statuses.filter((s) => s.status === "completed").length}/{statuses.length}
                </span>
              </Link>

              <button
                type="button"
                onClick={() => setRecenterToken((t) => t + 1)}
                className="card grid h-[46px] w-[46px] shrink-0 place-items-center text-[18px]"
                aria-label="回到我的位置"
                title="回到我的位置"
              >
                ◎
              </button>

              <select
                value={settings.tileProvider}
                onChange={(e) => update({ tileProvider: e.target.value as TileProviderId })}
                className="card h-[46px] w-[46px] shrink-0 appearance-none bg-[var(--card)] text-center text-[12px]"
                aria-label="地图样式"
                title="地图样式"
              >
                {TILE_PROVIDER_LIST.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.id === "osm-hot" ? "HOT" : provider.id === "osm" ? "OSM" : "CARTO"}
                  </option>
                ))}
              </select>
            </div>

            {/* GPS status strip: only shown when something is wrong or simulated. */}
            {outsideHuntArea ? (
              <div className="pointer-events-auto mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
                <p className="text-[12.5px] leading-snug text-amber-900">
                  你已离开本次寻宝区域。当前距区域中心约 {huntAreaDistance !== null ? formatDistance(huntAreaDistance) : "--"}。
                </p>
              </div>
            ) : null}

            {status === "error" && error ? (
              <div className="pointer-events-auto mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[12.5px] leading-snug text-red-800">{error.userMessage}</p>
                <button
                  type="button"
                  className="mt-1.5 text-[12px] font-semibold text-red-700 underline"
                  onClick={retry}
                >
                  重新请求定位
                </button>
              </div>
            ) : null}

            {status === "idle" && !fix ? (
              <div className="pointer-events-auto mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[12.5px] leading-snug text-amber-900">
                  尚未开始定位。允许定位后才能看到你与目标地点的距离。
                </p>
                <button
                  type="button"
                  className="btn btn-primary mt-2 h-9 min-h-0 px-3 text-[13px]"
                  onClick={start}
                >
                  获取我的位置
                </button>
              </div>
            ) : null}

            {isSimulated ? (
              <div className="pointer-events-auto mt-2">
                <span className="chip bg-purple-100 text-purple-700">
                  模拟定位中 · 非真实位置
                </span>
              </div>
            ) : null}

            {loadError ? (
              <div className="pointer-events-auto mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
                {loadError}
              </div>
            ) : null}
          </div>
        </div>

        {/* Bottom action sheet: distance + arrival CTA. */}
        <div
          className="absolute inset-x-0 bottom-0 z-[550]"
          style={{ paddingBottom: "calc(12px + var(--tabbar-h) + var(--safe-bottom))" }}
        >
          <div className="page">
            <div className="card p-3 shadow-sheet">
              {loading ? (
                <p className="py-2 text-center text-[13px] text-[var(--muted)]">正在加载游戏数据…</p>
              ) : complete ? (
                <div className="py-1 text-center">
                  <p className="text-[15px] font-semibold text-emerald-700">
                    🎉 你已走完全部 {statuses.length} 个地点
                  </p>
                  <Link href="/bag" className="btn btn-primary btn-block mt-3">
                    查看我的收获
                  </Link>
                </div>
              ) : current ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[15px] font-bold">{current.title}</p>
                        <StatusChip status={statuses.find((s) => s.scene.id === current.id)?.status ?? "available"} />
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">
                        {current.location.name ?? "目标地点"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    {currentDistance ? (
                      currentDistance.inRange ? (
                        <p className="text-[15px] font-bold text-emerald-600">
                          ◉ 你已经找到这里
                        </p>
                      ) : (
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] text-[var(--muted)]">距离目标：</span>
                          <span className="tabular text-[19px] font-bold">
                            {formatDistance(currentDistance.distance)}
                          </span>
                          <span className="text-[11px] text-[var(--muted)]">
                            （触发半径 {currentRadius} m）
                          </span>
                        </div>
                      )
                    ) : (
                      <p className="text-[13px] text-[var(--muted)]">等待定位以计算距离…</p>
                    )}
                  </div>

                  {fixQuality?.message && !currentDistance?.inRange ? (
                    <p className="mt-1.5 text-[11.5px] leading-snug text-amber-700">
                      {fixQuality.message}
                    </p>
                  ) : null}

                  {arrivedScene && arrivedScene.id === current.id ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-block mt-3"
                      onClick={() => router.push(`/scene/${arrivedScene.id}`)}
                    >
                      解锁情境 →
                    </button>
                  ) : (
                    <Link href="/quest" className="btn btn-secondary btn-block mt-3">
                      查看任务详情
                    </Link>
                  )}

                  {insideAnyScene && arrivedScene && arrivedScene.id !== current.id ? (
                    <p className="mt-2 text-[11.5px] text-[var(--muted)]">
                      你正在「{arrivedScene.title}」的范围内，但它尚未解锁。先去完成当前目标。
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="py-2 text-center text-[13px] text-[var(--muted)]">
                  没有可进行的任务。
                </p>
              )}
            </div>
          </div>
        </div>

        {simulatorAvailable ? <SimulatorPanel activeSceneId={current?.id ?? null} /> : null}
      </div>
      <TabBar />
    </>
  );
}
