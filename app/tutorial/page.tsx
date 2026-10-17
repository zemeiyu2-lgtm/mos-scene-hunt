"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type DemoStep = {
  eyebrow: string;
  title: string;
  narration: string;
  distance: string;
  phase: string;
  station: number;
};

const STEPS: DemoStep[] = [
  {
    eyebrow: "第 1 步 · 找到地点",
    title: "跟着地图，前往第一站",
    narration: "演示路线设在马尼拉黎刹公园一带。真实游戏会根据手机定位显示距离；本演示只展示流程，不会读取你的 GPS。",
    distance: "第一站",
    phase: "前往地点",
    station: 1,
  },
  {
    eyebrow: "第 2 步 · 完成任务",
    title: "到达后，观察并完成一个小任务",
    narration: "进入地点的触发范围后，任务会解锁。看一看周围的环境，回答一个简单问题，再收下这一站的线索。",
    distance: "第二站",
    phase: "完成任务",
    station: 2,
  },
  {
    eyebrow: "第 3 步 · 前往下一站",
    title: "收集线索，继续探索",
    narration: "完成第三站后，游戏显示探索成果。设计者可以在设计中心安排不同地点、故事和任务；地图点位需要在现场核对。",
    distance: "第三站 · 完成",
    phase: "探索完成",
    station: 3,
  },
];

const MARKERS = [
  { left: "12%", top: "74%" },
  { left: "51%", top: "47%" },
  { left: "82%", top: "25%" },
];

