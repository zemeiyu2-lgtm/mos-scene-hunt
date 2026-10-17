"use client";

import Link from "next/link";
import { useHunt } from "@/components/hunt-provider";
import { Screen } from "@/components/ui";
import { useOnlineStatus } from "@/components/providers";
import { MapView } from "@/components/map-view";
import { RIZAL_PARK_TEMPLATE } from "@/lib/game/templates";
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

  return (
    <Screen
      title="MOS Scene Hunt"
      subtitle="把现实世界变成一场探索游戏"
      headerRight={
        <span className={`chip shrink-0 ${online ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
          {online ? "在线" : "离线"}
        </span>
      }
    >
      <section className="card overflow-hidden">
        <div className="relative overflow-hidden bg-[linear-gradient(145deg,#173f3b_0%,#27665c_55%,#d6ad67_140%)] px-5 pb-5 pt-5 text-white">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/90">
              Explore · Discover · Play
            </span>
            <span className="text-[11px] text-white/70">{game ? `${game.scenes.length} 个地点` : "GPS 探索游戏"}</span>
          </div>
          <h2 className="mt-4 max-w-[18rem] text-[25px] font-extrabold leading-tight">
            发现身边的惊喜
          </h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/15 bg-[#f4ead4]">
            <div className="relative h-[210px] w-full">
              <MapView player={previewPlayer} entries={previewEntries} huntArea={previewGame.huntArea} tileProvider="osm" fitToHunt />
              <div className="pointer-events-none absolute bottom-2 left-2 z-[700] rounded-full border border-white/70 bg-[#173f3b]/90 px-3 py-1 text-[10px] font-semibold text-white shadow">真实地图 · 寻宝路线示意</div>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-white p-2 text-[#173f3b] shadow-sm">
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
          {game ? (
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-white/75">
              <span className="truncate">{game.title}</span>
              <span className="shrink-0">{complete ? "已完成" : hasProgress ? `${Math.round(ratio * 100)}% 已探索` : "等待你的第一步"}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-start gap-2 px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
          <span aria-hidden="true">ⓘ</span>
          <p>请在安全、开放的户外区域游玩。GPS 在室内或高楼附近可能不够准确。</p>
        </div>
      </section>

      {hasProgress && game ? (
        <section className="card mt-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--muted)]">当前游戏</p>
              <p className="truncate text-[15px] font-semibold">{game.title}</p>
            </div>
            <span className="chip shrink-0 bg-amber-100 text-amber-800">{complete ? "已完成" : `${Math.round(ratio * 100)}%`}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--line)]">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
          <Link href="/bag" className="btn btn-secondary mt-3 w-full">查看背包与已获线索</Link>
        </section>
      ) : null}

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

      <section className="mt-4">
        <div className="grid grid-cols-2 gap-3">
          <Link href="/games" className="card border-[var(--line)] bg-gradient-to-br from-sky-50 to-white p-4 transition-transform active:scale-[0.99]"><span className="text-xl" aria-hidden="true">◇</span><p className="mt-2 text-[14px] font-bold">游戏中心</p></Link>
          <Link href="/design" className="card border-[var(--line)] bg-gradient-to-br from-violet-50 to-white p-4 transition-transform active:scale-[0.99]"><span className="text-xl" aria-hidden="true">✦</span><p className="mt-2 text-[14px] font-bold">创作中心</p></Link>
        </div>
        <Link href="/how-to-create" className="mt-3 inline-flex items-center gap-1 px-1 py-2 text-xs font-medium text-[var(--muted)]">创作说明 <span aria-hidden="true">→</span></Link>
      </section>

      {contentSource === "cache" ? (
        <p className="mt-4 text-center text-[11px] text-[var(--muted)]">当前使用离线缓存内容</p>
      ) : contentSource === "local" ? (
        <p className="mt-4 text-center text-[11px] text-[var(--muted)]">当前使用本机创作的游戏</p>
      ) : null}
    </Screen>
  );
}
