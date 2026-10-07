"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Screen, LoadingState } from "@/components/ui";
import { importGamePackage } from "@/lib/content";
import { loadCloudCatalog, packUrl, publishedGames, type CloudGameEntry } from "@/lib/cloud";

export default function GamesPage() {
  const [games, setGames] = useState<CloudGameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

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
    <Screen title="🎮 游戏中心" subtitle="从官方云端游戏库选择一个游戏">
      <section className="card p-5">
        <p className="game-kicker">MOS SCENE HUNT · GAME CENTER</p>
        <h2 className="mt-2 text-2xl font-bold">选择一个游戏</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          游戏包从云端下载到本机。下载后不需要打开设计器，手机即可直接游玩；首次下载后也会进入本机缓存。
        </p>
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
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">先在电脑上进入设计 / 导入，完成游戏并导出游戏包。云端发布审核可以在后续版本加入。</p>
        <Link href="/create" className="btn btn-secondary mt-3">设计 / 导入</Link>
      </section>
    </Screen>
  );
}
