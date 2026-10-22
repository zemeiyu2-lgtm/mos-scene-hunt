"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Screen, LoadingState } from "@/components/ui";
import { importGamePackage, listAuthoredGames, markCurrentAuthoredGame } from "@/lib/content";
import type { Game } from "@/lib/game/types";
import { loadCloudCatalog, packUrl, publishedGames, type CloudGameEntry } from "@/lib/cloud";
import { MapView } from "@/components/map-view";
import { RIZAL_PARK_TEMPLATE } from "@/lib/game/templates";
import type { MapSceneEntry } from "@/components/game-map";
import type { PositionFix } from "@/lib/location";

export default function GamesPage() {
  const [games, setGames] = useState<CloudGameEntry[]>([]);
  const [localGames, setLocalGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshLocal = () => setLocalGames(listAuthoredGames());

  const refresh = async () => {
    setLoading(true);
    try {
      const catalog = await loadCloudCatalog();
      setGames(publishedGames(catalog));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? "云端游戏库暂时无法读取；本机游戏仍可使用。" : "云端游戏库暂时无法读取。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    refreshLocal();
    const onFocus = () => refreshLocal();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const download = async (entry: CloudGameEntry) => {
    setBusyId(entry.id);
    setMessage("");
    try {
      const response = await fetch(packUrl(entry), { cache: "no-cache" });
      if (!response.ok) throw new Error("游戏包下载失败（HTTP " + response.status + "）");
      const result = importGamePackage(await response.text());
      refreshLocal();
      const warningCount = result.issues.filter((issue) => issue.severity === "warning").length;
      setMessage(warningCount
        ? "已下载并保存「" + result.game.title + "」；有 " + warningCount + " 项提醒，请在创作中心检查。"
        : "已下载并保存「" + result.game.title + "」，可在上方本机游戏中直接开始。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "游戏下载失败");
    } finally {
      setBusyId(null);
    }
  };

  const playLocal = (game: Game) => {
    markCurrentAuthoredGame(game.id);
    window.location.href = "/select?game=" + encodeURIComponent(game.id);
  };

  const demoGame = RIZAL_PARK_TEMPLATE;
  const demoPlayer: PositionFix = { lat: 14.58305, lng: 120.97936, accuracy: 12, timestamp: 0, simulated: true };
  const demoEntries: MapSceneEntry[] = demoGame.scenes.map((scene, index) => ({
    scene,
    status: index === 0 ? "available" : "locked",
    isActive: index === 0,
    distance: null,
    inRange: false,
  }));

  return (
    <Screen title="游戏中心">
      <section className="card overflow-hidden">
        <div className="relative h-[190px] bg-[#f4ead4]">
          <MapView player={demoPlayer} entries={demoEntries} huntArea={demoGame.huntArea} tileProvider="osm" fitToHunt />
          <span className="pointer-events-none absolute bottom-2 left-2 z-[700] rounded-full border border-white/70 bg-[#173f3b]/90 px-3 py-1 text-[10px] font-semibold text-white shadow">玩法示范 · 模拟位置</span>
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--muted)]">HOW TO PLAY</p>
              <h2 className="mt-1 text-xl font-bold">先看示范，再开始探索</h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">看地图、走近地点、解锁任务、收集线索。示范不会读取真实位置。</p>
            </div>
            <Link href="/tutorial" className="btn btn-primary shrink-0 px-3 text-sm">开始演示</Link>
          </div>
        </div>
      </section>

      {message ? <div role="status" className="card mt-3 p-3 text-sm leading-relaxed">{message}</div> : null}

      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">本机游戏</h2>
            <p className="text-xs text-[var(--muted)]">已导入或由创作中心保存，可直接游玩。</p>
          </div>
          <button type="button" className="btn btn-ghost min-h-9 px-2 text-xs" onClick={refreshLocal}>刷新</button>
        </div>
        <div className="grid gap-2">
          {localGames.map((game) => (
            <article key={game.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold">{game.title}</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">{game.scenes.length} 个地点 · 约 {game.estimatedMinutes ?? "—"} 分钟</p>
                </div>
                <span className="chip shrink-0 bg-emerald-50 text-emerald-800">已就绪</span>
              </div>
              {game.description ? <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{game.description}</p> : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-primary" onClick={() => playLocal(game)}>开始游戏</button>
                <Link href={"/design?game=" + encodeURIComponent(game.id)} className="btn btn-secondary text-center">继续设计</Link>
              </div>
            </article>
          ))}
          {!localGames.length ? <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-5 text-center text-sm text-[var(--muted)]">本机还没有导入的游戏。设计者可到创作中心导入 AI 游戏包。</div> : null}
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-2">
          <h2 className="text-lg font-bold">云端游戏</h2>
          <p className="text-xs text-[var(--muted)]">从服务器下载到本机后游玩；这是后续共享游戏的重要入口。</p>
        </div>
        {loading ? <LoadingState label="正在读取云端游戏库…" /> : (
          <div className="grid gap-3">
            {games.map((game) => (
              <article key={game.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold">{game.title}</h3>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">作者：{game.author}</p>
                  </div>
                  <span className="chip shrink-0">{game.sceneCount} 站</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{game.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="chip bg-[var(--surface)]">约 {game.estimatedMinutes ?? "—"} 分钟</span>
                  <span className="chip bg-[var(--surface)]">{game.difficulty === "easy" ? "入门" : game.difficulty === "hard" ? "进阶" : "标准"}</span>
                </div>
                <button type="button" className="btn btn-primary mt-3 w-full" onClick={() => void download(game)} disabled={busyId === game.id}>
                  {busyId === game.id ? "正在下载…" : "下载到本机"}
                </button>
              </article>
            ))}
            {!games.length ? <div className="card p-4 text-center text-sm text-[var(--muted)]">目前没有公开的云端游戏。你仍可玩本机游戏或体验玩法示范。</div> : null}
          </div>
        )}
      </section>

      <section className="card mt-5 p-4">
        <p className="text-sm font-semibold">设计者入口</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">导入统一 JSON 游戏包、校验内容、标定真实坐标，再保存到本机游戏库。</p>
        <Link href="/design#package-import" className="btn btn-secondary mt-3 w-full text-center">进入创作中心</Link>
      </section>
    </Screen>
  );
}
