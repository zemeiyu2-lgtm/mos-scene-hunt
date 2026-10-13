"use client";

/**
 * Challenge screen.
 *
 * Spec section 12 puts this between Scene and Reward. The three V0.1 challenge
 * types (`choice`, `keyword`, `text`) share one screen with different input
 * affordances, so there is a single place where "correct answer" is handled and
 * a single place where hint escalation lives.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";
import { useHunt } from "@/components/hunt-provider";
import { Screen, StatusChip } from "@/components/ui";
import { matchTextAnswer } from "@/lib/game/answers";
import { playSound } from "@/components/sound";
import { MediaGallery } from "@/components/media-gallery";
import { useUiLocale } from "@/components/ui-locale-provider";

export default function ChallengePage({ params }: { params: Promise<{ sceneId: string }> }) {
  // Next.js 15 hands dynamic route params to a client component as a Promise.
  const { sceneId } = use(params);
  const router = useRouter();
  const { t } = useUiLocale();
  const { game, state, submitAnswer, distances, current } = useHunt();

  const scene = game?.scenes.find((s) => s.id === sceneId) ?? null;
  const progress = state?.scenes[sceneId] ?? null;
  const challenge = scene?.challenge ?? null;

  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<"none" | "wrong" | "correct">("none");
  /** Local echo of a correct answer, so the screen can hand off without a reload. */
  const [solved, setSolved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const attempts = progress?.attempts ?? 0;
  const alreadyComplete = progress?.status === "completed";

  const hintVisible = useMemo(() => {
    if (!challenge) return false;
    const threshold = challenge.hintAfterAttempts ?? 0;
    if (threshold <= 0) return false;
    return attempts >= threshold;
  }, [challenge, attempts]);

  const distance = scene ? distances[scene.id] ?? null : null;
  const inRange = distance?.inRange ?? false;

  if (!scene || !challenge || !state) {
    return (
      <Screen title={t("challenge.task")} subtitle={t("challenge.sceneMissing")}>
        <div className="card p-4">
          <p className="text-[14px]">{t("challenge.notFound")}</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => router.push("/quest")}>
            {t("challenge.returnList")}
          </button>
        </div>
      </Screen>
    );
  }

  if (alreadyComplete && !solved) {
    return (
      <Screen title={scene.title} subtitle={t("status.completed")}>
        <div className="card p-5 text-center">
          <p className="text-[28px]">✓</p>
          <p className="mt-2 text-[15px] font-semibold">{t("challenge.done")}</p>
          {scene.reward ? (
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              {t("challenge.reward")}{scene.reward.title}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-block mt-4"
            onClick={() => router.push(scene.nextSceneId ? `/scene/${scene.nextSceneId}` : "/quest")}
          >
            {scene.nextSceneId ? t("challenge.nextLocation") : t("challenge.viewFindings")}
          </button>
        </div>
      </Screen>
    );
  }

  const submit = () => {
    if (submitting) return;
    if (challenge.type === "choice") {
      if (selected === null) return;
      // Verify locally so the screen can distinguish "wrong" from "correct"
      // without waiting for a state round-trip; the engine re-verifies and is
      // the only thing that actually advances the game.
      const isCorrect = Boolean(challenge.reflective) || selected === challenge.answer;
      submitAnswer(scene.id, { selectedIndex: selected });
      if (isCorrect) {
        setSolved(true);
        setSubmitting(true);
        setFeedback("correct");
        playSound("success");
        window.setTimeout(() => router.push(`/reward/${scene.id}`), 620);
      } else {
        setFeedback("wrong");
        setSelected(null);
      }
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    // `answer` is a union across challenge types; for keyword/text it is always a
    // string or string[], but narrow explicitly so the types stay honest.
    const answer = Array.isArray(challenge.answer)
      ? challenge.answer
      : typeof challenge.answer === "string"
        ? [challenge.answer]
        : [];
    const result = matchTextAnswer(trimmed, answer, {
      acceptedExtra: challenge.acceptedKeywords ?? [],
    });
    submitAnswer(scene.id, { text: trimmed });
    if (result.correct) {
      setSolved(true);
      setSubmitting(true);
      setFeedback("correct");
      playSound("success");
      window.setTimeout(() => router.push(`/reward/${scene.id}`), 620);
    } else {
      setFeedback("wrong");
      setText("");
    }
  };

  return (
    <Screen
      title={scene.title}
      subtitle={scene.location.name ?? t("challenge.task")}
      headerRight={<StatusChip status={progress?.status ?? "challenging"} />}
    >
      {/* The player may have stepped out of the ring mid-question. Warn, but do
          not block: the challenge stays open once opened. */}
      {!inRange ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[12.5px] leading-snug text-amber-900">
            {t("challenge.outsideArea")}（
            {distance ? `${Math.round(distance.distance)} m` : t("challenge.distanceUnknown")}）。{t("challenge.continueOutside")}
          </p>
        </div>
      ) : null}

      <section className="card story-card p-5 challenge-reveal challenge-question-card">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {challenge.type === "choice" ? t("challenge.choiceType") : challenge.type === "keyword" ? t("challenge.keywordType") : t("challenge.textType")}
        </p>
        <h2 className="mt-2 text-[17px] font-bold leading-snug">{challenge.question}</h2>
        {challenge.prompt ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{challenge.prompt}</p>
        ) : null}
      </section>

      <MediaGallery media={challenge.media} />

      {challenge.type === "choice" && challenge.options ? (
        <section className="mt-3 space-y-2 challenge-options">
          {challenge.options.map((option, index) => {
            const active = selected === index;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSelected(index);
                  setFeedback("none");
                }}
                className="choice-card flex w-full items-center gap-3 px-4 py-4 text-left" data-active={active}
                aria-pressed={active}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ${active ? "bg-[var(--accent)] text-[#3a2400]" : "bg-[var(--line)] text-[var(--muted)]"}`}
                >
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="text-[15px]">{option}</span>
              </button>
            );
          })}
        </section>
      ) : (
        <section className="mt-3">
          <label htmlFor="answer-input" className="sr-only">
            {t("challenge.yourAnswer")}
          </label>
          <input
            id="answer-input"
            className="input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFeedback("none");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={
              challenge.type === "keyword" ? t("challenge.keywordPlaceholder") : t("challenge.answerPlaceholder")
            }
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="done"
          />
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            {t("challenge.normalizationHint")}
          </p>
        </section>
      )}

      {feedback === "correct" ? (
        <div className="success-pulse mt-3">
          <p className="text-[15px] font-bold text-emerald-800">✓ {t("challenge.solved")}</p>
          <p className="mt-0.5 text-[12px] text-emerald-700">{t("challenge.keyComing")}</p>
        </div>
      ) : feedback === "wrong" ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-[13px] font-semibold text-red-800">{t("challenge.wrong")}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-red-700">
            {t("challenge.wrongHint")}
          </p>
        </div>
      ) : null}

      {hintVisible && challenge.hint ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-amber-900">{t("challenge.hint")}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-900">{challenge.hint}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 challenge-actions">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={submit}
          disabled={submitting || (challenge.type === "choice" ? selected === null : text.trim().length === 0)}
        >
          {submitting ? t("challenge.submitting") : t("challenge.submit")}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => (current ? router.push("/map") : router.push("/quest"))}
        >
          {t("challenge.backToMap")}
        </button>
      </div>

      {attempts > 0 && !challenge.hint ? (
        <p className="mt-3 text-center text-[11.5px] text-[var(--muted)]">
          {t("challenge.attemptHint")}
        </p>
      ) : null}
    </Screen>
  );
}
