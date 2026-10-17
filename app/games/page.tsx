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
  const [serverGames, setServerGames] = useState<Game[]>([]);
  const [serverEnabled, setServerEnabled] = useState(false);
  const [serverTokenInput, setServerTokenInput] = useState("");
  const [serverConnectMessage, setServerConnectMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshLocal = () => setLocalGames(listAuthoredGames());

  const refreshServer = async () => {
    try {
      const token = window.sessionStorage.getItem("mos-local-game-token") ?? "";
      if (!token) { setServerEnabled(false); setServerGames([]); return; }
      const response = await fetch("/api/local-games", { cache: "no-store", headers: { "x-mos-local-token": token } });
      if (response.status === 401) { window.sessionStorage.removeItem("mos-local-game-token"); setServerEnabled(false); setServerGames([]); setServerConnectMessage("访问口令不正确，请重新输入。"); return; }
      if (!response.ok) return;
      const result = await response.json() as { enabled?: boolean; games?: Game[] };
      setServerEnabled(Boolean(result.enabled));
      setServerGames(result.enabled && Array.isArray(result.games) ? result.games : []);
      setServerConnectMessage(result.enabled ? "" : "电脑游戏包服务器未启用。请在电脑上启动本地服务器，并打开电脑服务器地址，而不是公共 Vercel 网站。");
    } catch {
      setServerEnabled(false);
      setServerGames([]);
      setServerConnectMessage("无法连接电脑游戏包服务器，请确认电脑服务正在运行。");
    }
  };

  const downloadFromComputer = (game: Game) => {
    try {
      const result = importGamePackage(JSON.stringify(game));
      refreshLocal();
      setMessage("已将电脑服务器中的「" + result.game.title + "」下载到当前设备。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "下载电脑游戏包失败。");
    }
  };

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
    void refreshServer();
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
            <p className="text-xs text-[var(--muted)]">从创作中心保存或从游戏库下载后，可直接游玩。</p>
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
          {!localGames.length ? <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-5 text-center text-sm text-[var(--muted)]">本机还没有游戏。请先到创作中心制作或导入游戏包。</div> : null}
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-2">
          <h2 className="text-lg font-bold">电脑服务器游戏</h2>
          <p className="text-xs text-[var(--muted)]">集中保存在运行本应用的电脑上；可下载到当前设备再游玩。</p>
        </div>
        {!serverEnabled ? (
          <div className="card p-4 text-sm leading-relaxed text-[var(--muted)]">
            <p>请先连接电脑游戏包服务器。访问口令只保存在当前浏览器会话中。</p>
            <div className="mt-3 flex gap-2"><input className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm" type="password" value={serverTokenInput} onChange={(e) => setServerTokenInput(e.target.value)} placeholder="电脑服务器访问口令" autoComplete="current-password" /><button className="btn btn-primary" type="button" onClick={() => { const token = serverTokenInput.trim(); if (!token) return; setServerConnectMessage("正在连接……"); window.sessionStorage.setItem("mos-local-game-token", token); setServerTokenInput(""); void refreshServer(); }}>连接</button></div>
            {serverConnectMessage ? <p role="status" className="mt-2 text-xs">{serverConnectMessage}</p> : <p className="mt-2 text-xs">请在电脑上运行本地服务器，并访问电脑服务器地址。</p> }
          </div>
        ) : serverGames.length ? (
          <div className="grid gap-2">
            {serverGames.map((game) => (
              <article key={game.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="font-bold">{game.title}</h3><p className="mt-1 text-xs text-[var(--muted)]">{game.scenes.length} 个地点 · 约 {game.estimatedMinutes ?? "—"} 分钟</p></div>
                  <span className="chip shrink-0">电脑存档</span>
                </div>
                <button type="button" className="btn btn-primary mt-3 w-full" onClick={() => downloadFromComputer(game)}>下载到本机游戏库</button>
              </article>
            ))}
          </div>
        ) : <div className="card p-4 text-sm text-[var(--muted)]">电脑服务器已连接，但还没有保存的游戏包。可以在创作中心保存游戏。</div>}
        {serverEnabled ? <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => { window.sessionStorage.removeItem("mos-local-game-token"); setServerEnabled(false); setServerGames([]); setServerTokenInput(""); }}>断开电脑服务器</button> : null}
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
        <p className="text-sm font-semibold">想创作自己的游戏？</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">请在创作中心导入游戏包、标定地点并试玩；游戏中心专注于选择和游玩。</p>
        <Link href="/design" className="btn btn-secondary mt-3 w-full text-center">进入创作中心</Link>
      </section>
    </Screen>
  );
}
