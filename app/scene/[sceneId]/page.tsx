"use client";

/**
 * Scene screen - shown on arrival inside the trigger radius.
 *
 * This is where the story lands. The narrative fields (`story`, `briefing`,
 * `npc`, `dialogue`) are rendered straight from the content pack: V0.1 reads them
 * statically, and a future AI story engine would populate the same fields.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";
import { useHunt } from "@/components/hunt-provider";
import { Screen, StatusChip } from "@/components/ui";
import { formatDistance } from "@/lib/location";
import { playSound } from "@/components/sound";
import { MediaGallery } from "@/components/media-gallery";
import { playSound } from "@/components/sound";

export default function ScenePage({ params }: { params: Promise<{ sceneId: string }> }) {
  // Next.js 15 hands dynamic route params to a client component as a Promise.
  const { sceneId } = use(params);
  const router = useRouter();
  const { game, state, openChallenge, enterScene, distances, statuses } = useHunt();

  const scene = game?.scenes.find((s) => s.id === sceneId) ?? null;
  const progress = state?.scenes[sceneId] ?? null;
  const distance = scene ? distances[scene.id] ?? null : null;

  // Opening the scene also opens its challenge, so the transition to the
  // question screen has no extra round-trip.
  useEffect(() => {
    if (!scene || !state) return;
    if (progress?.status === "completed") return;
    if (distance && !distance.inRange && progress?.status !== "challenging") return;
    if (progress?.status !== "challenging") {
      openChallenge(scene.id);
    }
    // Intentionally keyed on identity + status only: re-running on every fix
    // would dispatch on each GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, progress?.status, state?.gameId]);

  if (!scene || !state) {
    return (
      <Screen title="情境" subtitle="场景不存在">
        <div className="card p-4">
          <p className="text-[14px]">找不到这个场景。</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => router.push("/map")}>
            返回地图
          </button>
        </div>
      </Screen>
    );
  }

  const status = statuses.find((s) => s.scene.id === sceneId)?.status ?? progress?.status ?? "arrived";
  const isComplete = status === "completed";

  // Split the story on blank lines so authors can control paragraph rhythm with
  // plain text instead of embedding markup.
  const paragraphs = scene.story.split(/
{2,}/).filter(Boolean);

  return (
    <Screen
      title={scene.title}
      subtitle={scene.location.name ?? "情境"}
      headerRight={<StatusChip status={isComplete ? "completed" : "arrived"} />}
    >
      {!isComplete && distance && !distance.inRange ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[12.5px] leading-snug text-amber-900">
            你已离开任务区域（当前 {formatDistance(distance.distance)}）。情境已解锁，可以继续阅读与作答。
          </p>
        </div>
      ) : null}

      <article className="card story-card p-5">
        {scene.briefing ? (
          <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-3 text-[12.5px] italic leading-relaxed text-amber-900">
            {scene.briefing}
          </p>
        ) : null}

        {paragraphs.map((para, i) => (
          <p
            key={i}
            className="mb-4 whitespace-pre-line text-[16px] leading-[1.8] last:mb-0"
          >
            {para}
          </p>
        ))}

        <MediaGallery media={scene.media} />

        {scene.npc ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-[var(--surface)] px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--line)] text-[16px]">
              {scene.npc.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={scene.npc.avatar}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                "☺"
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{scene.npc.name}</p>
              {scene.npc.role ? (
                <p className="text-[11.5px] text-[var(--muted)]">{scene.npc.role}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {scene.dialogue?.length ? (
          <div className="mt-3 space-y-2">
            {scene.dialogue.map((line, i) => (
              <p
                key={i}
                className="rounded-xl bg-[var(--surface)] px-3 py-2 text-[13.5px] leading-relaxed"
              >
                <span className="mr-1.5 text-[11px] font-semibold text-[var(--muted)]">
                  {line.speaker === "narrator"
                    ? "旁白"
                    : line.speaker === "player"
                      ? "你"
                      : scene.npc?.name ?? line.speaker}
                </span>
                {line.text}
              </p>
            ))}
          </div>
        ) : null}
      </article>

      <div className="mt-4 grid gap-2">
        {isComplete ? (
          <>
            <div className="card mb-1 p-4 text-center">
              <p className="text-[24px]">✓</p>
              <p className="mt-1 text-[14px] font-semibold">这个情境已经完成</p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() =>
                router.push(scene.nextSceneId ? `/scene/${scene.nextSceneId}` : "/quest")
              }
            >
              {scene.nextSceneId ? "前往下一个地点" : "查看全部收获"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => router.push("/map")}
            >
              返回地图
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                enterScene(scene.id);
                openChallenge(scene.id);
                router.push(`/challenge/${scene.id}`);
              }}
            >
              {scene.challenge ? "开始任务 →" : "完成这一站 →"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => router.push("/map")}
            >
              稍后再做
            </button>
          </>
        )}
      </div>
    </Screen>
  );
}
