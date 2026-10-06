"use client";

/**
 * Reward screen.
 *
 * Confirms what the player earned and - the part that matters for the loop -
 * makes the newly unlocked next location immediately actionable.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";
import { useHunt } from "@/components/hunt-provider";
import { useGps } from "@/components/gps-provider";
import { ProgressBar, Screen } from "@/components/ui";
import { formatDistance } from "@/lib/location";
import { playSound } from "@/components/sound";

export default function RewardPage({ params }: { params: Promise<{ sceneId: string }> }) {
  // Next.js 15 hands dynamic route params to a client component as a Promise.
  const { sceneId } = use(params);
  const router = useRouter();
  const { game, state, distances, ratio, complete, statuses } = useHunt();
  const { fix } = useGps();

  const scene = game?.scenes.find((s) => s.id === sceneId) ?? null;
  const progress = state?.scenes[sceneId] ?? null;
  const reward = scene?.reward ?? null;

  const nextScene = scene?.nextSceneId
    ? game?.scenes.find((s) => s.id === scene.nextSceneId) ?? null
    : null;
  const nextDistance = nextScene ? distances[nextScene.id] ?? null : null;

  const totalCollected = state?.inventory.length ?? 0;
  const granted = progress?.status === "completed";

  useEffect(() => { if (granted) playSound(nextScene ? "reward" : "finish"); }, [granted, nextScene]);

  if (!scene || !state) {
    return (
      <Screen title="奖励" subtitle="场景不存在">
        <div className="card p-4">
          <p className="text-[14px]">找不到这个场景。</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => router.push("/map")}>
            返回地图
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="任务完成" subtitle={scene.title}>
      <section className="card overflow-hidden">
        <div className="completion-hero px-5 py-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15 text-[34px] shadow-lg">{reward?.icon ?? "✓"}</div>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/75">
            获得{reward?.type === "keyword" ? "关键词" : reward?.type === "badge" ? "徽章" : "奖励"}
          </p>
          <h2 className="mt-1 text-[26px] font-bold leading-tight">
            {reward?.title ?? "已完成"}
          </h2>
          {reward?.description ? (
            <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-white/85">
              {reward.description}
            </p>
          ) : null}
        </div>

        <div className="p-5">
          {scene.challenge?.explanation ? (
            <div className="rounded-xl bg-[var(--surface)] px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                解答
              </p>
              <p className="mt-1 text-[13.5px] leading-relaxed">{scene.challenge.explanation}</p>
            </div>
          ) : null}

          {!granted ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
              注意：这个场景似乎还没有被正式完成。请返回任务列表重新作答。
            </p>
          ) : null}

          <div className="mt-4 p-5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[var(--muted)]">整体进度</span>
              <span className="tabular font-semibold">
                {statuses.filter((s) => s.status === "completed").length} / {statuses.length} 个地点
              </span>
            </div>
            <ProgressBar ratio={ratio} className="mt-2" />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="chip bg-[var(--surface)] text-[11px] text-[var(--muted)]">
              背包共 {totalCollected} 件
            </span>
            {state.keywords.length ? (
              <span className="chip bg-amber-100 text-[11px] text-amber-800">
                关键词：{state.keywords.join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {complete ? (
        <section className="card mt-4 p-5 text-center">
          <p className="text-[30px]">🏁</p>
          <p className="mt-2 text-[16px] font-bold">你已走完全部地点</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
            这就是 V0.1 的完整闭环：现实移动 → GPS → 地点触发 → 情境 → 任务 → 奖励 → 下一地点。
          </p>
        </section>
      ) : nextScene ? (
        <section className="card mt-4 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            已解锁 · 下一个地点
          </p>
          <p className="mt-1.5 text-[16px] font-bold">{nextScene.title}</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
            {nextScene.location.name ?? "目标地点"}
          </p>

          {nextScene.briefing ? (
            <p className="mt-2.5 border-l-2 border-[var(--accent)] pl-3 text-[12.5px] italic leading-relaxed text-[var(--muted)]">
              {nextScene.briefing}
            </p>
          ) : null}

          {nextDistance ? (
            <p className="mt-3 text-[13px]">
              <span className="text-[var(--muted)]">距离：</span>
              <span className="tabular font-semibold">
                {formatDistance(nextDistance.distance)}
              </span>
            </p>
          ) : fix ? null : (
            <p className="mt-3 text-[12px] text-[var(--muted)]">正在获取定位以计算距离…</p>
          )}
        </section>
      ) : null}

      <div className="mt-4 grid gap-2">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => router.push("/map")}
        >
          在地图上继续 →
        </button>
        {nextScene ? (
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => router.push(`/scene/${nextScene.id}`)}
          >
            查看下一个地点的情境
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => router.push("/bag")}
        >
          查看背包
        </button>
      </div>
    </Screen>
  );
}
