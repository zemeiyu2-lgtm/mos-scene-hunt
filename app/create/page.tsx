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
import { parseAIText } from "@/lib/content/ai";
import { useUiLocale } from "@/components/ui-locale-provider";

export default function CreatePage() {
  const { game } = useHunt(); const { t } = useUiLocale(); const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Game | null>(null); const [report, setReport] = useState<PackageReport | null>(null); const [message, setMessage] = useState(""); const [library, setLibrary] = useState<Game[]>([]); const [aiText, setAiText] = useState(""); const [aiWarnings, setAiWarnings] = useState<string[]>([]);
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
        setMessage(next.canPlaytest ? t("create.importLoaded") : t("create.importNeedsFix"));
      }
    } catch (error) {
      setReport(null);
      setMessage(error instanceof Error ? `${t("create.importFailed")}: ${error.message}` : t("create.fileUnreadable"));
    }
  };
  const importAI = () => {
    try {
      const result = parseAIText(aiText);
      const next = validateGamePackage(result.game);
      setAiWarnings(result.warnings);
      setReport(next);
      if (!next.game || !next.canPlaytest) {
        setMessage(t("create.aiNeedsFix"));
        return;
      }
      saveAuthoredGame(next.game);
      markCurrentAuthoredGame(next.game.id);
      setDraft(next.game);
      refreshLibrary();
      setMessage(t("create.aiReady"));
    } catch (error) {
      setAiWarnings([]);
      setReport(null);
      setMessage(error instanceof Error ? `${t("create.aiImportFailed")}: ${error.message}` : t("create.aiUnreadable"));
    }
  };
  const saveLibrary = () => { if (!working) return; if (!saveAuthoredGame(working)) { setMessage(t("create.saveFailed")); return; } markCurrentAuthoredGame(working.id); refreshLibrary(); setMessage(t("create.saved")); };
  const activateGame = (game: Game) => { saveAuthoredGame(game); markCurrentAuthoredGame(game.id); setDraft(game); setReport(validateGamePackage(game)); setMessage(t("create.switchedTo").replace("{title}", game.title)); };
  const renameGame = (game: Game) => { const title = window.prompt(t("create.renamePrompt"), game.title); if (!title?.trim()) return; const next = renameAuthoredGame(game.id, title); if (next) { setLibrary(listAuthoredGames()); if (working?.id === next.id) setDraft(next); setMessage(t("create.renamed")); } };
  const removeGame = (game: Game) => { if (!window.confirm(t("create.deleteConfirm").replace("{title}", game.title))) return; deleteAuthoredGame(game.id); setLibrary(listAuthoredGames()); if (working?.id === game.id) setDraft(null); setMessage(t("create.deleted").replace("{title}", game.title)); };
  if (!working) return <Screen title={t("create.title")} subtitle={t("create.waiting")}><div className="card p-5">{t("common.loading")}</div></Screen>;
  const spatial = report?.spatial ?? validateGamePackage(working).spatial;
  return <Screen title={t("create.title")} subtitle={t("create.subtitle")}>
    <section className="card p-5"><p className="game-kicker">MOS SCENE HUNT V0.6</p><h2 className="mt-2 text-2xl font-bold">{t("create.heroTitle")}</h2><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t("create.heroDescription")}</p>
      <div className="mt-4 grid grid-cols-2 gap-2"><Link href={working ? `/design?game=${encodeURIComponent(working.id)}` : "/design"} className="btn btn-primary text-center">{t("create.openDesigner")}</Link><button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>{t("create.importPackage")}</button></div>
      <input ref={inputRef} className="hidden" type="file" accept=".docx,.json,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/markdown" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></section>
    <section className="card mt-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-bold">{t("create.library")}</p><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{t("create.libraryDescription")}</p></div>
        <button className="btn btn-ghost" onClick={refreshLibrary}>{t("common.refresh")}</button>
      </div>
      <div className="mt-3 grid gap-2">
        {library.length ? library.map((item) => (
          <div key={item.id} className={`rounded-xl border p-3 ${working.id === item.id ? "border-[var(--ink)] bg-[var(--surface)]" : "border-[var(--line)]"}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{item.scenes.length} {t("create.stops")} · {item.estimatedMinutes ?? t("create.notSet")} {t("home.minutes")}</p></div>{working.id === item.id ? <span className="chip">{t("create.current")}</span> : null}</div>
            <div className="mt-2 grid grid-cols-3 gap-2"><button className="btn btn-secondary" onClick={() => activateGame(item)}>{t("create.use")}</button><button className="btn btn-secondary" onClick={() => renameGame(item)}>{t("create.rename")}</button><button className="btn btn-ghost" onClick={() => removeGame(item)}>{t("create.delete")}</button></div>
          </div>
        )) : <div className="rounded-xl bg-[var(--surface)] px-3 py-4 text-center text-xs text-[var(--muted)]">{t("create.emptyLibrary")}</div>}
      </div>
    </section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">{t("create.importExport")}</p><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{t("create.importExportDescription")}</p><div className="mt-3 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>{t("create.importFormats")}</button><button className="btn btn-secondary" onClick={() => download(`${working.id}.json`, exportGameJson(working), "application/json")}>{t("create.exportJson")}</button></div><div className="mt-2"><button className="btn btn-ghost btn-block" onClick={() => download(`${working.id}.md`, gameToMarkdown(working), "text/markdown;charset=utf-8")}>{t("create.exportMarkdown")}</button></div></section><section className="card mt-4 p-5"><p className="text-sm font-bold">{t("create.currentPackage")}</p><p className="mt-1 text-lg font-semibold">{working.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{working.scenes.length} {t("create.stops")} · {working.huntArea?.radiusMeters ?? t("create.notSet")}m {t("create.playArea")}</p><div className="mt-3 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={() => download(`${working.id}.json`, exportGameJson(working), "application/json")}>{t("create.exportJson")}</button><button className="btn btn-secondary" onClick={() => download(`${working.id}.md`, gameToMarkdown(working), "text/markdown;charset=utf-8")}>{t("create.exportMarkdown")}</button></div></section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">{t("create.spatialOverview")}</p><div className="mt-3 grid grid-cols-3 gap-2"><Stat label={t("create.stops")} value={String(working.scenes.length)} /><Stat label={t("create.totalDistance")} value={`${Math.round(spatial.totalMeters)}m`} /><Stat label={t("create.walking")} value={`${t("create.about")} ${spatial.walkingMinutes} ${t("create.minutesShort")}`} /></div><div className="mt-4 space-y-2">{spatial.distances.map((d,i)=><div key={`${d.from}-${d.to}`} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i+1} → {i+2}</b><span className="float-right">{Math.round(d.meters)} m</span></div>)}</div></section>
    <section className="card mt-4 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">{t("create.validation")}</p><p className="mt-1 text-xs text-[var(--muted)]">{t("create.validationDescription")}</p></div><button className="btn btn-primary" onClick={() => setReport(validateGamePackage(working))}>{t("create.validate")}</button></div>{report ? <div className="mt-4"><div className={`rounded-xl px-3 py-3 text-sm font-semibold ${report.canPlaytest ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{report.canPlaytest ? t("create.canPlaytest") : t("create.needsFix")}</div><div className="mt-3 space-y-2">{report.issues.length ? report.issues.map((i,n)=><div key={n} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"><b>{i.severity === "error" ? t("create.error") : t("create.warning")}</b> · {i.path}<br />{i.message}</div>) : <p className="text-xs text-[var(--muted)]">{t("create.noIssues")}</p>}</div></div> : null}</section>
    <section className="card mt-4 p-5"><p className="text-sm font-bold">{t("create.saveAndPlay")}</p><div className="mt-3 grid gap-2"><button className="btn btn-primary btn-block" onClick={saveLibrary}>{t("create.saveToLibrary")}</button><Link href={`/select?game=${encodeURIComponent(working.id)}`} className="btn btn-secondary text-center">{t("create.playOnPhone")}</Link></div>{message ? <p className="mt-3 text-center text-xs text-[var(--muted)]">{message}</p> : null}</section>
  </Screen>;
}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-[var(--surface)] p-3"><p className="text-[11px] text-[var(--muted)]">{label}</p><p className="mt-1 font-bold tabular">{value}</p></div>}
