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
import { useState } from "react";

export default function HomePage() {
  const { game, state, loading, loadError, ratio, complete, contentSource, reloadContent } = useHunt();
  const online = useOnlineStatus();
  const [coverFailed, setCoverFailed] = useState(false);
  const [demoStep, setDemoStep] = useState(0);

  const hasProgress = Boolean(state && state.inventory.length > 0);

  return (
    <Screen
      title="MOS Scene Hunt"
      subtitle="走进真实地点，发现隐藏线索"
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
          <p className="game-kicker">
            EXPLORE YOUR WORLD
          </p>
          <h2 className="mt-2 text-[22px] font-bold leading-tight">
            走进真实地点
            <br />
            发现线索 · 完成任务 · 带走行动
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-white/75">
            走出去，发现身边不一样的故事。
          </p>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[11px] font-bold tracking-[0.14em] text-[var(--island-green)]">30 秒体验</p><h3 className="mt-1 text-[17px] font-bold">一场寻宝怎样开始？</h3></div>
            <span className="chip bg-amber-100 text-amber-800">演示模式</span>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            <div className="relative flex min-h-[154px] items-center justify-center overflow-hidden bg-gradient-to-br from-[#dcebe2] via-[#e9e5cb] to-[#c5ded7] p-4">
              <div className="absolute inset-0 opacity-30" aria-hidden="true" style={{backgroundImage:"linear-gradient(35deg, transparent 46%, #8bb4a2 47%, #8bb4a2 49%, transparent 50%),linear-gradient(125deg, transparent 42%, #8bb4a2 43%, #8bb4a2 45%, transparent 46%)",backgroundSize:"72px 62px"}} />
              <div className="relative z-10 grid w-full max-w-[280px] grid-cols-3 items-center gap-2">
                {["发现地点","找到线索","完成任务"].map((label, index) => (
                  <button key={label} type="button" onClick={() => setDemoStep(index)} className={`rounded-xl border px-2 py-3 text-center transition ${demoStep === index ? "border-[#173b5e] bg-[#173b5e] text-white shadow-md" : "border-white/80 bg-white/85 text-[#173b5e]"}`}>
                    <span className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full bg-[#f4bd45] text-sm font-bold text-[#17324a]">{index + 1}</span><span className="block text-[11px] font-semibold">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3">
              <p className="text-[14px] font-semibold">{["① 发现一个地点","② 观察周围，寻找线索","③ 完成任务，获得下一步提示"][demoStep]}</p>
              <p className="mt-1 min-h-[36px] text-[12px] leading-relaxed text-[var(--muted)]">{["地图会标出探索目标。真正游玩时，定位只用于辅助判断是否到达。","到达地点后，由你主动打开任务；观察、阅读或寻找现场细节。","完成后获得反馈，再决定是否前往下一站。此处为可点击演示，不会请求 GPS。"][demoStep]}</p>
              <div className="mt-3 flex items-center justify-between gap-2"><span className="text-[10px] text-[var(--muted)]">点击上方步骤查看</span><button type="button" className="btn btn-secondary h-9 min-h-0 px-3 text-[12px]" onClick={() => setDemoStep((demoStep + 1) % 3)}>下一步 →</button></div>
            </div>
          </div>
        </div>
      </section>

      <section className="card mt-4 overflow-hidden bsop-reference">
        <div className="bsop-reference__cover">
          <div className="bsop-reference__cover culture-cover" aria-label="菲律宾文化灵感图形封面">
            <div className="culture-cover__sun" aria-hidden="true" />
            <svg className="culture-cover__mark" viewBox="0 0 240 120" role="img" aria-label="星辰与岛屿路径图形">
              <path d="M22 84 C55 38 83 100 118 61 S184 31 218 65" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 8" opacity=".8" />
              <path d="M36 72 L41 85 L55 86 L44 95 L48 109 L36 101 L24 109 L28 95 L17 86 L31 85 Z" fill="#f4bd45" />
              <circle cx="118" cy="61" r="7" fill="#fff8e8" stroke="#173b5e" strokeWidth="3" />
              <circle cx="218" cy="65" r="5" fill="#e77b5d" stroke="#fff8e8" strokeWidth="2" />
              <path d="M87 26 L92 38 L105 39 L95 47 L98 60 L87 53 L76 60 L79 47 L69 39 L82 38 Z" fill="#fff8e8" opacity=".95" />
              <path d="M158 75 l8 -10 l8 10 l-8 10 Z M174 75 l8 -10 l8 10 l-8 10 Z" fill="none" stroke="#fff8e8" strokeWidth="2" opacity=".75" />
            </svg>
            <div className="culture-cover__label">
              <span>CLASSIC GAME · 01</span>
              <strong>神学院的八个秘密</strong>
              <small>一段从真实地点开始的探索</small>
            </div>
          </div>
        <div className="p-4">
          <p className="text-[11px] font-bold tracking-[0.12em] text-[var(--island-green)]">经典模板 · 01</p>
          <h3 className="mt-1 text-[18px] font-bold leading-tight">《神学院的八个秘密》</h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
            用八个地点串起一段真实探索，发现线索，完成任务。
            
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/select?game=bsop-eight-secrets" className="btn btn-primary h-11 min-h-0 px-3 text-[13px]">
              开始探索
            </Link>
            <Link href="/design" className="btn btn-secondary h-11 min-h-0 px-3 text-[13px]">
              创作游戏
            </Link>
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
        <h3 className="px-1 text-[13px] font-semibold text-[var(--muted)]">开始探索</h3>
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
        <p className="text-[13px] font-semibold">安全提示</p>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <li>· 只在允许进入的户外区域游玩，留意交通与周围环境。</li>
          <li>· 定位用于辅助判断；定位不准时请按现场提示操作。</li>
        </ul>
        <div className="mt-3">
          <SimulatorUnavailableNotice />
        </div>
      </section>
    </Screen>
  );
}
