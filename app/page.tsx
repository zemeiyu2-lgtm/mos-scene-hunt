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
import { SimulatorUnavailableNotice } from "@/components/simulator-panel";
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
            V0.4 · Micro Designer
          </p>
          <h2 className="mt-2 text-[22px] font-bold leading-tight">
            现实移动 → GPS → 地点触发
            <br />
            情境 → 任务 → 奖励 → 下一地点
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-white/75">
            不是坐着答题，而是走进真实地点。你会发现线索、做出选择，并把游戏里的一个决定带回现实。
          </p>
        </div>

        <div className="p-5">
          <div className="game-route mb-4"><span>探索</span><i>→</i><span>选择</span><i>→</i><span>行动</span><i>→</i><span>反思</span><i>→</i><span>带走</span></div>

          <ol className="space-y-2.5">
            {[
              "允许浏览器获取你的位置",
              "在地图上看到自己与目标地点",
              "走进目标地点约 50 米的范围内",
              "情境自动解锁，回答问题",
              "获得关键词，解锁下一个地点",
            ].map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-[#3a2400]">
                  {i + 1}
                </span>
                <span className="text-[14px] leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="card mt-4 overflow-hidden">
        <div className="relative overflow-hidden bg-[#101d38] px-5 py-6 text-white">
          <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full border border-white/10" />
          <div className="absolute -right-2 top-0 h-24 w-24 rounded-full border border-white/10" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-white/80">
                REFERENCE GAME · 01
              </span>
              <span className="text-[11px] font-semibold text-white/55">08 STATIONS</span>
            </div>
            <div className="mt-5 flex items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-4xl shadow-inner">
                👁️
              </div>
              <div>
                <p className="text-[11px] font-semibold tracking-[0.12em] text-white/55">BSOP · REAL-WORLD HUNT</p>
                <h3 className="mt-1 text-[22px] font-extrabold leading-tight">《神学院的八个秘密》</h3>
                <p className="mt-1 text-[12px] text-white/65">呼召 → 真理 → 实践 → 群体 → 生命 → 使命</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-4 gap-1.5 text-center text-[10px] font-semibold text-white/60">
              <span className="rounded-lg bg-white/8 py-2">01 呼召</span>
              <span className="rounded-lg bg-white/8 py-2">02 真理</span>
              <span className="rounded-lg bg-white/8 py-2">03 实践</span>
              <span className="rounded-lg bg-white/8 py-2">08 差派</span>
            </div>
          </div>
        </div>
        <div className="p-4">
          <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">
            走进真实地点，找到八个现场，让一次移动成为一次生命反思。
          </p>
          <div className="mt-3 flex gap-2">
            <Link href="/intro?game=bsop-eight-secrets" className="btn btn-primary h-10 min-h-0 flex-1 px-3 text-[13px]">
              试玩示范 →
            </Link>
            <Link href="/create" className="btn btn-secondary h-10 min-h-0 px-3 text-[13px]">设计 / 导入</Link>
          </div>
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold">🎮 游戏中心</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">从官方云端游戏库选择游戏，下载到本机后直接游玩。</p>
          </div>
          <Link href="/games" className="btn btn-primary shrink-0">进入</Link>
        </div>
      </section>

      <section className="card mt-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold">📦 游戏包中心</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">设计者负责制作游戏包；玩家平台负责导入、安装和游玩。两者可以完全分开。</p>
          </div>
          <Link href="/create" className="btn btn-secondary shrink-0">打开</Link>
        </div>
      </section>

      <section className="card mt-4 p-4">
        <p className="text-[13px] font-semibold">开始前请确认</p>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <li>· 请在有网络的环境下首次打开，游戏数据会被缓存到本地。</li>
          <li>· 之后即使断网，只要 GPS 可用，游戏仍可继续。</li>
          <li>· 请在户外开阔处游玩，注意周围交通与安全。</li>
        </ul>
        <div className="mt-3">
          <SimulatorUnavailableNotice />
        </div>
      </section>
    </Screen>
  );
}