export default function TutorialPage() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [slow, setSlow] = useState(false);
  const current = STEPS[step];
  const marker = MARKERS[step];
  const isMapScene = step >= 0 && step <= 2;
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  useEffect(() => {
    if (!playing || step >= STEPS.length - 1) return;
    const timer = window.setTimeout(() => setStep((value) => Math.min(value + 1, STEPS.length - 1)), slow ? 6500 : 4200);
    return () => window.clearTimeout(timer);
  }, [playing, slow, step]);

  const stepLabel = useMemo(() => `第 ${step + 1} 步，共 ${STEPS.length} 步`, [step]);

  function restart() {
    setStep(0);
    setPlaying(true);
  }

  function previous() {
    setStep((value) => Math.max(0, value - 1));
    setPlaying(false);
  }

  function next() {
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
    setPlaying(false);
  }

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-xl px-4 pb-8 pt-4 text-[var(--text)]">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold text-[var(--muted)]">
          <span aria-hidden="true">←</span> 返回首页
        </Link>
        <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">新手演示</span>
      </header>

      <section className="mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">MOS SCENE HUNT · 3-STOP DEMO</p>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight">三站地图演示</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">约 15 秒看懂三站流程，可暂停或手动推进。</p>
      </section>

      <div role="status" aria-live="polite" className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-950">
        <span className="mt-0.5" aria-hidden="true">ⓘ</span>
        <span><strong>模拟演示，不使用真实 GPS。</strong>地图位置、距离与到达反馈均为预设演示数据，不是 BSOP 实测结果，也不会改动真实游戏进度。</span>
      </div>

      <section className="overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
        <div className="relative min-h-[300px] overflow-hidden bg-[#102b3a] p-4 text-white">
          <div className="absolute inset-0 opacity-30" aria-hidden="true">
            <svg viewBox="0 0 400 320" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
              <path d="M-20 60 C80 30 80 120 160 100 S270 30 430 85" fill="none" stroke="#82b5ad" strokeWidth="18" />
              <path d="M-20 250 C70 180 110 290 190 220 S310 180 430 260" fill="none" stroke="#82b5ad" strokeWidth="24" />
              <path d="M40 -20 C90 80 40 130 100 190 S190 250 180 350" fill="none" stroke="#d7cba6" strokeWidth="11" />
              <path d="M280 -20 C240 80 320 110 270 180 S300 260 340 350" fill="none" stroke="#d7cba6" strokeWidth="9" />
              <path d="M-20 150 L420 150 M200 -20 L200 350" fill="none" stroke="#ffffff" strokeWidth="1" strokeDasharray="4 8" opacity=".45" />
            </svg>
          </div>
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-200">LUNETA · 示例路线</p>
              <p className="mt-1 text-lg font-extrabold">城市公园寻宝</p>
            </div>
            <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold">{current.phase}</span>
          </div>

          {isMapScene ? (
            <div className="relative z-10 mt-3 h-[190px] overflow-hidden rounded-2xl border border-white/10 bg-[#173b4a]/65">\n              <iframe title="马尼拉黎刹公园真实地图" className="absolute inset-0 h-full w-full border-0" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=120.974%2C14.576%2C120.985%2C14.587&layer=mapnik" />
              <svg viewBox="0 0 320 190" className="absolute inset-0 h-full w-full" aria-label="三站示意路线">
                <path d="M25 155 C60 130 78 110 110 96 S170 55 210 53 S260 50 290 25" fill="none" stroke="#d4a65c" strokeWidth="4" strokeLinecap="round" strokeDasharray="6 7" />
                <path d="M10 40 L95 65 L145 20 M130 170 L185 120 L300 140" fill="none" stroke="#9ac1bc" strokeWidth="12" strokeLinecap="round" opacity=".35" />
                <circle cx="210" cy="53" r="22" fill="#f5d77e" opacity=".16" />
                <circle cx="210" cy="53" r="12" fill="#f5d77e" opacity=".28" />
                <circle cx="210" cy="53" r="5" fill="#f5d77e" />
                <text x="220" y="45" fill="#fff3c7" fontSize="10" fontWeight="700">第一站</text>
                <text x="220" y="58" fill="#ffffff" fontSize="8">示意目标</text>
              </svg>
              <div className="absolute z-10 transition-all duration-1000 ease-in-out" style={{ left: marker.left, top: marker.top, transform: "translate(-50%, -50%)" }}>
                <div className="grid h-9 w-9 place-items-center rounded-full border-[3px] border-white bg-teal-300 text-sm font-black text-[#12323e] shadow-lg">你</div>
                <div className="mx-auto mt-1 h-2 w-2 rounded-full bg-teal-200 ring-4 ring-teal-200/20" />
              </div>
              <div className="absolute bottom-2 left-2 rounded-lg bg-black/35 px-2.5 py-1.5 text-[10px] font-semibold backdrop-blur">
                {step >= 2 ? "✦ 三站演示完成" : `↗ 前往${current.distance}`}
              </div>
              <div className="absolute bottom-2 right-2 rounded-lg bg-black/35 px-2.5 py-1.5 text-[9px] text-white/80">真实地图 · 路线为演示</div>
            </div>
          ) : (
            <div className="relative z-10 mt-5 flex min-h-[190px] flex-col justify-center rounded-2xl border border-white/10 bg-white/[0.06] p-5">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-amber-300 text-2xl text-[#102b3a]">✦</div>
              <p className="text-xs font-semibold text-teal-100">三站探索 · 真实地图 · 任务行动</p>
              <p className="mt-2 max-w-xs text-2xl font-extrabold leading-tight">到达地点，完成任务，收集线索。</p>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-[var(--muted)]">{current.eyebrow}</p>
            <p className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{stepLabel}</p>
          </div>
          <h2 className="text-xl font-extrabold leading-snug">{current.title}</h2>
          <p className="mt-3 min-h-[76px] text-sm leading-relaxed text-[var(--muted)]" aria-live="polite">{current.narration}</p>

          {step === 1 ? (
            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <p className="text-xs font-bold text-[var(--muted)]">第二站 · 观察</p>
              <p className="mt-2 text-base font-bold">你在这个地点观察到了什么？</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">观察身边的环境，选择一个你注意到的细节。</p>
              {step === 1 ? <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800">✓ 获得线索：观察</div> : null}
            </div>
          ) : null}

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[var(--muted)]">
              <span>演示进度</span><span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPlaying((value) => !value)} className="btn btn-primary min-h-11">
              {playing ? "Ⅱ 暂停演示" : step === STEPS.length - 1 ? "▶ 继续播放" : "▶ 继续演示"}
            </button>
            <button type="button" onClick={next} disabled={step === STEPS.length - 1} className="btn btn-secondary min-h-11 disabled:cursor-not-allowed disabled:opacity-40">
              下一步 →
            </button>
            <button type="button" onClick={previous} disabled={step === 0} className="btn btn-secondary min-h-11 disabled:cursor-not-allowed disabled:opacity-40">
              ← 上一步
            </button>
            <button type="button" onClick={() => setSlow((value) => !value)} className="btn btn-secondary min-h-11">
              {slow ? "切换正常速度" : "放慢讲解"}
            </button>
          </div>
          <button type="button" onClick={restart} className="mt-2 min-h-10 w-full rounded-xl px-3 text-sm font-semibold text-[var(--muted)] underline underline-offset-4">
            ↻ 从头重播
          </button>
        </div>
      </section>

      {step === STEPS.length - 1 ? (
        <section className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
          <p className="font-extrabold">三站流程，看懂了。</p>
          <p className="mt-1 text-sm leading-relaxed">真实游戏会使用设备定位；请在安全、开放的户外区域游玩。</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Link href="/games" className="btn btn-primary min-h-11 flex-1">进入游戏中心</Link>
            <Link href="/create" className="btn btn-secondary min-h-11 flex-1">进入设计中心</Link>
          </div>
        </section>
      ) : (
        <p className="mt-4 text-center text-xs leading-relaxed text-[var(--muted)]">地图来自 OpenStreetMap；路线与移动为演示动画，不申请定位权限。</p>
      )}
    </main>
  );
}
