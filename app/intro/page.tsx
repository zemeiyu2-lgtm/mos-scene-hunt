"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useHunt } from "@/components/hunt-provider";
import { useGps } from "@/components/gps-provider";
import { playMusic } from "@/components/sound";
import { Screen } from "@/components/ui";

export default function IntroPage() {
  const router = useRouter();
  const { game, loading, loadError, startHunt } = useHunt();
  const { start } = useGps();
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  if (loading) return <Screen title="准备中…" subtitle="正在打开游戏"><div className="card h-72 animate-pulse" /></Screen>;
  if (loadError || !game) return <Screen title="游戏无法打开" subtitle="请稍后重试"><div className="card p-5"><p className="text-[13px] text-[var(--muted)]">{loadError ?? "没有找到游戏内容。"}</p><Link href="/games" className="btn btn-secondary mt-4">返回游戏中心</Link></div></Screen>;
  const isBSOP = game.id === "bsop-eight-secrets";
  const begin = () => { stopRef.current?.(); stopRef.current = null; start(); startHunt(); router.push("/map"); };
  const startMusic = () => { stopRef.current?.(); stopRef.current = playMusic("intro"); };
  return <main className="min-h-[100dvh] bg-[var(--bg)]"><div className="mx-auto flex min-h-[100dvh] w-full max-w-[680px] flex-col">
    <section className="relative flex min-h-[62dvh] flex-col justify-end overflow-hidden px-6 pb-10 pt-12" style={{background:"radial-gradient(circle at 50% 28%, rgba(245,165,36,.28), transparent 34%), linear-gradient(160deg,#17251f 0%,#0c1512 72%)"}}>
      <div className="absolute inset-0 opacity-20" style={{backgroundImage:"radial-gradient(circle at 20% 20%,white 1px,transparent 1px),radial-gradient(circle at 80% 70%,white 1px,transparent 1px)",backgroundSize:"38px 38px"}} />
      <div className="relative"><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300">MOS SCENE HUNT</p><div className="mt-6 text-[68px] leading-none">{isBSOP ? "👁️" : "✦"}</div><p className="mt-6 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/55">{isBSOP ? "REFERENCE EXPERIENCE · 01" : "REAL-WORLD ADVENTURE"}</p><h1 className="mt-2 text-[34px] font-bold leading-[1.08] tracking-tight text-white">{game.title}</h1><p className="mt-4 max-w-[30rem] text-[16px] leading-relaxed text-white/72">{isBSOP ? "有些答案，不在课堂里。" : "走出去，发现一个真实世界里的故事。"}</p></div>
    </section>
    <section className="flex-1 px-6 py-7"><div className="grid gap-3"><button type="button" className="btn btn-primary btn-block h-14 text-[16px]" onClick={()=>{startMusic();begin();}}>▶ 开始探索</button><button type="button" className="btn btn-secondary btn-block h-11" onClick={startMusic}>🎧 先听一下</button></div>
      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"><p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">怎么玩？</p><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><div className="text-[28px]">📍</div><p className="mt-1 text-[12px] font-semibold">找到</p></div><div><div className="text-[28px]">👀</div><p className="mt-1 text-[12px] font-semibold">看见</p></div><div><div className="text-[28px]">✋</div><p className="mt-1 text-[12px] font-semibold">行动</p></div></div><p className="mt-4 text-center text-[13px] leading-relaxed text-[var(--muted)]">少看手机，多看真实世界。走进地点，发现线索，完成一个真实行动。</p></div>
      <div className="mt-4 flex items-center justify-center gap-3 text-[11.5px] text-[var(--muted)]"><span>{game.scenes.length} 站</span><span>·</span><span>约 {game.estimatedMinutes ?? 20} 分钟</span><span>·</span><span>需要定位</span></div>
      <Link href="/select" className="mt-6 block text-center text-[12px] text-[var(--muted)] underline underline-offset-4">查看完整游戏信息</Link>
    </section>
  </div></main>;
}
