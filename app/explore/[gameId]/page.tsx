"use client";

/**
 * 探索包详情 — the third layer, and the page that has to earn the tap.
 *
 * Every factual line comes from the published pack: the story, the station
 * count, the challenge mix, the reward mix, the duration, the difficulty, the
 * area and the meeting point. The editorial layer only adds framing (category,
 * tags, audience, preparation, safety) and never adds numbers.
 *
 * The primary action is delegated to <StartExploreButton/>, which installs the
 * pack and hands over to the untouched `/select` -> `/map` flow. This page reads
 * no local state and writes none.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, Screen } from "@/components/ui";
import { PackCover } from "@/components/explore/pack-cover";
import { StartExploreButton } from "@/components/explore/start-explore-button";
import { SharePack } from "@/components/explore/share-pack";
import { loadExplorePack, packHref } from "@/lib/explore/client";
import {
  CHALLENGE_LABEL,
  REWARD_LABEL,
  areaLabel,
  difficultyLabel,
  durationLabel,
  type ExplorePack,
} from "@/lib/explore/summary";
import { categoryBySlug } from "@/lib/explore/taxonomy";
import type { ExploreError } from "@/lib/explore/client";

export default function ExplorePackPage() {
  const params = useParams<{ gameId: string }>();
  const gameId = typeof params?.gameId === "string" ? params.gameId : "";

  const [pack, setPack] = useState<ExplorePack | null>(null);
  const [error, setError] = useState<ExploreError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!gameId) {
      setLoading(false);
      setError({ kind: "not_found", status: 404, code: "pack_not_found", message: "探索包不存在。" });
      return;
    }
    setLoading(true);
    setError(null);
    void loadExplorePack(gameId).then((result) => {
      if (result.ok) setPack(result.pack);
      else setError(result.error);
      setLoading(false);
    });
  }, [gameId]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Link href="/explore" className="btn btn-ghost min-h-9 px-2 text-sm">
      返回
    </Link>
  );

  if (loading) {
    return (
      <Screen title="探索包" headerRight={back}>
        <LoadingState label="正在读取探索包…" />
      </Screen>
    );
  }

  if (error || !pack) {
    const missing = error?.kind === "not_found";
    return (
      <Screen title="探索包" headerRight={back}>
        {missing ? (
          <EmptyState
            title="这个探索包还没有公开"
            hint="它可能尚未发布、已撤下，或者链接不完整。"
            actions={
              <>
                <Link href="/explore" className="btn btn-secondary min-h-11 px-4 text-center text-sm">
                  浏览全部探索
                </Link>
                <Link href="/games" className="btn btn-ghost min-h-11 px-4 text-center text-sm">
                  返回探索中心
                </Link>
              </>
            }
          />
        ) : (
          <ErrorState
            title="暂时无法读取这个探索包"
            detail={error?.message ?? "请稍后重试。"}
            onRetry={load}
          />
        )}
      </Screen>
    );
  }

  const category = categoryBySlug(pack.category);
  const duration = durationLabel(pack.minutes);
  const difficulty = difficultyLabel(pack.difficulty);
  const area = areaLabel(pack.areaMeters);
  const challenges = pack.challengeMix
    .map((item) => `${item.count} 个${CHALLENGE_LABEL[item.type] ?? "任务"}`)
    .join(" · ");
  const rewards = pack.rewardMix
    .map((item) => `${REWARD_LABEL[item.type] ?? item.type} ×${item.count}`)
    .join(" · ");

  return (
    <Screen
      title="探索包"
      subtitle={category ? `${category.label} · ${pack.sceneCount} 个站点` : `${pack.sceneCount} 个站点`}
      headerRight={back}
    >
      <article>
        <PackCover category={pack.category} title={pack.title} size="hero" />

        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {category ? (
              <span className="chip" style={{ color: category.accentVar, borderColor: "var(--line)" }}>
                {category.label}
              </span>
            ) : null}
            {pack.tags.map((tag) => (
              <span key={tag} className="chip bg-[var(--surface)] text-[var(--muted)]">
                {tag}
              </span>
            ))}
          </div>
          <h1 className="mt-2 text-[24px] font-bold leading-tight">{pack.title}</h1>
          {pack.tagline && !pack.description.startsWith(pack.tagline) ? (
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">{pack.tagline}</p>
          ) : null}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: "地点", v: pack.place ?? "现场集合" },
            { k: "时长", v: duration ?? "未标注" },
            { k: "难度", v: difficulty ?? "未标注" },
            { k: "范围", v: area ?? "未标注" },
          ].map((item) => (
            <div key={item.k} className="rounded-xl bg-[var(--surface)] px-3 py-2">
              <dt className="text-[12px] text-[var(--muted)]">{item.k}</dt>
              <dd className="mt-0.5 text-[13px] font-semibold leading-snug">{item.v}</dd>
            </div>
          ))}
        </dl>

        {pack.description ? (
          <section className="card mt-4 p-4" aria-labelledby="story-title">
            <h2 id="story-title" className="text-[15px] font-bold">
              为什么值得走这一趟
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">{pack.description}</p>
            {pack.author ? (
              <p className="mt-2 text-[12px] text-[var(--muted)]">作者：{pack.author}</p>
            ) : null}
          </section>
        ) : null}

        {pack.goals.length > 0 ? (
          <section className="card mt-3 p-4" aria-labelledby="goals-title">
            <h2 id="goals-title" className="text-[15px] font-bold">
              你会经历什么
            </h2>
            <ul className="mt-2 space-y-1.5">
              {pack.goals.map((goal) => (
                <li key={goal} className="flex gap-2 text-[13px] leading-relaxed text-[var(--muted)]">
                  <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                  <span>{goal}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card mt-3 p-4" aria-labelledby="gameplay-title">
          <h2 id="gameplay-title" className="text-[15px] font-bold">
            玩法预览
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="chip bg-[var(--surface)]">{pack.sceneCount} 个站点</span>
            {challenges ? <span className="chip bg-[var(--surface)]">{challenges}</span> : null}
            {rewards ? <span className="chip bg-[var(--surface)]">{rewards}</span> : null}
          </div>
          <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="站点顺序">
            {Array.from({ length: pack.sceneCount }, (_, index) => (
              <li
                key={index}
                className="grid h-7 w-7 place-items-center rounded-full bg-[var(--line)] text-[12px] font-bold text-[var(--muted)]"
              >
                {index + 1}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
            到达现场、进入站点范围后，当站内容才会展开；具体的题目与线索在到达前不会剧透。
          </p>
        </section>

        <section className="card mt-3 p-4" aria-labelledby="join-title">
          <h2 id="join-title" className="text-[15px] font-bold">
            参与信息
          </h2>
          <dl className="mt-2 space-y-1.5">
            {[
              { k: "适合", v: pack.audience },
              { k: "形式", v: pack.teamMode },
              { k: "集合点", v: pack.place },
              { k: "探索范围", v: area },
            ]
              .filter((row) => Boolean(row.v))
              .map((row) => (
                <div key={row.k} className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-[12px] text-[var(--muted)]">{row.k}</dt>
                  <dd className="text-right text-[13px] leading-snug">{row.v}</dd>
                </div>
              ))}
          </dl>

          {pack.preparations.length > 0 ? (
            <>
              <p className="mt-3 text-[13px] font-semibold">出发前准备</p>
              <ul className="mt-1 space-y-1">
                {pack.preparations.map((item) => (
                  <li key={item} className="text-[13px] leading-relaxed text-[var(--muted)]">
                    · {item}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {pack.safety.length > 0 ? (
            <>
              <p className="mt-3 text-[13px] font-semibold">安全提醒</p>
              <ul className="mt-1 space-y-1">
                {pack.safety.map((item) => (
                  <li key={item} className="text-[13px] leading-relaxed text-[var(--muted)]">
                    · {item}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <div className="mt-4">
          <StartExploreButton
            gameId={pack.gameId}
            title={pack.title}
            fromPath={packHref(pack.gameId)}
          />
          <p className="mt-2 text-center text-[12px] leading-relaxed text-[var(--muted)]">
            开始后会请求位置权限；进度保存在本机，无需注册。
          </p>
        </div>

        <SharePack gameId={pack.gameId} title={pack.title} />

        <div className="mt-4 grid gap-2">
          <Link href="/explore" className="btn btn-ghost btn-block">
            看看其他探索
          </Link>
        </div>
      </article>
    </Screen>
  );
}
