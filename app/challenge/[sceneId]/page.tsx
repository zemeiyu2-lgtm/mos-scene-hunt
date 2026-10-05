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

export default function ChallengePage({ params }: { params: Promise<{ sceneId: string }> }) {
  // Next.js 15 hands dynamic route params to a client component as a Promise.
  const { sceneId } = use(params);
  const router = useRouter();
  const { game, state, submitAnswer, distances, current } = useHunt();

  const scene = game?.scenes.find((s) => s.id === sceneId) ?? null;
  const progress = state?.scenes[sceneId] ?? null;
  const challenge = scene?.challenge ?? null;

  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<"none" | "wrong">("none");
  /** Local echo of a correct answer, so the screen can hand off without a reload. */
  const [solved, setSolved] = useState(false);

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
      <Screen title="任务" subtitle="场景不存在">
        <div className="card p-4">
          <p className="text-[14px]">找不到这个任务。</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => router.push("/quest")}>
            返回任务列表
          </button>
        </div>
      </Screen>
    );
  }

  if (alreadyComplete && !solved) {
    return (
      <Screen title={scene.title} subtitle="已完成">
        <div className="card p-5 text-center">
          <p className="text-[28px]">✓</p>
          <p className="mt-2 text-[15px] font-semibold">你已完成这个任务</p>
          {scene.reward ? (
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              奖励：{scene.reward.title}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-block mt-4"
            onClick={() => router.push(scene.nextSceneId ? `/scene/${scene.nextSceneId}` : "/quest")}
          >
            {scene.nextSceneId ? "前往下一个地点" : "查看收获"}
          </button>
        </div>
      </Screen>
    );
  }

  const submit = () => {
    if (challenge.type === "choice") {
      if (selected === null) return;
      // Verify locally so the screen can distinguish "wrong" from "correct"
      // without waiting for a state round-trip; the engine re-verifies and is
      // the only thing that actually advances the game.
      const isCorrect = selected === challenge.answer;
      submitAnswer(scene.id, { selectedIndex: selected });
      if (isCorrect) {
        setSolved(true);
        router.push(`/reward/${scene.id}`);
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
      router.push(`/reward/${scene.id}`);
    } else {
      setFeedback("wrong");
      setText("");
    }
  };

  return (
    <Screen
      title={scene.title}
      subtitle={scene.location.name ?? "任务"}
      headerRight={<StatusChip status={progress?.status ?? "challenging"} />}
    >
      {/* The player may have stepped out of the ring mid-question. Warn, but do
          not block: the challenge stays open once opened. */}
      {!inRange ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[12.5px] leading-snug text-amber-900">
            你现在不在任务区域内（
            {distance ? `${Math.round(distance.distance)} m` : "未知"}）。已打开的任务可以继续完成，
            但建议回到地点附近以获得最佳体验。
          </p>
        </div>
      ) : null}

      <section className="card story-card p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {challenge.type === "choice" ? "选择题" : challenge.type === "keyword" ? "关键词题" : "简答题"}
        </p>
        <h2 className="mt-2 text-[17px] font-bold leading-snug">{challenge.question}</h2>
        {challenge.prompt ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{challenge.prompt}</p>
        ) : null}
      </section>

      {challenge.type === "choice" && challenge.options ? (
        <section className="mt-3 space-y-2">
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
            你的答案
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
              challenge.type === "keyword" ? "输入关键词…" : "输入你的答案…"
            }
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="done"
          />
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            大小写、全角半角与标点都会被自动忽略。
          </p>
        </section>
      )}

      {feedback === "wrong" ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-[13px] font-semibold text-red-800">答案不正确</p>
          <p className="mt-0.5 text-[12px] leading-snug text-red-700">
            已记录第 {attempts} 次尝试。可以再试一次——答错不会丢失任何进度。
          </p>
        </div>
      ) : null}

      {hintVisible && challenge.hint ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-amber-900">提示</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-900">{challenge.hint}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={submit}
          disabled={challenge.type === "choice" ? selected === null : text.trim().length === 0}
        >
          提交答案
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => (current ? router.push("/map") : router.push("/quest"))}
        >
          回到地图
        </button>
      </div>

      {attempts > 0 && !challenge.hint ? (
        <p className="mt-3 text-center text-[11.5px] text-[var(--muted)]">
          提示：答案与你在现场能观察到的具体事物有关，不必想得太复杂。
        </p>
      ) : null}
    </Screen>
  );
}
