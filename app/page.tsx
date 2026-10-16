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
          <p className="game-kicker">
            V0.4 · Micro Designer
          </p>
          <h2 className="mt-2 text-[22px] font-bold leading-tight">
            走进真实地点
            <br />
            发现线索 · 完成任务 · 带走行动
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-white/75">
            一场手机里的真实世界探索。观察周围、寻找线索、完成任务，再把一个小小的行动带回生活。
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
          {/* Official BSOP handbook thumbnail; the game itself can replace this with licensed field photography later. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {!coverFailed ? (
            <img
              src="https://bsop.edu.ph/wp-content/uploads/2026/04/BSOP-Student-Handbook-2025-2026-thumnail.png"
              alt="BSOP 神学院校园资料图"
              className="bsop-reference__image"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div className="bsop-reference__image grid place-items-center bg-gradient-to-br from-[#172b49] via-[#2c5368] to-[#4d8279]">
              <div className="px-6 text-center text-white">
                <p className="text-[11px] font-bold tracking-[0.2em] text-amber-300">MOS SCENE HUNT · CLASSIC 01</p>
                <p className="mt-3 text-[25px] font-bold leading-tight">神学院的<br />八个秘密</p>
                <p className="mt-2 text-[12px] text-white/75">从真实地点开始一段探索旅程</p>
              </div>
            </div>
          )}
          <div className="bsop-reference__overlay">
            <span className="chip bg-white/15 text-white">REFERENCE GAME · 01</span>
          </div>
        </div>
        <div className="p-4">
          <p className="text-[13px] font-semibold">经典案例 · BSOP 神学院</p>
          <h3 className="mt-1 text-[18px] font-bold leading-tight">《神学院的八个秘密》</h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
            不是把新功能堆在模板上，而是让图片、官方资料、声音、GPS 与任务共同服务一条生命形成路线：
            <span className="font-semibold text-[var(--text)]"> 呼召 → 真理 → 实践 → 敬拜 → 群体 → 生命 → 忠心 → 使命</span>。
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
