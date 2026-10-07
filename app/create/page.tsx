"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Screen } from "@/components/ui";
import { useHunt } from "@/components/hunt-provider";
import type { Game } from "@/lib/game/types";
import { exportGameJson, gameToMarkdown, validateGamePackage, type PackageReport } from "@/lib/game/package";

const LIBRARY_KEY = "mos-scene-hunt:v06-library";
function readLibrary(): Game[] { try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]") as Game[]; } catch { return []; } }

export default function CreatePage() {
  const { game } = useHunt(); const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Game | null>(null); const [report, setReport] = useState<PackageReport | null>(null); const [message, setMessage] = useState("");
  const working = draft ?? game;
  const download = (filename: string, text: string, type: string) => { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); };
  const importFile = (file: File) => { const reader = new FileReader(); reader.onload = () => { try { const next = validateGamePackage(JSON.parse(String(reader.result))); setReport(next); if (next.game) {
        setDraft(next.game);
        setReport(next);
        setMessage(next.canPlaytest ? "导入成功，已载入设计器" : "已导入，但需要修正问题");
      } } catch { setMessage("文件不是有效的 JSON 游戏包"); } }; reader.readAsText(file); };
  const saveLibrary = () => { if (!working) return; localStorage.setItem(LIBRARY_KEY, JSON.stringify([...readLibrary().filter((g) => g.id !== working.id), working])); setMessage("已保存到本机游戏库"); };
  if (!working) return <Screen title="创建游戏" subtitle="等待游戏内容加载"><div className="card p-5">正在加载……</div></Screen>;
  const spatial = report?.spatial ?? validateGamePackage(working).spatial;
  return <Screen title="创建游戏" subtitle="手机优先 · 电脑增强">
    <section className="card p-5"><p className="game-kicker">MOS SCENE HUNT V0.6</p><h2 className="mt-2 text-2xl font-bold">先设计，再开始游戏</h2><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">地图、点位、故事、任务和奖励属于同一个游戏包。手机可以完成基础设计；电脑只提供更大的编辑空间。</p>
      <div className="mt-4 grid grid-cols-2 gap-2"><Link href={working ? `/design?game=${encodeURIComponent(working.id)}` : "/design"} className="btn btn-primary text-center">进入设计器</Link><button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>导入 JSON</button></div>
      <input ref={inputRef} className="hidden" type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">当前游戏包</p><p className="mt-1 text-lg font-semibold">{working.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{working.scenes.length} 个体验点 · {working.huntArea?.radiusMeters ?? "未设定"}m 探索区域</p><div className="mt-3 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => download(`${working.id}.json`, exportGameJson(working), "application/json")}>导出 JSON</button><button className="btn btn-secondary" onClick={() => download(`${working.id}.md`, gameToMarkdown(working), "text/markdown;charset=utf-8")}>导出设计稿</button></div></section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">空间概览</p><div className="mt-3 grid grid-cols-3 gap-2"><Stat label="体验点" value={String(working.scenes.length)} /><Stat label="总距离" value={`${Math.round(spatial.totalMeters)}m`} /><Stat label="步行" value={`约 ${spatial.walkingMinutes} 分`} /></div><div className="mt-4 space-y-2">{spatial.distances.map((d,i)=><div key={`${d.from}-${d.to}`} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i+1} → {i+2}</b><span className="float-right">{Math.round(d.meters)} m</span></div>)}</div></section>
    <section className="card mt-4 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">自动验证</p><p className="mt-1 text-xs text-[var(--muted)]">数据、空间、逻辑和媒体的基础检查</p></div><button className="btn btn-primary" onClick={() => setReport(validateGamePackage(working))}>验证</button></div>{report ? <div className="mt-4"><div className={`rounded-xl px-3 py-3 text-sm font-semibold ${report.canPlaytest ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{report.canPlaytest ? "✓ 可以试玩" : "需要修正问题"}</div><div className="mt-3 space-y-2">{report.issues.length ? report.issues.map((i,n)=><div key={n} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i.severity === "error" ? "错误" : "提醒"}</b> · {i.path}<br />{i.message}</div>) : <p className="text-xs text-[var(--muted)]">没有发现问题。</p>}</div></div> : null}</section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">保存与试玩</p><div className="mt-3 grid gap-2"><button className="btn btn-primary btn-block" onClick={saveLibrary}>保存到本机游戏库</button><Link href={`/select?game=${encodeURIComponent(working.id)}`} className="btn btn-secondary text-center">进入手机试玩</Link></div>{message ? <p className="mt-3 text-center text-xs text-[var(--muted)]">{message}</p> : null}</section>
  </Screen>;
}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-[var(--surface)] p-3"><p className="text-[11px] text-[var(--muted)]">{label}</p><p className="mt-1 font-bold tabular">{value}</p></div>}
