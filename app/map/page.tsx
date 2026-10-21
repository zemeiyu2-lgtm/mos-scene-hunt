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
import { calculateDistance, classifyFix, formatDistance, smoothHeading } from "@/lib/location";
import { TabBar } from "@/components/tab-bar";
import type { MapSceneEntry } from "@/components/game-map";
import { TILE_PROVIDER_LIST, type TileProviderId } from "@/lib/map/tiles";

/** A GPS course heading is only trustworthy while the player is actually moving. */
const GPS_COURSE_MIN_SPEED_MPS = 1;
/** Only a *fresh* arrival (recently crossed into the ring) auto-opens the scene. */
const FRESH_ARRIVAL_WINDOW_MS = 30_000;

export default function MapPage() {
  const router = useRouter();
  const { settings, update } = useSettings();
  const { fix, start, status, error, isSimulated, retry, simulatorAvailable } = useGps();
  const {
    game,
    state,
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
  const [taskExpanded, setTaskExpanded] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [headingEnabled, setHeadingEnabled] = useState(false);
  const [headingMessage, setHeadingMessage] = useState<string | null>(null);

  const enableHeading = async (auto = false) => {
    if (typeof window === "undefined" || typeof window.DeviceOrientationEvent === "undefined") {
      // 无传感器：不打扰玩家，蓝色目标箭头仍然可用。
      if (!auto) setHeadingMessage("此设备或浏览器无法提供指南针方向；仍可使用蓝色目标箭头和地图。");
      return;
    }
    const Orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<string>;
    };
    try {
      if (typeof Orientation.requestPermission === "function") {
        const permission = await Orientation.requestPermission();
        if (permission !== "granted") {
          // 自动尝试被拒（iOS 无用户手势时的常态）：保持安静，指南针按钮仍在。
          if (!auto) setHeadingMessage("未获得手机朝向权限；蓝色目标箭头仍可正常使用。");
          return;
        }
      }
      setHeadingEnabled(true);
      if (!auto) setHeadingMessage("正在获取手机朝向……请稍候。");
    } catch {
      setHeadingEnabled(false);
      if (!auto) setHeadingMessage("暂时无法读取手机朝向；请检查浏览器权限后重试。");
    }
  };

  // 问题 1：方向尾巴默认显示。挂载时自动尝试启用指南针——在 Android/桌面或已
  // 授权过的浏览器上会静默成功；在 iOS 上无手势会被拒，此时保持安静，玩家仍可
  // 点🧭手动授权，行走时的 GPS 航向也会作为回退驱动尾巴。
  const autoHeadingTriedRef = useRef(false);
  useEffect(() => {
    if (autoHeadingTriedRef.current) return;
    autoHeadingTriedRef.current = true;
    void enableHeading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!headingEnabled) return;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const compassEvent = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
      let next: number | null = null;
      if (typeof compassEvent.webkitCompassHeading === "number" && Number.isFinite(compassEvent.webkitCompassHeading)) {
        next = compassEvent.webkitCompassHeading;
      } else if (event.absolute && event.alpha !== null && Number.isFinite(event.alpha)) {
        next = (360 - event.alpha + 360) % 360;
      }
      if (next !== null) {
        setHeading(next);
        setHeadingMessage(null);
      }
    };
    window.addEventListener("deviceorientation", handleOrientation as EventListener);
    window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation as EventListener);
      window.removeEventListener("deviceorientationabsolute", handleOrientation as EventListener);
    };
  }, [headingEnabled]);

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
  const targetBearing = fix && current ? bearingDegrees(fix, current.location) : null;
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

  // When the current target is reached, reveal the next action automatically.
  // This avoids making players guess that they need to expand the task card.
  useEffect(() => {
    if (arrivedScene && current && arrivedScene.id === current.id) {
      setTaskExpanded(true);
    }
  }, [arrivedScene?.id, current?.id]);

  // ---- 问题 1：方向尾巴的最终驱动值 ----------------------------------
  // 优先级：设备指南针（真实设备朝向）> GPS 航向（真实移动方向，仅在移动时
  // 可信）。两者都不是伪造的方向数据；都不可用时尾巴保持指向上方（北），
  // 拿到第一个可信方向后立即跟随。
  // 所有更新经过最短弧指数平滑，避免指南针抖动让尾巴抽搐。
  const gpsCourse = fix?.heading != null && Number.isFinite(fix.heading) && (fix.speed ?? 0) > GPS_COURSE_MIN_SPEED_MPS
    ? fix.heading
    : null;
  const [displayHeading, setDisplayHeading] = useState<number | null>(null);
  const displayHeadingRef = useRef<number | null>(null);
  useEffect(() => {
    const target = heading ?? gpsCourse;
    if (target === null || !Number.isFinite(target)) return;
    const next = smoothHeading(displayHeadingRef.current, target);
    displayHeadingRef.current = next;
    setDisplayHeading(next);
  }, [heading, gpsCourse]);

  // ---- 问题 3：到达当前目标后自动显示情境/问题 ------------------------
  // 只对「新鲜到达」触发（30 秒内跨入触发圈），避免老进度或站在圈内反复打开。
  // 每个场景一次（ref 去重）；OPEN_CHALLENGE 在状态机里幂等，GPS 抖动不会重复
  // 解锁或重复发奖。离开范围后挑战状态由状态机保留（challenging 不回退），
  // 已填写的答案不会丢失。
  const autoOpenedSceneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !arrivedScene || arrivedScene.id !== current.id) return;
    if (autoOpenedSceneRef.current === arrivedScene.id) return;
    const arrivedAt = state?.scenes[current.id]?.arrivedAt ?? 0;
    if (!arrivedAt || Date.now() - arrivedAt > FRESH_ARRIVAL_WINDOW_MS) return;
    autoOpenedSceneRef.current = arrivedScene.id;
    router.push(`/scene/${arrivedScene.id}?auto=1`);
  }, [arrivedScene?.id, current?.id, state, router]);

  return (
    <>
      <div className="relative h-[100dvh] w-full overflow-hidden">
        <MapView
          player={fix}
          heading={displayHeading}
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
                onClick={() => void enableHeading()}
                className={`card grid h-[46px] w-[46px] shrink-0 place-items-center text-[18px] ${heading !== null ? "border-amber-400 bg-amber-50" : ""}`}
                aria-label={heading !== null ? "手机朝向指示已启用" : "启用手机朝向指示"}
                title="蓝色尾巴显示手机朝向；蓝色箭头指向目标"
              >
                🧭
              </button>

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
            {headingMessage && heading === null ? (
              <div className="pointer-events-auto mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[12px] leading-snug text-amber-900">{headingMessage}</p>
              </div>
            ) : null}

            {outsideHuntArea ? (
              <div className="pointer-events-auto mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
                <p className="text-[12.5px] leading-snug text-amber-900">
                  你已离开本次寻宝区域，请结合地图回到寻宝范围内。
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
                  尚未开始定位。允许定位后才能显示你的当前位置和目标方向。
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

        {/* Compact task control: keep the map visible during exploration. */}
        <div
          className="absolute inset-x-0 bottom-0 z-[550]"
          style={{ paddingBottom: "calc(12px + var(--tabbar-h) + var(--safe-bottom))" }}
        >
          <div className="page">
            {loading ? (
              <div className="card p-3 text-center text-[13px] text-[var(--muted)]">正在加载游戏数据…</div>
            ) : complete ? (
              <div className="card p-3 shadow-sheet">
                <p className="text-[14px] font-semibold text-emerald-700">🎉 你已走完全部 {statuses.length} 个地点</p>
                <Link href="/bag" className="btn btn-primary btn-block mt-2">查看我的收获</Link>
              </div>
            ) : current ? (
              <section className="card shadow-sheet">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-3 text-left"
                  onClick={() => setTaskExpanded((expanded) => !expanded)}
                  aria-expanded={taskExpanded}
                  aria-label={taskExpanded ? "收起任务详情" : "展开任务详情"}
                >
                  <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-sky-200 bg-sky-50">
                    <div
                      className="absolute inset-0 animate-[spin_2.8s_linear_infinite] opacity-80"
                      style={{
                        background: "conic-gradient(from 0deg, rgba(37,99,235,0.0) 0deg, rgba(37,99,235,0.04) 280deg, rgba(37,99,235,0.24) 330deg, rgba(37,99,235,0.72) 360deg)",
                      }}
                      aria-hidden="true"
                    />
                    <div className="absolute inset-[7px] rounded-full border border-sky-200/80" aria-hidden="true" />
                    <svg
                      viewBox="0 0 40 40"
                      className="relative h-9 w-9 drop-shadow-sm"
                      style={{ transform: "rotate(" + (targetBearing ?? 0) + "deg)" }}
                      role="img"
                      aria-label={targetBearing === null ? "目标方向暂不可用" : "目标方向指示"}
                    >
                      <path d="M20 4 C25 11 29 17 29 23 A9 9 0 0 1 11 23 C11 17 15 11 20 4Z" fill="#60A5FA" opacity="0.35" />
                      <path d="M20 3 L27 24 L20 20 L13 24 Z" fill="#2563EB" stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" />
                      <circle cx="20" cy="21" r="3.2" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold">{current.title}</p>
                  </div>
                  {currentDistance && !currentDistance.inRange ? (
                    <span className="shrink-0 tabular text-[12px] font-semibold text-[var(--muted)]">
                      {formatDistance(currentDistance.distance)}
                    </span>
                  ) : null}
                  {arrivedScene && arrivedScene.id === current.id ? (
                    <span className="chip shrink-0 bg-emerald-100 text-emerald-700">已抵达</span>
                  ) : null}
                  <span className="shrink-0 text-[var(--muted)]" aria-hidden="true">{taskExpanded ? "⌄" : "⌃"}</span>
                </button>

                {taskExpanded ? (
                  <div className="border-t border-[var(--line)] px-3 pb-3 pt-2">
                    <p className="text-[12px] text-[var(--muted)]">{current.location.name ?? "当前目标地点"}</p>
                    <p className="mt-2 text-[13px] leading-snug">
                      {targetBearing === null
                        ? "暂时无法确定目标方向。请确认定位权限，并移动到 GPS 信号较好的开阔位置。"
                        : "蓝色方向指示指向当前目标。请同时观察地图和现场环境；方向会随定位更新，不显示可能不准确的距离数字。"}
                    </p>
                    {fixQuality?.message && !currentDistance?.inRange ? (
                      <p className="mt-2 text-[11.5px] leading-snug text-amber-700">{fixQuality.message}</p>
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
                      <Link href="/quest" className="btn btn-secondary btn-block mt-3">查看任务详情</Link>
                    )}
                    {insideAnyScene && arrivedScene && arrivedScene.id !== current.id ? (
                      <p className="mt-2 text-[11.5px] text-[var(--muted)]">
                        你正在「{arrivedScene.title}」的范围内，但它尚未解锁。先去完成当前目标。
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : (
              <div className="card p-3 text-center text-[13px] text-[var(--muted)]">没有可进行的任务。</div>
            )}
          </div>
        </div>

        {simulatorAvailable ? <SimulatorPanel activeSceneId={current?.id ?? null} /> : null}
      </div>
      <TabBar />
    </>
  );
}


function bearingDegrees(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const toDeg = (value: number) => value * 180 / Math.PI;
  const lat1 = toRad(from.lat), lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
