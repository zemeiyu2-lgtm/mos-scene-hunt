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
    eyebrow: "第 1 幕 · 认识游戏",
    title: "欢迎来到 BSOP 的八个秘密",
    narration: "这是一场把真实地点、观察、选择和行动连在一起的探索。接下来，系统会自动演示一小段完整流程。",
    distance: "准备出发",
    phase: "开始",
    station: 1,
  },
  {
    eyebrow: "第 2 幕 · 接近目标",
    title: "地图告诉你下一步往哪里走",
    narration: "黄色路线和站点标记是游戏安排的目标。人物标记代表演示中的玩家；它会自动移动，不会读取你的 GPS。",
    distance: "82 米",
    phase: "前往地点",
    station: 1,
  },
  {
    eyebrow: "第 3 幕 · 距离变化",
    title: "越接近目标，距离就越短",
    narration: "在真实游戏中，这个距离来自手机定位。现在我们用预设数值演示同样的界面，让你不用出门也能学习操作。",
    distance: "51 米",
    phase: "继续前进",
    station: 1,
  },
  {
    eyebrow: "第 4 幕 · 进入范围",
    title: "接近触发范围，准备发现",
    narration: "当真实 GPS 判断你进入地点的触发范围时，系统会检查当前任务是否可以解锁。定位精度不足时，实际体验可能有所不同。",
    distance: "23 米",
    phase: "接近中",
    station: 1,
  },
  {
    eyebrow: "第 5 幕 · 发现地点",
    title: "发现！第一站已经解锁",
    narration: "演示位置进入示例触发圈，出现发现反馈。这个结果是模拟出来的，不代表 BSOP 的实测坐标或实际 GPS 精度。",
    distance: "8 米 · 模拟到达",
    phase: "已发现",
    station: 1,
  },
  {
    eyebrow: "第 6 幕 · 阅读与观察",
    title: "地点解锁后，内容才真正开始",
    narration: "先读一个简短的引导，再观察身边的环境，最后回答一个与地点有关的问题。游戏不是只让你在地图上走点。",
    distance: "第一站 · 呼召",
    phase: "场景已解锁",
    station: 1,
  },
  {
    eyebrow: "第 7 幕 · 行动与奖励",
    title: "完成行动，收下本关奖励",
    narration: "提交答案或完成任务后，游戏会给出反馈和关键词，再引导你前往下一站。你的真实游戏进度与本演示分开保存。",
    distance: "获得关键词：呼召",
    phase: "任务完成",
    station: 2,
  },
  {
    eyebrow: "第 8 幕 · 完成演示",
    title: "你已经看懂基本玩法了",
    narration: "现在你可以重播演示，逐步查看每个功能，或离开演示进入真实游戏。真实游戏会根据你授权提供的实际位置运行。",
    distance: "演示完成",
    phase: "准备体验",
    station: 2,
  },
];

const MARKERS = [
  { left: "12%", top: "74%" },
  { left: "23%", top: "65%" },
  { left: "37%", top: "56%" },
  { left: "51%", top: "47%" },
  { left: "65%", top: "39%" },
  { left: "65%", top: "39%" },
  { left: "65%", top: "39%" },
  { left: "65%", top: "39%" },
];

export default function TutorialPage() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [slow, setSlow] = useState(false);
  const current = STEPS[step];
  const marker = MARKERS[step];
  const isMapScene = step >= 1 && step <= 5;
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  useEffect(() => {
    if (!playing || step >= STEPS.length - 1) return;
    const timer = window.setTimeout(() => setStep((value) => Math.min(value + 1, STEPS.length - 1)), slow ? 6500 : 4200);
    return () => window.clearTimeout(timer);
  }, [playing, slow, step]);

  const stepLabel = useMemo(() => `第 ${step + 1} 幕，共 ${STEPS.length} 幕`, [step]);

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
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">MOS SCENE HUNT · GUIDED TOUR</p>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight">跟着 BSOP 范本，走一遍游戏</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">像录屏一样自动播放，也可以随时暂停、回看和手动推进。</p>
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
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-200">BSOP · 示例路线</p>
              <p className="mt-1 text-lg font-extrabold">神学院的八个秘密</p>
            </div>
            <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold">{current.phase}</span>
          </div>

          {isMapScene ? (
            <div className="relative z-10 mt-3 h-[190px] overflow-hidden rounded-2xl border border-white/10 bg-[#173b4a]/65">
              <svg viewBox="0 0 320 190" className="absolute inset-0 h-full w-full" aria-label="示意路线图，非真实校园地图">
                <path d="M25 155 C60 130 78 110 110 96 S170 55 210 53 S260 50 290 25" fill="none" stroke="#f5d77e" strokeWidth="4" strokeLinecap="round" strokeDasharray="6 7" />
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
                {step >= 4 ? "✦ 发现第一站" : `↗ 距离目标 ${current.distance}`}
              </div>
              <div className="absolute bottom-2 right-2 rounded-lg bg-black/35 px-2.5 py-1.5 text-[9px] text-white/80">示意地图 · 非实测</div>
            </div>
          ) : (
            <div className="relative z-10 mt-5 flex min-h-[190px] flex-col justify-center rounded-2xl border border-white/10 bg-white/[0.06] p-5">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-amber-300 text-2xl text-[#102b3a]">✦</div>
              <p className="text-xs font-semibold text-teal-100">八站探索 · 真实地点 · 实际行动</p>
              <p className="mt-2 max-w-xs text-2xl font-extrabold leading-tight">让每一步移动，都发现新的意义。</p>
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

          {step >= 5 && step < 7 ? (
            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <p className="text-xs font-bold text-[var(--muted)]">第一站 · 呼召</p>
              <p className="mt-2 text-base font-bold">你为什么来到这里？</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">先观察周围，再想一想：这段学习旅程，你最期待被改变的是什么？</p>
              {step === 6 ? <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800">✓ 获得关键词：呼召</div> : null}
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
              下一幕 →
            </button>
            <button type="button" onClick={previous} disabled={step === 0} className="btn btn-secondary min-h-11 disabled:cursor-not-allowed disabled:opacity-40">
              ← 上一幕
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
          <p className="font-extrabold">演示结束，准备好开始了吗？</p>
          <p className="mt-1 text-sm leading-relaxed">进入真实游戏后，位置和距离将由你的设备定位提供；请在户外安全行走时使用。</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Link href="/select?game=bsop-eight-secrets" className="btn btn-primary min-h-11 flex-1">进入 BSOP 范本</Link>
            <Link href="/create" className="btn btn-secondary min-h-11 flex-1">开始创作游戏</Link>
          </div>
        </section>
      ) : (
        <p className="mt-4 text-center text-xs leading-relaxed text-[var(--muted)]">提示：你可以暂停自动播放，慢慢阅读每一步。演示不会申请定位权限。</p>
      )}
    </main>
  );
}
