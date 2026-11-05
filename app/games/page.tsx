"use client";

/**
 * 探索中心 (first layer).
 *
 * Reordered around the question a first-time visitor actually asks — "what is
 * this place, and what can I do here?" — instead of around where the bytes came
 * from. The old machine-shaped sections (本机游戏 / 云端游戏 / 设计者入口) are all
 * still here, demoted below the discovery content; nothing was removed, and the
 * download + play path is byte-for-byte the same code.
 *
 * Honesty rules applied on this page:
 *  - featured content is the editorial ordering over real published packs; when
 *    there is none, the section is absent rather than filled with a placeholder;
 *  - a failed discovery request shows a retry, never an empty "no content" claim.
 *
 * Scope note: the branch version also carried a city entry and a "按城市看看"
 * CTA into `/cities`. Production has no city pages, no city store and no city
 * field in the pack schema, so porting that block would have produced links to
 * 404s and a chip list that could only ever be empty. The city dimension is
 * therefore absent from this screen — see the report for the reason.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Screen, LoadingState } from "@/components/ui";
import { importGamePackageChecked, listAuthoredGames, markCurrentAuthoredGame } from "@/lib/content";
import type { Game } from "@/lib/game/types";
import { loadCloudCatalog, packUrl, publishedGames, type CloudGameEntry } from "@/lib/cloud";
import { MapView } from "@/components/map-view";
import { RIZAL_PARK_TEMPLATE } from "@/lib/game/templates";
import type { MapSceneEntry } from "@/components/game-map";
import type { PositionFix } from "@/lib/location";
import { PackCard } from "@/components/explore/pack-card";
import { CategoryTiles } from "@/components/explore/discovery";
import { loadExplorePacks } from "@/lib/explore/client";
import type { ExplorePack } from "@/lib/explore/summary";
import { EXPLORE_CATEGORIES, type ExploreCategorySlug } from "@/lib/explore/taxonomy";

export default function GamesPage() {
  const [games, setGames] = useState<CloudGameEntry[]>([]);
  const [localGames, setLocalGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [packs, setPacks] = useState<ExplorePack[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Partial<Record<ExploreCategorySlug, number>>>({});
  const [exploreLoading, setExploreLoading] = useState(true);
  const [exploreFailed, setExploreFailed] = useState(false);

  const refreshLocal = () => setLocalGames(listAuthoredGames());

  const refreshExplore = () => {
    setExploreLoading(true);
    setExploreFailed(false);
    void loadExplorePacks({ fresh: true }).then((result) => {
      if (result.ok) {
        setPacks(result.packs);
        const next: Partial<Record<ExploreCategorySlug, number>> = {};
        for (const entry of result.categories) next[entry.slug] = entry.count;
        setCategoryCounts(next);
      } else {
        setExploreFailed(true);
      }
      setExploreLoading(false);
    });
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
    refreshExplore();
    const onFocus = () => refreshLocal();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const featured = useMemo(() => packs.filter((pack) => pack.featured).slice(0, 2), [packs]);
  const publicCount = packs.length;

  const download = async (entry: CloudGameEntry) => {
    setBusyId(entry.id);
    setMessage("");
    try {
      const sourceUrl = entry.versionId && process.env.NODE_ENV === "production"
        ? "/api/games/" + encodeURIComponent(entry.id) + "?v=" + encodeURIComponent(entry.versionId)
        : packUrl(entry);
      const response = await fetch(sourceUrl, { cache: entry.versionId ? "force-cache" : "no-cache" });
      if (!response.ok) throw new Error("游戏包下载失败（HTTP " + response.status + "）");
      const outcome = importGamePackageChecked(await response.text());
      if (outcome.status === "error") {
        setMessage(outcome.message);
        return;
      }
      if (outcome.status === "conflict") {
        setMessage(
          "云端游戏与你本机的同名游戏内容不同。为保护你的本机游戏和进度，未覆盖；如需更新，请先在创作中心处理本机游戏。",
        );
        return;
      }
      refreshLocal();
      if (outcome.status === "already-exists") {
        setMessage(
          "云端游戏与本机已安装的「" + outcome.game.title + "」内容相同，未重复写入，可直接开始。",
        );
        return;
      }
      const warningCount = outcome.issues.filter((issue) => issue.severity === "warning").length;
      setMessage(warningCount
        ? "已下载并保存「" + outcome.game.title + "」；有 " + warningCount + " 项提醒，请在创作中心检查。"
        : "已下载并保存「" + outcome.game.title + "」，可在上方本机游戏中直接开始。");
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
    <Screen title="游戏中心" subtitle="发现、选择，然后出发">
      <section className="hero-explore rounded-2xl px-5 py-6">
        <p className="game-kicker">探索中心</p>
        <h2 className="mt-2 text-[26px] font-bold leading-tight">世界很大，值得亲自去发现。</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/80">
          发现身边与自然中的有趣探索：按兴趣选题材，走进现场找线索。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/explore" className="btn btn-primary px-4">
            发现探索
          </Link>
          <Link href="/tutorial" className="btn btn-secondary px-4">
            先看玩法演示
          </Link>
        </div>
        <p className="mt-3 text-[12px] text-white/70">
          {exploreLoading
            ? "正在读取公开探索包…"
            : exploreFailed
              ? "探索内容暂时无法读取"
              : publicCount > 0
                ? `目前有 ${publicCount} 个公开探索包`
                : "公开探索包即将上线"}
        </p>
      </section>

      {message ? (
        <div role="status" className="card mt-3 p-3 text-sm leading-relaxed">
          {message}
        </div>
      ) : null}

      {exploreLoading ? (
        <div className="mt-4">
          <LoadingState label="正在读取探索内容…" />
        </div>
      ) : null}

      {!exploreLoading && exploreFailed ? (
        <div className="card mt-4 p-4">
          <p className="text-[13px] font-semibold">暂时无法读取探索内容</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
            网络或服务暂时不可用。你仍然可以玩本机游戏，或稍后重试。
          </p>
          <button type="button" className="btn btn-secondary mt-3" onClick={refreshExplore}>
            重试
          </button>
        </div>
      ) : null}

      {!exploreLoading && !exploreFailed && featured.length > 0 ? (
        <section className="mt-5" aria-labelledby="featured-title">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h2 id="featured-title" className="text-lg font-bold">
                精选探索
              </h2>
              <p className="text-[12px] text-[var(--muted)]">编辑挑选的公开探索，先看这一个。</p>
            </div>
            <Link href="/explore" className="text-[12px] font-semibold text-[var(--accent-deep)]">
              全部 →
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {featured.map((pack) => (
              <li key={pack.gameId}>
                <PackCard pack={pack} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-5" aria-labelledby="categories-title">
        <h2 id="categories-title" className="text-lg font-bold">
          按兴趣发现
        </h2>
        <p className="mt-0.5 text-[12px] text-[var(--muted)]">三个方向，覆盖文化、自然与场所活动。</p>
        <div className="mt-2">
          <CategoryTiles counts={categoryCounts} categories={EXPLORE_CATEGORIES} />
        </div>
      </section>

      <section className="card mt-5 overflow-hidden">
        <div className="relative h-[190px] bg-[var(--gold-chalk)]">
          <MapView player={demoPlayer} entries={demoEntries} huntArea={demoGame.huntArea} tileProvider="osm" fitToHunt />
          <span className="pointer-events-none absolute bottom-2 left-2 z-[700] rounded-full border border-white/70 bg-[var(--hero-teal-veil)] px-3 py-1 text-[12px] font-semibold text-white shadow">玩法示范 · 模拟位置</span>
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-bold tracking-[0.18em] text-[var(--muted)]">HOW TO PLAY</p>
              <h2 className="mt-1 text-xl font-bold">先看示范，再开始探索</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">看地图、走近地点、解锁任务、收集线索。示范不会读取真实位置。</p>
            </div>
            <Link href="/tutorial" className="btn btn-primary shrink-0 px-3 text-sm">开始演示</Link>
          </div>
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">本机游戏</h2>
            <p className="text-[12px] text-[var(--muted)]">已导入或由创作中心保存，可直接游玩。</p>
          </div>
          <button type="button" className="btn btn-ghost min-h-9 px-2 text-xs" onClick={refreshLocal}>刷新</button>
        </div>
        <div className="grid gap-2">
          {localGames.map((game) => (
            <article key={game.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold">{game.title}</h3>
                  <p className="mt-1 text-[12px] text-[var(--muted)]">{game.scenes.length} 个地点 · 约 {game.estimatedMinutes ?? "—"} 分钟</p>
                </div>
                <span className="chip shrink-0 bg-[var(--ok-bg)] text-[var(--ok-text)]">已就绪</span>
              </div>
              {game.description ? <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">{game.description}</p> : null}
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
          <p className="text-[12px] text-[var(--muted)]">从服务器下载到本机后即可游玩。</p>
        </div>
        {loading ? <LoadingState label="正在读取云端游戏库…" /> : (
          <div className="grid gap-3">
            {games.map((game) => (
              <article key={game.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold">{game.title}</h3>
                    <p className="mt-1 text-[12px] text-[var(--muted)]">作者：{game.author}</p>
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
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">导入统一 JSON 游戏包、校验内容、标定真实坐标，再保存到本机游戏库。</p>
        <Link href="/design#package-import" className="btn btn-secondary mt-3 w-full text-center">进入创作中心</Link>
      </section>
    </Screen>
  );
}
