"use client";

import Link from "next/link";
import { useHunt } from "@/components/hunt-provider";
import { Screen } from "@/components/ui";
import { useOnlineStatus } from "@/components/providers";

export default function HomePage() {
  const { game, state, loading, loadError, ratio, complete, contentSource, reloadContent } = useHunt();
  const online = useOnlineStatus();

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
            下一条线索，<br />就在真实世界里。
          </h2>
          <p className="mt-2 max-w-[19rem] text-[13px] leading-relaxed text-white/80">
            带上手机，沿着地图探索地点、发现故事、完成任务。
          </p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/15 bg-[#f4ead4]">
            <svg viewBox="0 0 640 300" role="img" aria-label="山丘、树木与探索路线组成的插画地图" className="block h-auto w-full">
              <rect width="640" height="300" fill="#f4ead4" />
              <path d="M0 65 Q95 15 190 70 T390 58 T640 42 V0 H0Z" fill="#e7d6b2" />
              <path d="M0 188 Q110 130 215 182 T420 164 T640 184 V300 H0Z" fill="#b8c9a0" />
              <path d="M0 235 Q125 190 250 236 T480 220 T640 228 V300 H0Z" fill="#8fae88" />
              <path d="M-10 245 C95 255 95 125 220 146 S350 260 435 196 S545 88 660 120" fill="none" stroke="#fffaf0" strokeWidth="22" strokeLinecap="round" />
              <path d="M-10 245 C95 255 95 125 220 146 S350 260 435 196 S545 88 660 120" fill="none" stroke="#d4a65c" strokeWidth="3" strokeDasharray="5 10" strokeLinecap="round" />
              <g fill="#426d50">
                <path d="M68 102 l-23 38 h46z" /><path d="M68 122 l-29 42 h58z" /><rect x="64" y="160" width="8" height="15" rx="2" />
                <path d="M520 175 l-25 40 h50z" /><path d="M520 196 l-32 44 h64z" /><rect x="516" y="236" width="8" height="13" rx="2" />
                <path d="M570 58 l-18 30 h36z" /><path d="M570 76 l-24 34 h48z" /><rect x="566" y="108" width="8" height="12" rx="2" />
              </g>
              <g transform="translate(220 146)">
                <circle r="20" fill="#fffaf0" stroke="#d4a65c" strokeWidth="4" />
                <path d="M0 -10 L3 -2 L11 0 L3 3 L0 11 L-3 3 L-11 0 L-3 -2Z" fill="#b77935" />
              </g>
              <g transform="translate(435 196)">
                <circle r="18" fill="#fffaf0" stroke="#28685d" strokeWidth="4" />
                <path d="M0 -8 L8 0 L0 8 L-8 0Z" fill="#28685d" />
              </g>
              <g transform="translate(565 111)">
                <path d="M0 -22 L18 -5 L12 18 L-12 18 L-18 -5Z" fill="#b77935" stroke="#fffaf0" strokeWidth="4" />
                <path d="M-7 -2 H7 M0 -9 V7" stroke="#fffaf0" strokeWidth="3" strokeLinecap="round" />
              </g>
              <g fill="#fffaf0" opacity=".85">
                <circle cx="132" cy="73" r="3" /><circle cx="152" cy="91" r="2" /><circle cx="384" cy="92" r="3" /><circle cx="470" cy="61" r="2" /><circle cx="305" cy="70" r="2" />
              </g>
            </svg>
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
        <h3 className="px-1 text-[12px] font-semibold text-[var(--muted)]">更多玩法与工具</h3>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Link href="/tutorial" className="card p-4 transition-transform active:scale-[0.99]">
            <span className="text-xl" aria-hidden="true">▷</span>
            <p className="mt-2 text-[14px] font-bold">一分钟演示</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">先看看怎么玩</p>
          </Link>
          <Link href="/select" className="card p-4 transition-transform active:scale-[0.99]">
            <span className="text-xl" aria-hidden="true">⌖</span>
            <p className="mt-2 text-[14px] font-bold">选择游戏</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">寻找新的探索</p>
          </Link>
          <Link href="/games" className="card p-4 transition-transform active:scale-[0.99]">
            <span className="text-xl" aria-hidden="true">◇</span>
            <p className="mt-2 text-[14px] font-bold">游戏中心</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">浏览可用游戏</p>
          </Link>
          <Link href="/create" className="card p-4 transition-transform active:scale-[0.99]">
            <span className="text-xl" aria-hidden="true">✦</span>
            <p className="mt-2 text-[14px] font-bold">创作 / 导入</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">设计自己的游戏</p>
          </Link>
        </div>
        {game ? (
          <Link href="/select?game=bsop-eight-secrets" className="card mt-3 flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-[13px] font-semibold">经典示范 ·《神学院的八个秘密》</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">八个地点、八道轻松任务，体验完整探索闭环。</p>
            </div>
            <span className="shrink-0 text-sm font-bold text-[var(--accent)]">试玩 →</span>
          </Link>
        ) : null}
      </section>

      {contentSource === "cache" ? (
        <p className="mt-4 text-center text-[11px] text-[var(--muted)]">当前使用离线缓存内容</p>
      ) : contentSource === "local" ? (
        <p className="mt-4 text-center text-[11px] text-[var(--muted)]">当前使用本机创作的游戏</p>
      ) : null}
    </Screen>
  );
}
