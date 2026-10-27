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
import { ArrivalPrompt } from "@/components/arrival-prompt";
import { hasProgressIn, readHuntIndex } from "@/lib/storage";
import {
  arrivalEventKey,
  arrivalTargetKey,
  loadServedArrivals,
  loadServedTargets,
  pruneServedArrivals,
  saveServedArrivals,
  saveServedTargets,
} from "@/lib/game/arrival";
import { decideArrivalPrompt } from "@/lib/game/arrival-decision";
import { activeScene } from "@/lib/game/state";

/** A GPS course heading is only trustworthy while the player is actually moving. */
const GPS_COURSE_MIN_SPEED_MPS = 1;

/**
 * 到站提示的模块级判重状态（跨客户端导航重挂载保留，useRef 做不到）。
 *
 * 键 = 游戏 id + 场景 id + 状态机写入的 arrivedAt；另按「游戏/场景」记一条该目标
 * 最近一次已提示的到达戳。两份记录都持久化到 localStorage，因为整页刷新会清空
 * 模块内存。刷新判定的完整推导见 lib/game/arrival.ts。
 */
let servedArrivals: Map<string, number> | null = null;
let servedTargets: Map<string, number> | null = null;
/**
 * 已做过到站判定的「游戏/场景」。
 *
 * 每个目标在本页文档里的**第一次**判定要单独对待：若加载时就已有存档，那么这次
 * 到达多半是刷新造成的伪事件（见 lib/game/arrival.ts）。之后的判定必然是玩家
 * 真的又走进了触发圈，因此不再抑制。
 */
const evaluatedTargets = new Set<string>();

function getServedArrivals(): Map<string, number> {
  if (!servedArrivals) servedArrivals = loadServedArrivals();
  return servedArrivals;
}

