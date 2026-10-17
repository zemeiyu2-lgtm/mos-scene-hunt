"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Screen } from "@/components/ui";
import { useHunt } from "@/components/hunt-provider";
import { deleteAuthoredGame, listAuthoredGames, markCurrentAuthoredGame, renameAuthoredGame, saveAuthoredGame } from "@/lib/content";
import type { Game } from "@/lib/game/types";
import { exportGameJson, gameToMarkdown, validateGamePackage, type PackageReport } from "@/lib/game/package";

export default function CreatePage() {
  const { game } = useHunt();
  const [draft, setDraft] = useState<Game | null>(null); const [report, setReport] = useState<PackageReport | null>(null); const [message, setMessage] = useState(""); const [library, setLibrary] = useState<Game[]>([]);
  const working = draft ?? game;
  const refreshLibrary = () => setLibrary(listAuthoredGames());
  useEffect(() => { refreshLibrary(); }, []);
  const download = (filename: string, text: string, type: string) => { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); };
  const saveLibrary = () => { if (!working) return; if (!saveAuthoredGame(working)) { setMessage("保存失败：浏览器存储空间不可用。"); return; } markCurrentAuthoredGame(working.id); refreshLibrary(); setMessage("已保存到本机游戏库"); };
  const activateGame = (game: Game) => { saveAuthoredGame(game); markCurrentAuthoredGame(game.id); setDraft(game); setReport(validateGamePackage(game)); setMessage("已切换到「" + game.title + "」，现在可以试玩或继续设计。"); };
  const renameGame = (game: Game) => { const title = window.prompt("给游戏换一个显示名称：", game.title); if (!title?.trim()) return; const next = renameAuthoredGame(game.id, title); if (next) { setLibrary(listAuthoredGames()); if (working?.id === next.id) setDraft(next); setMessage("已重命名。"); } };
  const removeGame = (game: Game) => { if (!window.confirm("确定删除「" + game.title + "」？删除后需要重新导入游戏包才能恢复。")) return; deleteAuthoredGame(game.id); setLibrary(listAuthoredGames()); if (working?.id === game.id) setDraft(null); setMessage("已删除「" + game.title + "」。"); };
  if (!working) return <Screen title="创作中心"><div className="card p-5">正在加载……</div></Screen>;
  const spatial = report?.spatial ?? validateGamePackage(working).spatial;
  return <Screen title="创作中心">
    <section className="card p-5"><p className="game-kicker">MOS SCENE HUNT V0.6</p><h2 className="mt-2 text-2xl font-bold">创作、试玩、分享</h2><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">地图、点位、故事、任务和奖励属于同一个游戏包。手机可以完成基础设计，电脑适合精细编辑。</p>
      <div className="mt-4 grid grid-cols-2 gap-2"><Link href={working ? `/design?game=${encodeURIComponent(working.id)}` : "/design"} className="btn btn-primary text-center">进入创作工作台</Link><Link href="/design#package-import" className="btn btn-secondary text-center">导入 AI / 游戏包</Link></div>
      <Link href="/how-to-create" className="mt-3 inline-flex px-1 py-1 text-xs font-medium text-[var(--muted)]">第一次创作？查看创作说明 →</Link></section>
    <section className="card mt-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-bold">📚 本机游戏库</p><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">导入或制作的游戏都会保存在这台设备上。设计者可以切换游戏、继续设计、试玩或删除；不需要登录。</p></div>
        <button className="btn btn-ghost" onClick={refreshLibrary}>刷新</button>
      </div>
      <div className="mt-3 grid gap-2">
        {library.length ? library.map((item) => (
          <div key={item.id} className={`rounded-xl border p-3 ${working.id === item.id ? "border-[var(--ink)] bg-[var(--surface)]" : "border-[var(--line)]"}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{item.scenes.length} 个体验点 · {item.estimatedMinutes ?? "未设"} 分钟</p></div>{working.id === item.id ? <span className="chip">当前</span> : null}</div>
            <div className="mt-2 grid grid-cols-3 gap-2"><button className="btn btn-secondary" onClick={() => activateGame(item)}>使用</button><button className="btn btn-secondary" onClick={() => renameGame(item)}>改名</button><button className="btn btn-ghost" onClick={() => removeGame(item)}>删除</button></div>
          </div>
        )) : <div className="rounded-xl bg-[var(--surface)] px-3 py-4 text-center text-xs text-[var(--muted)]">还没有保存的本机游戏。导入一个游戏包，或完成设计后点击“保存到本机游戏库”。</div>}
      </div>
    </section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">导入 / 导出</p><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">AI 与游戏包统一从创作中心导入标准 JSON。Word 和 Markdown 可用于外部起草或阅读；需要先整理成 MOS Scene Hunt JSON 游戏包，再导入、校验并在地图上标定真实地点。只有没有结构性错误的游戏才能进入试玩。</p><div className="mt-3 grid grid-cols-2 gap-2"><Link href="/design#package-import" className="btn btn-secondary text-center">导入 AI / JSON 游戏包</Link><button className="btn btn-secondary" onClick={() => download(`${working.id}.json`, exportGameJson(working), "application/json")}>导出完整 JSON</button></div><div className="mt-2"><button className="btn btn-ghost btn-block" onClick={() => download(`${working.id}.md`, gameToMarkdown(working), "text/markdown;charset=utf-8")}>导出可编辑 Markdown 设计稿</button></div></section><section className="card mt-4 p-5"><p className="text-sm font-bold">当前游戏包</p><p className="mt-1 text-lg font-semibold">{working.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{working.scenes.length} 个体验点 · {working.huntArea?.radiusMeters ?? "未设定"}m 探索区域</p><div className="mt-3 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => download(`${working.id}.json`, exportGameJson(working), "application/json")}>导出 JSON</button><button className="btn btn-secondary" onClick={() => download(`${working.id}.md`, gameToMarkdown(working), "text/markdown;charset=utf-8")}>导出设计稿</button></div></section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">空间概览</p><div className="mt-3 grid grid-cols-3 gap-2"><Stat label="体验点" value={String(working.scenes.length)} /><Stat label="总距离" value={`${Math.round(spatial.totalMeters)}m`} /><Stat label="步行" value={`约 ${spatial.walkingMinutes} 分`} /></div><div className="mt-4 space-y-2">{spatial.distances.map((d,i)=><div key={`${d.from}-${d.to}`} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i+1} → {i+2}</b><span className="float-right">{Math.round(d.meters)} m</span></div>)}</div></section>
    <section className="card mt-4 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">自动验证</p><p className="mt-1 text-xs text-[var(--muted)]">数据、空间、逻辑和媒体的基础检查</p></div><button className="btn btn-primary" onClick={() => setReport(validateGamePackage(working))}>验证</button></div>{report ? <div className="mt-4"><div className={`rounded-xl px-3 py-3 text-sm font-semibold ${report.canPlaytest ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{report.canPlaytest ? "✓ 可以试玩" : "需要修正问题"}</div><div className="mt-3 space-y-2">{report.issues.length ? report.issues.map((i,n)=><div key={n} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i.severity === "error" ? "错误" : "提醒"}</b> · {i.path}<br />{i.message}</div>) : <p className="text-xs text-[var(--muted)]">没有发现问题。</p>}</div></div> : null}</section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">保存与试玩</p><div className="mt-3 grid gap-2"><button className="btn btn-primary btn-block" onClick={saveLibrary}>保存到本机游戏库</button><Link href={`/select?game=${encodeURIComponent(working.id)}`} className="btn btn-secondary text-center">进入手机试玩</Link></div>{message ? <p className="mt-3 text-center text-xs text-[var(--muted)]">{message}</p> : null}</section>
  </Screen>;
}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-[var(--surface)] p-3"><p className="text-[11px] text-[var(--muted)]">{label}</p><p className="mt-1 font-bold tabular">{value}</p></div>}
