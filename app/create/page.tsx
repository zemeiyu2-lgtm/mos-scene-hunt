"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Screen } from "@/components/ui";
import { useHunt } from "@/components/hunt-provider";
import { deleteAuthoredGame, listAuthoredGames, markCurrentAuthoredGame, renameAuthoredGame, saveAuthoredGame } from "@/lib/content";
import type { Game } from "@/lib/game/types";
import { exportGameJson, gameToMarkdown, markdownToGame, validateGamePackage, type PackageReport } from "@/lib/game/package";
import { docxToText } from "@/lib/content/docx";
import { parseWordText } from "@/lib/content/word";

export default function CreatePage() {
  const { game } = useHunt(); const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Game | null>(null); const [report, setReport] = useState<PackageReport | null>(null); const [message, setMessage] = useState(""); const [library, setLibrary] = useState<Game[]>([]); const [guideStep, setGuideStep] = useState(0);
  const working = draft ?? game;
  const refreshLibrary = () => setLibrary(listAuthoredGames());
  useEffect(() => { refreshLibrary(); }, []);
  const download = (filename: string, text: string, type: string) => { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); };
  const importFile = async (file: File) => {
    try {
      const isDocx = /\.docx$/i.test(file.name);
      const isMarkdown = /\.(md|markdown)$/i.test(file.name);
      let raw: unknown;
      if (isDocx) {
        raw = parseWordText(await docxToText(file));
      } else {
        const rawText = await file.text();
        raw = isMarkdown ? markdownToGame(rawText) : JSON.parse(rawText);
      }
      const next = validateGamePackage(raw);
      setReport(next);
      if (next.game) {
        saveAuthoredGame(next.game);
        markCurrentAuthoredGame(next.game.id);
        setDraft(next.game);
        setReport(next);
        refreshLibrary();
        setMessage(next.canPlaytest ? "导入成功，已载入设计器" : "已导入，但需要修正");
      }
    } catch (error) {
      setReport(null);
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "文件无法解析");
    }
  };
  const saveLibrary = () => { if (!working) return; if (!saveAuthoredGame(working)) { setMessage("保存失败：浏览器存储空间不可用。"); return; } markCurrentAuthoredGame(working.id); refreshLibrary(); setMessage("已保存到本机游戏库"); };
  const activateGame = (game: Game) => { saveAuthoredGame(game); markCurrentAuthoredGame(game.id); setDraft(game); setReport(validateGamePackage(game)); setMessage("已切换到「" + game.title + "」，可以继续设计。"); };
  const renameGame = (game: Game) => { const title = window.prompt("给游戏换一个显示名称：", game.title); if (!title?.trim()) return; const next = renameAuthoredGame(game.id, title); if (next) { setLibrary(listAuthoredGames()); if (working?.id === next.id) setDraft(next); setMessage("已重命名。"); } };
  const removeGame = (game: Game) => { if (!window.confirm("确定删除「" + game.title + "」？删除后需要重新导入游戏包才能恢复。")) return; deleteAuthoredGame(game.id); setLibrary(listAuthoredGames()); if (working?.id === game.id) setDraft(null); setMessage("已删除「" + game.title + "」。"); };
  if (!working) return <Screen title="创建游戏" subtitle="等待游戏内容加载"><div className="card p-5">正在加载……</div></Screen>;
  const spatial = report?.spatial ?? validateGamePackage(working).spatial;
  const guideSteps = [
    { title: "选一个小区域", detail: "先选公园、校园或街区的一小片安全区域，不要一开始就设计很长的路线。" },
    { title: "放置三个地点", detail: "在地图上依次添加 3 个容易找到、步行可达的点位，并调整顺序。" },
    { title: "给每站一个任务", detail: "每个地点写一句引导、一个观察问题或简单挑战，再决定完成后给什么线索。" },
    { title: "检查并分享", detail: "检查路线、安全、点位和文字，保存游戏包；现场确认坐标后再分享给玩家。" },
  ];
  return <Screen title="设计中心" subtitle="创作、导入与分享">
    <section className="card mb-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="game-kicker">CREATE GUIDE</p><h2 className="mt-1 text-lg font-bold">四步做出一场寻宝</h2></div>
        <span className="chip shrink-0">{guideStep + 1} / {guideSteps.length}</span>
      </div>
      <div className="mt-3 flex gap-1.5" aria-label="创作步骤进度">
        {guideSteps.map((item, index) => <span key={item.title} className={`h-1.5 flex-1 rounded-full ${index <= guideStep ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />)}
      </div>
      <p className="mt-3 text-sm font-semibold">{guideSteps[guideStep].title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{guideSteps[guideStep].detail}</p>
      <button type="button" className="btn btn-secondary mt-3 w-full" onClick={() => setGuideStep((value) => (value + 1) % guideSteps.length)}>
        {guideStep === guideSteps.length - 1 ? "重新看创作流程" : "下一步"}
      </button>
    </section>
    <section className="card p-5"><p className="game-kicker">MOS SCENE HUNT V0.6</p><h2 className="mt-2 text-2xl font-bold">先设计，再开始游戏</h2><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">地图、点位、故事、任务和奖励属于同一个游戏包。手机可以完成基础设计；电脑只提供更大的编辑空间。</p>
      <div className="mt-4"><Link href={working ? `/design?game=${encodeURIComponent(working.id)}` : "/design"} className="btn btn-primary block text-center">进入设计器</Link></div>
      <input ref={inputRef} className="hidden" type="file" accept=".docx,.json,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/markdown" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></section>
    <section className="card mt-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-bold">📚 本机游戏库</p><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">游戏保存在这台设备上。可以切换、继续设计或删除，不需要登录。</p></div>
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
    <section className="card mt-4 p-4">
      <p className="text-sm font-bold">导入与导出</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">Word 适合直接写方案；JSON 保存完整游戏；Markdown 方便继续编辑。导入后会自动检查内容。</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>导入文件</button>
        <button className="btn btn-secondary" onClick={() => download(`${working.id}.json`, exportGameJson(working), "application/json")}>导出游戏包</button>
      </div>
      <button className="btn btn-ghost btn-block mt-2" onClick={() => download(`${working.id}.md`, gameToMarkdown(working), "text/markdown;charset=utf-8")}>导出可编辑设计稿</button>
    </section>
    <section className="card mt-4 p-4">
      <p className="text-sm font-bold">用 AI 帮你起草</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">像和人聊天一样告诉 AI：你想在哪个地方玩、谁来玩、希望玩多久。再请它设计 3 个停靠点，每一站都写上地点、要观察的东西和一个小任务。</p>
      <div className="mt-3 rounded-xl bg-[var(--surface)] p-3 text-xs leading-relaxed">
        <p className="font-semibold">可以直接这样说：</p>
        <p className="mt-1">“请为家庭设计一场 20 分钟的公园寻宝。设置 3 个步行可达的地点，每站有一句故事、一个观察问题和一个简单任务。请用表格列出，并提醒我哪些坐标需要现场确认。”</p>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">AI 给出的是初稿。请检查地点是否开放、安全、可到达，再在地图上校准每个点位；不要直接相信 AI 生成的 GPS 坐标。</p>
    </section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">空间概览</p><div className="mt-3 grid grid-cols-3 gap-2"><Stat label="体验点" value={String(working.scenes.length)} /><Stat label="总距离" value={`${Math.round(spatial.totalMeters)}m`} /><Stat label="步行" value={`约 ${spatial.walkingMinutes} 分`} /></div><div className="mt-4 space-y-2">{spatial.distances.map((d,i)=><div key={`${d.from}-${d.to}`} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i+1} → {i+2}</b><span className="float-right">{Math.round(d.meters)} m</span></div>)}</div></section>
    <section className="card mt-4 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">自动验证</p><p className="mt-1 text-xs text-[var(--muted)]">数据、空间、逻辑和媒体的基础检查</p></div><button className="btn btn-primary" onClick={() => setReport(validateGamePackage(working))}>验证</button></div>{report ? <div className="mt-4"><div className={`rounded-xl px-3 py-3 text-sm font-semibold ${report.canPlaytest ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{report.canPlaytest ? "✓ 可以运行" : "需要修正问题"}</div><div className="mt-3 space-y-2">{report.issues.length ? report.issues.map((i,n)=><div key={n} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i.severity === "error" ? "错误" : "提醒"}</b> · {i.path}<br />{i.message}</div>) : <p className="text-xs text-[var(--muted)]">没有发现问题。</p>}</div></div> : null}</section>
    <section className="card mt-4 p-4"><button className="btn btn-primary btn-block" onClick={saveLibrary}>保存到本机游戏库</button>{message ? <p className="mt-3 text-center text-xs text-[var(--muted)]">{message}</p> : null}</section>
  </Screen>;
}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-[var(--surface)] p-3"><p className="text-[11px] text-[var(--muted)]">{label}</p><p className="mt-1 font-bold tabular">{value}</p></div>}
