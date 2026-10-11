"use client";

/**
 * Home - the landing screen.
 *
 * Job: explain the game in one screen, show whether a save exists, and get the
 * player to a hunt. No map, no GPS prompt yet - asking for location before the
 * player knows why is the fastest way to get a permanent denial.
 */

import Link from "next/link";
import { useHunt } from "@/components/hunt-provider";
import { ProgressBar, Screen } from "@/components/ui";
import { useOnlineStatus } from "@/components/providers";

export default function HomePage() {
  const { game, state, loading, loadError, ratio, complete, contentSource, reloadContent } = useHunt();
  const online = useOnlineStatus();

  const hasProgress = Boolean(state && state.inventory.length > 0);

  return (
    <Screen
      title="MOS Scene Hunt"
      subtitle="在真实世界里移动，解锁情境、线索与任务"
      headerRight={
        <span
          className={`chip shrink-0 ${
            online ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
          }`}
        >
          {online ? "在线" : "离线"}
        </span>
      }
    >
      <section className="card overflow-hidden">
        <div className="hero-explore px-5 py-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-signal-soft">
            REAL-WORLD ADVENTURE
          </p>
          <h2 className="mt-2 text-[26px] font-extrabold leading-tight">
            走出去，发现下一条线索
          </h2>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-white/80">
            带上手机，在真实地点寻找线索、完成挑战，一步步解锁故事。
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link href="/games" className="btn min-h-11 flex-1 bg-white text-slate-900 shadow-sm">
              选择游戏开始 <span aria-hidden="true">→</span>
            </Link>
            <Link href="/tutorial" className="btn min-h-11 flex-1 border border-white/30 bg-white/10 text-white">
              <span aria-hidden="true">▶</span> 先看一分钟演示
            </Link>
          </div>
        </div>

        <div className="px-5 pb-5">
          <p className="text-sm font-semibold text-[var(--text)]">仅限户外游玩</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">室内定位可能不稳定。请在安全、开放的户外区域探索。</p>
        </div>
      </section>

      {hasProgress && game ? (
        <section className="card mt-4 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-[var(--muted)]">进行中的寻宝</p>
              <p className="text-[16px] font-semibold">{game.title}</p>
            </div>
            <span className="chip bg-amber-100 text-amber-800">
              {complete ? "已完成" : `${Math.round(ratio * 100)}%`}
            </span>
          </div>
          <ProgressBar ratio={ratio} className="mt-3" />
          <div className="mt-4 flex gap-2">
            <Link href="/map" className="btn btn-primary flex-1">
              继续寻宝
            </Link>
            <Link href="/bag" className="btn btn-secondary">
              背包
            </Link>
          </div>
        </section>
      ) : null}





      <section className="card mt-4 overflow-hidden bsop-reference">
        <div className="bsop-reference__cover">
          {/* Official BSOP handbook thumbnail; the game itself can replace this with licensed field photography later. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://bsop.edu.ph/wp-content/uploads/2026/04/BSOP-Student-Handbook-2025-2026-thumnail.png"
            alt="BSOP 神学院校园资料图"
            className="bsop-reference__image"
          />
          <div className="bsop-reference__overlay">
            <span className="chip bg-white/15 text-white">REFERENCE GAME · 01</span>
          </div>
        </div>
        <div className="p-4">
          <p className="text-[13px] font-semibold">经典案例 · BSOP 神学院</p>
          <h3 className="mt-1 text-[18px] font-bold leading-tight">《神学院的八个秘密》</h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
            八个户外站点、八道轻松的圣经记忆题。找线索、答问题、集齐钥匙，看看你能不能一次通关！
          </p>
          <div className="mt-3 flex gap-2">
            <Link href="/select?game=bsop-eight-secrets" className="btn btn-primary h-10 min-h-0 flex-1 px-3 text-[13px]">
              试玩示范 →
            </Link>
            <Link href="/create" className="btn btn-secondary h-10 min-h-0 px-3 text-[13px]">设计 / 导入</Link>
          </div>
        </div>
      </section>

      <section className="mt-4">
        <h3 className="px-1 text-[13px] font-semibold text-[var(--muted)]">可用寻宝</h3>
        <div className="mt-2 space-y-3">
          {loading ? (
            <div className="card animate-pulse p-4">
              <div className="h-4 w-1/2 rounded bg-[var(--line)]" />
              <div className="mt-2 h-3 w-full rounded bg-[var(--line)]" />
            </div>
          ) : loadError ? (
            <div className="card p-4">
              <p className="text-[14px] font-semibold text-red-700">内容包加载失败</p>
              <p className="mt-1 text-[12px] leading-relaxed text-red-600">{loadError}</p>
              <button
                type="button"
                className="btn btn-secondary mt-3"
                onClick={() => reloadContent(true)}
              >
                重新加载
              </button>
            </div>
          ) : game ? (
            <Link href="/select" className="card block p-4 transition-transform active:scale-[0.99]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold leading-tight">{game.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--muted)]">
                    {game.description}
                  </p>
                </div>
                <span className="chip shrink-0 bg-amber-100 text-amber-800">
                  {game.scenes.length} 站
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip bg-[var(--surface)] text-[11px] text-[var(--muted)]">
                  约 {game.estimatedMinutes ?? 20} 分钟
                </span>
                <span className="chip bg-[var(--surface)] text-[11px] text-[var(--muted)]">
                  {game.language}
                </span>
                {contentSource === "cache" ? (
                  <span className="chip bg-slate-200 text-[11px] text-slate-600">离线缓存</span>
                ) : contentSource === "local" ? (
                  <span className="chip bg-purple-100 text-[11px] text-purple-700">我的创作</span>
                ) : null}
              </div>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="card mt-4 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-xl" aria-hidden="true">✦</div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">想设计自己的游戏？</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">用你平常使用的 AI 帮你想玩法，再导入游戏包。不需要编程，也不需要 MOS Scene Hunt 内置 AI。</p>
            <Link href="/how-to-create" className="btn btn-secondary mt-3 min-h-10 w-full">学习如何设计游戏 →</Link>
          </div>
        </div>
      </section>

    </Screen>
  );
}
