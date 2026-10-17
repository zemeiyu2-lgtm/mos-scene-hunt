"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Screen, LoadingState } from "@/components/ui";
import { importGamePackage } from "@/lib/content";
import { loadCloudCatalog, packUrl, publishedGames, type CloudGameEntry } from "@/lib/cloud";

export default function GamesPage() {
  const [games, setGames] = useState<CloudGameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const catalog = await loadCloudCatalog();
      setGames(publishedGames(catalog));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "游戏中心暂时无法加载");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportMessage("");
    try {
      const result = importGamePackage(await file.text());
      const warningCount = result.issues.filter((issue) => issue.severity === "warning").length;
      setImportMessage(warningCount
        ? `已导入「${result.game.title}」，有 ${warningCount} 个提示。正在打开游戏…`
        : `已导入「${result.game.title}」，正在打开游戏…`);
      window.setTimeout(() => { window.location.href = "/select"; }, 350);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "导入失败，请检查游戏包文件。");
    } finally {
      setImporting(false);
    }
  };

  const download = async (entry: CloudGameEntry) => {
    setBusyId(entry.id);
    setMessage("");
    try {
      const response = await fetch(packUrl(entry), { cache: "no-cache" });
      if (!response.ok) throw new Error(`游戏包下载失败（HTTP ${response.status}）`);
      const result = importGamePackage(await response.text());
      const warningCount = result.issues.filter((x) => x.severity === "warning").length;
      setMessage(warningCount
        ? `已下载「${result.game.title}」，并安装到本机；有 ${warningCount} 个提示。`
        : `已下载「${result.game.title}」，现在可以直接游玩。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "游戏下载失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen title="🎮 游戏中心">
      <section className="card p-5">
        <p className="game-kicker">MOS SCENE HUNT · GAME CENTER</p>
        <h2 className="mt-2 text-2xl font-bold">选择一个游戏</h2>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/tutorial" className="btn btn-secondary text-center">玩法演示</Link>
          <button type="button" className="btn btn-primary" onClick={() => { setImportMessage(""); setImportOpen(true); }}>导入游戏包</button>
        </div>
      </section>

      {message ? <div className="card mt-4 p-4 text-sm leading-relaxed">{message}</div> : null}

      {loading ? <LoadingState label="正在读取云端游戏库…" /> : (
        <div className="mt-4 grid gap-3">
          {games.map((game) => (
            <article key={game.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold">{game.title}</h3>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">作者：{game.author}</p>
                </div>
                <span className="chip shrink-0">{game.sceneCount} 站</span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">{game.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip bg-[var(--surface)]">约 {game.estimatedMinutes ?? "—"} 分钟</span>
                <span className="chip bg-[var(--surface)]">{game.difficulty === "easy" ? "入门" : game.difficulty === "hard" ? "进阶" : "标准"}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className="btn btn-primary" onClick={() => void download(game)} disabled={busyId === game.id}>
                  {busyId === game.id ? "正在下载…" : "下载游戏"}
                </button>
                <Link className="btn btn-secondary text-center" href={`/select?game=${encodeURIComponent(game.id)}`}>
                  查看
                </Link>
              </div>
            </article>
          ))}
          {!games.length ? <div className="card p-5 text-center text-sm text-[var(--muted)]">目前没有公开游戏。</div> : null}
        </div>
      )}

      <section className="card mt-4 p-4">
        <p className="text-[13px] font-semibold">我是设计者</p>
        <Link href="/design" className="btn btn-secondary mt-3">设计中心</Link>
      </section>
      {importOpen ? (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !importing) setImportOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="import-game-title" className="w-full max-w-md rounded-t-3xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold tracking-wide text-[var(--muted)]">MOS SCENE HUNT</p><h2 id="import-game-title" className="mt-1 text-xl font-bold">导入游戏包</h2></div>
              <button type="button" className="btn btn-ghost min-h-9 px-3" onClick={() => setImportOpen(false)} disabled={importing} aria-label="关闭导入窗口">✕</button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">选择从设计中心导出的 JSON 游戏包。导入前会自动校验，成功后保存在本机并打开游戏。</p>
            <input ref={importInputRef} type="file" accept=".json,application/json" className="sr-only" onChange={handleImport} />
            <button type="button" className="btn btn-primary mt-4 w-full" onClick={() => importInputRef.current?.click()} disabled={importing}>{importing ? "正在导入…" : "选择 JSON 游戏包"}</button>
            {importMessage ? <p role="status" className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed">{importMessage}</p> : null}
            <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => setImportOpen(false)} disabled={importing}>取消</button>
          </section>
        </div>
      ) : null}
    </Screen>
  );
}