function getServedTargets(): Map<string, number> {
  if (!servedTargets) servedTargets = loadServedTargets();
  return servedTargets;
}

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

  // ---- 到站提示 ------------------------------------------------------
  // 行为变更（本功能）：到站不再把玩家自动带离地图。状态机照旧把场景翻成
  // arrived（解锁条件、到达时间戳都不变），地图就地弹出一张到站卡片，由玩家
  // 自己决定「查看任务」还是「继续查看地图」。自动跳转会先把页面推走，导致
  // 地图上的到达提示根本来不及出现，所以跳转时机整体后移到玩家点击之后。
  //
  // 状态只记「这一次到达是否已提示过」：promptEventKey 指向一个具体的
  // arrivedAt，样式与导航都不由它驱动，关闭它不会改动任何游戏状态。
  const [promptEventKey, setPromptEventKey] = useState<string | null>(null);
  const promptEventKeyRef = useRef<string | null>(null);
  promptEventKeyRef.current = promptEventKey;

  const currentArrivedAt = current ? state?.scenes[current.id]?.arrivedAt : undefined;
  const currentId = current?.id ?? null;
  const arrivedNow = Boolean(currentId && arrivedScene && arrivedScene.id === currentId);
  const gameId = game?.id;

  // 本页文档「加载那一刻」的快照，到站判重全靠它区分「刷新」与「真的又走到」：
  //  - persistedStatusRef / persistedArrivalRef：加载时该场景的 status 与
  //    arrivedAt。reconcileState 会把 arrived 翻回 locked 但保留 arrivedAt，
  //    而这个戳随后会被状态机用新戳覆盖，所以必须趁早记下来。status 是「加载时
  //    玩家是否已经站在圈里」的直接证据，比猜时间差可靠得多。
  //  - hadProgressOnLoadRef：加载前是否已有真实进度（见 lib/storage 的
  //    hasProgressIn）。全新开局为 false；刷新、切换游戏后回来、从游戏中心进入
  //    已有存档的一局都为 true。
  const persistedArrivalRef = useRef<{ gameId: string; sceneId: string; status: string | undefined; arrivedAt: number | undefined } | null>(null);
  const hadProgressOnLoadRef = useRef(false);
  const snapshotGameIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || !gameId || !game) return;
    if (snapshotGameIdRef.current === gameId) return;
    snapshotGameIdRef.current = gameId;
    // 快照必须针对「页面此刻面对的目标场景」，而不是 state.currentSceneId：
    // 后者只在玩家进入情境页后才写入，走到触发圈时会话里可能一直是 null
    // （实测存档 currentSceneId 为 null 而 scene-a 已 arrived）。
    const activeId = activeScene(game, state)?.id ?? null;
    const persistedArrivedAt = activeId ? state.scenes[activeId]?.arrivedAt : undefined;
    const persistedStatus = activeId ? state.scenes[activeId]?.status : undefined;
    persistedArrivalRef.current = { gameId, sceneId: activeId ?? "", status: persistedStatus, arrivedAt: persistedArrivedAt };
    // 存档索引只由本 provider 的保存副作用写入，用它区分「这一局之前真的玩过」
    // 与「存档键已存在但从未离开起点」——启动页和游戏中心自己也可能建索引/存档。
    const inIndex = readHuntIndex().some((entry) => entry.gameId === gameId);
    hadProgressOnLoadRef.current = inIndex || hasProgressIn(state, gameId);
  }, [state, game, gameId]);

  useEffect(() => {
    if (!currentId || !arrivedNow) return;
    // 已为本事件弹过：GPS 抖动 / 重渲染 / 重挂载都停在这里。
    const key = arrivalEventKey(gameId, currentId, currentArrivedAt);
    if (!key || key === promptEventKeyRef.current) return;
    const now = Date.now();
    const served = getServedArrivals();
    const targets = getServedTargets();
    const targetKey = arrivalTargetKey(gameId, currentId);
    const snapshot = persistedArrivalRef.current;
    const snapshotMatches = Boolean(snapshot && snapshot.gameId === gameId && snapshot.sceneId === currentId);
    const persistedArrivedAt = snapshotMatches ? snapshot?.arrivedAt : undefined;
    const persistedStatus = snapshotMatches ? snapshot?.status : undefined;
    const firstEvaluation = Boolean(targetKey) && !evaluatedTargets.has(targetKey as string);
    if (targetKey) evaluatedTargets.add(targetKey);

    const announced = decideArrivalPrompt({
      gameId,
      sceneId: currentId,
      arrivedAt: currentArrivedAt,
      now,
      lastServed: served,
      persistedStatus,
      persistedArrivedAt,
      hadProgressOnLoad: hadProgressOnLoadRef.current,
      targetServedAt: targetKey ? targets.get(targetKey) : undefined,
      firstEvaluation,
    });
    if (!announced) return;

    served.set(key, now);
    pruneServedArrivals(served, now);
    saveServedArrivals(served, now);
    if (targetKey && currentArrivedAt) {
      targets.set(targetKey, currentArrivedAt);
      saveServedTargets(targets, now);
    }
    setPromptEventKey(key);
  }, [currentId, arrivedNow, currentArrivedAt, gameId]);

  // 只在这张提示对应的仍是当前目标时显示；目标推进后旧提示自动让位。
  const promptScene = promptEventKey && current ? current : null;

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

  // ---- 问题 3（已被本功能取代）：到达后不再自动跳转情境页 -------------
  // 旧实现：新鲜到达 → router.push(`/scene/${id}?auto=1`)，情境页再自动进挑战。
  // 它有三个副作用：地图上的到站反馈来不及出现；玩家被弹离地图后回不去；
  // 只能靠「同场景 60 秒冷却」兜住重挂载，跨游戏切换时容易误挡。
  // 现在改由上面的 promptEventKey + 玩家显式点击驱动（见 ArrivalPrompt），
  // 情境页仍然兼容 ?auto=1（分享/深链保持可用），只是地图不再主动带这个参数。
  const openArrivedScene = () => {
    if (!current) return;
    setPromptEventKey(null);
    router.push(`/scene/${current.id}`);
  };

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

            {status === "requesting" && !fix ? (
              // 首次定位等待中：此前这里完全空白，弱 GPS（室内/高楼间）可能
              // 长时间停在 requesting，玩家得不到任何反馈（雷达探针 N0 防的
              // 就是这种空白等待态）。
              <div className="pointer-events-auto mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[12.5px] leading-snug text-amber-900">
                  正在获取定位……首次定位可能需要几秒钟，请在开阔位置稍候。
                </p>
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
                      <path d="M20 4 C25 11 29 17 29 23 A9 9 0 0 1 11 23 C11 17 15 11 20 4Z" style={{ fill: "var(--nav-blue-soft)" }} opacity="0.35" />
                      <path d="M20 3 L27 24 L20 20 L13 24 Z" style={{ fill: "var(--nav-blue-deep)" }} stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" />
                      <circle cx="20" cy="21" r="3.2" fill="#FFFFFF" style={{ stroke: "var(--nav-blue-deep)" }} strokeWidth="1.5" />
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
                        : "蓝色方向指示指向当前目标。请同时观察地图和现场环境；方向会随定位更新，卡片上的距离为 GPS 估算值，仅供参考。"}
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

        {/* 到站提示：居中叠在地图中部，避开顶部 HUD 与底部任务卡。
            不传精确距离：GPS 精度（±20-65 m 常见）远大于触发圈（15-30 m），
            具体米数不可靠，卡片保持定性描述。 */}
        {promptScene ? (
          <ArrivalPrompt
            sceneTitle={promptScene.title}
            placeName={promptScene.location.name ?? null}
            onViewTask={openArrivedScene}
            onDismiss={() => setPromptEventKey(null)}
          />
        ) : null}

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
