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
import { useUiLocale } from "@/components/ui-locale-provider";

export default function RewardPage({ params }: { params: Promise<{ sceneId: string }> }) {
  // Next.js 15 hands dynamic route params to a client component as a Promise.
  const { sceneId } = use(params);
  const router = useRouter();
  const { t } = useUiLocale();
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
  const isBsop = game?.id === "bsop-eight-secrets";

  useEffect(() => { if (granted) playSound(nextScene ? "reward" : "finish"); }, [granted, nextScene]);

  if (!scene || !state) {
    return (
      <Screen title={t("reward.title")} subtitle={t("reward.sceneMissing")}>
        <div className="card p-4">
          <p className="text-[14px]">{t("reward.notFound")}</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => router.push("/map")}>
            {t("reward.backToMap")}
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={t("reward.taskComplete")} subtitle={scene.title}>
      <section className="card overflow-hidden reward-main-card">
        <div className="completion-hero reward-hero px-5 py-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15 text-[34px] shadow-lg">{granted ? reward?.icon ?? "✓" : "!"}</div>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/75">
            {granted
              ? `${t("reward.earned")}${reward?.type === "keyword" ? t("reward.keyword") : reward?.type === "badge" ? t("reward.badge") : t("reward.reward")}`
              : t("reward.incompleteTitle")}
          </p>
          <h2 className="mt-1 text-[26px] font-bold leading-tight">
            {granted ? reward?.title ?? t("reward.completed") : t("reward.notClaimed")}
          </h2>
          {granted && reward?.description ? (
            <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-white/85">
              {reward.description}
            </p>
          ) : null}
        </div>

        <div className="p-5">
          {scene.challenge?.explanation ? (
            <div className="rounded-xl bg-[var(--surface)] px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                {t("reward.explanation")}
              </p>
              <p className="mt-1 text-[13.5px] leading-relaxed">{scene.challenge.explanation}</p>
            </div>
          ) : null}

          {!granted ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
              {t("reward.incompleteNote")}
            </p>
          ) : null}

          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[var(--muted)]">{t("reward.overallProgress")}</span>
              <span className="tabular font-semibold">
                {statuses.filter((s) => s.status === "completed").length} / {statuses.length} {t("reward.locations")}
              </span>
            </div>
            <ProgressBar ratio={ratio} className="mt-2" />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="chip bg-[var(--surface)] text-[11px] text-[var(--muted)]">
              {t("reward.inventoryCount")} {totalCollected} {t("reward.items")}
            </span>
            {state.keywords.length ? (
              <span className="chip bg-amber-100 text-[11px] text-amber-800">
                {t("reward.keywords")}{state.keywords.join(" · ")}
              </span>
            ) : null}
          </div>

          {isBsop ? (
            <div className="bsop-keys mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">{t("reward.sevenKeys")}</p>
                  <p className="mt-0.5 text-[12px] text-amber-900/70">{t("reward.collectSeven")}</p>
                </div>
                <span className="text-[12px] font-bold text-amber-900">{state.keywords.length}/7</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {["呼召","真理","实践","敬拜","群体","生命","忠心"].map((word) => {
                  const collected = state.keywords.includes(word);
                  return (
                    <div key={word} className={`bsop-key ${collected ? "bsop-key--on" : ""}`}>
                      <span>{collected ? "◆" : "·"}</span>
                      <b>{word}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {complete ? (
        <section className={`card mt-4 p-5 text-center ${isBsop ? "bsop-final-card" : ""}`}>
          <p className="text-[30px]">{isBsop ? "🎓" : "🏁"}</p>
          <p className="mt-2 text-[16px] font-bold">
            {isBsop ? t("reward.eightKeys") : t("reward.allLocations")}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
            {isBsop
              ? t("reward.finalBsop")
              : t("reward.gameLoop")}
          </p>
          {isBsop ? (
            <div className="mt-4 rounded-xl bg-white/70 px-3.5 py-3 text-left">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-800">{t("reward.lastTask")}</p>
              <p className="mt-1 text-[13px] font-semibold">{t("reward.reflection")}</p>
            </div>
          ) : null}
        </section>
      ) : nextScene ? (
        <section className="card mt-4 p-4 reward-next-card">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t("reward.nextUnlocked")}
          </p>
          <p className="mt-1.5 text-[16px] font-bold">{nextScene.title}</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
            {nextScene.location.name ?? t("reward.targetLocation")}
          </p>

          {nextScene.briefing ? (
            <p className="mt-2.5 border-l-2 border-[var(--accent)] pl-3 text-[12.5px] italic leading-relaxed text-[var(--muted)]">
              {nextScene.briefing}
            </p>
          ) : null}

          {nextDistance ? (
            <p className="mt-3 text-[13px]">
              <span className="text-[var(--muted)]">{t("reward.distance")}</span>
              <span className="tabular font-semibold">
                {formatDistance(nextDistance.distance)}
              </span>
            </p>
          ) : fix ? null : (
            <p className="mt-3 text-[12px] text-[var(--muted)]">{t("reward.locating")}</p>
          )}
        </section>
      ) : null}

      <div className="mt-4 grid gap-2">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => router.push(!granted ? "/scene/" + scene.id : complete ? "/bag" : "/map")}
        >
          {!granted
            ? t("reward.returnScene")
            : complete
              ? t("reward.viewFindings")
              : nextScene
                ? t("reward.nextStop")
                : t("reward.returnMap")}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => router.push(complete ? "/quest" : "/bag")}
        >
          {complete ? t("reward.viewProgress") : t("reward.viewBag")}
        </button>
      </div>
    </Screen>
  );
}
