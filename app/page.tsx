"use client";

import Link from "next/link";
import { useHunt } from "@/components/hunt-provider";
import { Screen } from "@/components/ui";
import { useOnlineStatus } from "@/components/providers";
import { MapView } from "@/components/map-view";
import { RIZAL_PARK_TEMPLATE } from "@/lib/game/templates";
import { DEFAULT_GAME_ID } from "@/lib/content";
import type { MapSceneEntry } from "@/components/game-map";
import type { PositionFix } from "@/lib/location";

export default function HomePage() {
  const { game, state, loading, loadError, ratio, complete, contentSource, reloadContent } = useHunt();
  const online = useOnlineStatus();
  const previewGame = RIZAL_PARK_TEMPLATE;
  const previewPlayer: PositionFix = { lat: 14.58305, lng: 120.97936, accuracy: 12, timestamp: 0, simulated: true };
  const previewEntries: MapSceneEntry[] = previewGame.scenes.map((scene, index) => ({
    scene, status: index === 0 ? "available" : "locked", isActive: index === 0, distance: null, inRange: false,
  }));

  // The reducer's currentSceneId is a navigation pointer, not necessarily
  // the scene whose challenge is currently open. Prefer active progress facts.
  const challengingSceneId = game?.scenes.find(
    (scene) => state?.scenes[scene.id]?.status === "challenging",
  )?.id ?? null;
  const arrivedSceneId = game?.scenes.find(
    (scene) => state?.scenes[scene.id]?.status === "arrived",
  )?.id ?? null;
  const currentSceneId =
    challengingSceneId ?? arrivedSceneId ?? state?.currentSceneId ?? null;
  const currentSceneStatus = currentSceneId ? state?.scenes[currentSceneId]?.status : null;
  const hasProgress = Boolean(
    state &&
      (state.currentSceneId !== null ||
        state.inventory.length > 0 ||
        Object.values(state.scenes).some((scene) => scene.status === "completed" || scene.status === "challenging" || scene.status === "arrived")),
  );
  const progressPercent = Math.round(ratio * 100);
  const actionHref = complete
    ? "/bag"
    : currentSceneId && currentSceneStatus === "challenging"
      ? `/challenge/${encodeURIComponent(currentSceneId)}`
      : currentSceneId && currentSceneStatus === "arrived"
        ? `/scene/${encodeURIComponent(currentSceneId)}`
        : hasProgress
          ? "/map"
          : "/select";
  const actionLabel = loading
    ? "正在恢复游戏…"
    : loadError
      ? "重新加载游戏"
      : complete
        ? "查看探索成果"
        : currentSceneStatus === "challenging"
          ? "继续当前任务"
          : currentSceneStatus === "arrived"
            ? "继续当前情境"
            : hasProgress
              ? "继续探索"
              : "开始探索";
  // Single source of truth for progress status, shown next to the CTA.
  const statusLabel = loadError
    ? "加载失败"
    : complete
      ? "已完成"
      : hasProgress
        ? `${progressPercent}% 已探索`
        : "等待你的第一步";

  /**
   * 演示地图只在「第一次来、且当前就是内置演示包」时出现。
   *
   * - `loading` 期间不判断：那时存档还没水合，任何基于进度的判断都会先错一次，
   *   宁可暂时留白，也不闪出一张与玩家无关的地图。
   * - `loadError` 时不出现：加载失败时更不该用别的地图占用首屏。
   * - 有进度即隐藏；不是内置演示包（本机创作 / 分享进来的游戏）也隐藏——
   *   固定演示图和玩家族的游戏无关，留着只会挤占首屏。
   *
   * 注意：演示图来自 RIZAL_PARK_TEMPLATE（id 为 rizal-park-discovery），与内置
   * 游戏包 demo-hunt 不是同一个 id，不能用两者相等来判断。
   */
  const showDemoMap =
    !loading && !loadError && !hasProgress && game?.id === DEFAULT_GAME_ID;

  return (
    <Screen
      title="MOS Scene Hunt"
      headerRight={
        <span className={`chip shrink-0 ${online ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
          {online ? "在线" : "离线"}
        </span>
      }
    >
      {/* 首屏重点：地图演示 + 主操作 */}
      <section className="card overflow-hidden">
        <div className="relative overflow-hidden bg-[linear-gradient(145deg,#173f3b_0%,#27665c_55%,#d6ad67_140%)] px-4 pb-4 pt-4 text-white">
          {game ? (
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className="truncate font-semibold">{game.title}</span>
              <span className="shrink-0 rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/90">
                {statusLabel}
              </span>
            </div>
          ) : null}
          {showDemoMap ? (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/15 bg-[#f4ead4]">
              <div className="relative h-[230px] w-full">
                <MapView player={previewPlayer} entries={previewEntries} huntArea={previewGame.huntArea} tileProvider="osm" fitToHunt />
              </div>
            </div>
          ) : null}
          <div className="mt-3 rounded-2xl bg-white p-2 text-[#173f3b] shadow-sm">
            {loadError ? (
              <button type="button" className="btn btn-primary w-full" onClick={() => reloadContent(true)}>
                重新加载游戏
              </button>
            ) : (
              <Link href={loading ? "#" : actionHref} aria-disabled={loading} className={`btn btn-primary flex w-full items-center justify-center gap-2 ${loading ? "pointer-events-none opacity-60" : ""}`}>
                {actionLabel}<span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
          {hasProgress && !complete ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-[#f5c26b] transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          ) : null}
        </div>
        <div className="flex items-start gap-2 px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
          <span aria-hidden="true">ⓘ</span>
          <p>请在安全、开放的户外区域游玩。GPS 在室内或高楼附近可能不够准确。</p>
        </div>
      </section>

      {loading ? (
        <section className="card mt-3 animate-pulse p-4">
          <div className="h-4 w-1/2 rounded bg-[var(--line)]" />
          <div className="mt-2 h-3 w-full rounded bg-[var(--line)]" />
        </section>
      ) : loadError ? (
        <section className="card mt-3 p-4">
          <p className="text-[14px] font-semibold text-red-700">游戏内容加载失败</p>
          <p className="mt-1 text-[12px] leading-relaxed text-red-600">{loadError}</p>
          <button type="button" className="btn btn-secondary mt-3 w-full" onClick={() => reloadContent(true)}>重试加载</button>
        </section>
      ) : null}

      {/* 次级入口：降权为紧凑文字按钮 */}
      <section className="mt-4">
        <div className="grid grid-cols-2 gap-3">
          <Link href="/games" className="flex items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 text-[13px] font-semibold text-[var(--muted)] transition-colors active:bg-[var(--surface)]">
            <span aria-hidden="true" className="text-[14px]">◇</span>游戏中心
          </Link>
          <Link href="/design" className="flex items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 text-[13px] font-semibold text-[var(--muted)] transition-colors active:bg-[var(--surface)]">
            <span aria-hidden="true" className="text-[14px]">✦</span>创作中心
          </Link>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <Link href="/how-to-create" className="inline-flex items-center gap-1 py-2 text-xs font-medium text-[var(--muted)]">创作说明 <span aria-hidden="true">→</span></Link>
          {/* 完成态的「查看探索成果」已经指向 /bag，这里不再重复同一入口。 */}
          {hasProgress && !complete ? (
            <Link href="/bag" className="inline-flex items-center gap-1 py-2 text-xs font-medium text-[var(--muted)]">背包与线索 <span aria-hidden="true">→</span></Link>
          ) : null}
        </div>
      </section>

      {contentSource === "cache" ? (
        <p className="mt-3 text-center text-[11px] text-[var(--muted)]">当前使用离线缓存内容</p>
      ) : contentSource === "local" ? (
        <p className="mt-3 text-center text-[11px] text-[var(--muted)]">当前使用本机创作的游戏</p>
      ) : null}
    </Screen>
  );
}
