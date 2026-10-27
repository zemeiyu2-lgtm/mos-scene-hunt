/**
 * Pure helpers for editing a `Challenge` in the micro designer.
 *
 * Every helper returns a new object and leaves the input untouched, so the
 * page can hand the result straight to `updateScene`. The hard rule they all
 * enforce: the shape must stay valid for the current `type`, because a pack that
 * fails validation is dropped on reload (`readAuthoredGame` returns null).
 * That is why a choice challenge never drops below two options and why a type
 * switch always carries a usable answer across.
 */

import type { Challenge, ChallengeType } from "@/lib/game/types";

export const MIN_CHOICE_OPTIONS = 2;
export const MAX_CHOICE_OPTIONS = 6;

export const CHALLENGE_TYPE_LABEL: Record<ChallengeType, string> = {
  choice: "选择题",
  keyword: "关键词题",
  text: "文本题",
};

function defaultOptions(): string[] {
  return ["选项 A", "选项 B"];
}

function answerIndex(challenge: Challenge): number {
  return typeof challenge.answer === "number" && Number.isInteger(challenge.answer)
    ? challenge.answer
    : 0;
}

/** Accepted answers as newline-separated text, for a textarea. */
export function answerLines(challenge: Challenge | undefined): string {
  if (!challenge) return "";
  const answer = challenge.answer;
  if (Array.isArray(answer)) return answer.join("\n");
  if (typeof answer === "string") return answer;
  return "";
}

/** Rewrite the accepted answers from newline-separated text. One line = one answer. */
export function withAnswerLines(challenge: Challenge, text: string): Challenge {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ...challenge, answer: lines.length ? lines : [""] };
}

/** Answers worth carrying across a type switch. */
function carryAnswers(challenge: Challenge | undefined): string[] {
  if (!challenge) return [];
  if (challenge.type === "choice") {
    const option = challenge.options?.[answerIndex(challenge)];
    return option && option.trim() ? [option.trim()] : [];
  }
  const answer = challenge.answer;
  const list = Array.isArray(answer) ? answer : typeof answer === "string" ? [answer] : [];
  return list.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/** Starter challenge used by 「添加挑战」 and by the blank game template. */
export function createChallenge(type: ChallengeType = "choice"): Challenge {
  if (type === "choice") {
    return {
      type,
      question: "你在现场观察到了什么？",
      options: ["选项 A", "选项 B"],
      answer: 0,
    };
  }
  return {
    type,
    question: type === "keyword" ? "在这里写下你看到的关键词。" : "用一句话描述你看到的。",
    answer: [type === "keyword" ? "关键词" : "答案"],
  };
}

/**
 * Switch the question type, keeping the question text and narrative extras.
 *
 * Type-specific fields are rebuilt rather than merged, so a stale `options`
 * array can never leak into a text question (the player screen keys off `type`,
 * but the validator and export would keep the dead data alive).
 */
export function changeChallengeType(
  challenge: Challenge | undefined,
  type: ChallengeType,
): Challenge {
  const source = challenge ?? createChallenge(type);
  if (source.type === type) return source;

  const next: Challenge = { type, question: source.question };
  if (source.prompt !== undefined) next.prompt = source.prompt;
  if (source.explanation !== undefined) next.explanation = source.explanation;
  if (source.hint !== undefined) next.hint = source.hint;
  if (source.hintAfterAttempts !== undefined) next.hintAfterAttempts = source.hintAfterAttempts;
  // 限时 is a property of the question, not of its type: switching 选择题 -> 简答题
  // must not silently drop the author's clock.
  if (source.timeLimitSeconds !== undefined) next.timeLimitSeconds = source.timeLimitSeconds;
  if (source.media !== undefined) next.media = source.media;

  const carried = carryAnswers(source);

  if (type === "choice") {
    const options =
      carried.length >= MIN_CHOICE_OPTIONS
        ? carried.slice(0, MAX_CHOICE_OPTIONS)
        : [...carried, ...defaultOptions()].slice(0, MAX_CHOICE_OPTIONS);
    next.options = options.length >= MIN_CHOICE_OPTIONS ? options : defaultOptions();
    next.answer = 0;
    // Reflective only makes sense for a choice challenge; a text/keyword
    // question is always graded against its accepted answers.
    if (source.reflective) next.reflective = true;
    return next;
  }

  next.answer = carried.length ? carried : [type === "keyword" ? "关键词" : "答案"];
  return next;
}

export function addChoiceOption(challenge: Challenge): Challenge {
  const options = [...(challenge.options ?? [])];
  if (options.length >= MAX_CHOICE_OPTIONS) return challenge;
  options.push(`选项 ${String.fromCharCode(65 + options.length)}`);
  return {
    ...challenge,
    options,
    answer: typeof challenge.answer === "number" ? challenge.answer : 0,
  };
}

/**
 * Whether the designer may configure a branch route on this option.
 *
 * Graded (non-reflective) choices only ever complete through the correct
 * answer, so the validator accepts a branch on that option alone - offering a
 * dropdown elsewhere would let the author build a pack that is silently
 * dropped on reload. Reflective choices complete through any deliberate
 * option, so every option may route.
 */
export function canOptionBranch(challenge: Challenge, optionIndex: number): boolean {
  if (challenge.type !== "choice") return false;
  if (challenge.reflective) return true;
  return challenge.answer === optionIndex;
}

/**
 * Point one option at a follow-up scene (branch routing). Pass `null` to
 * clear the route so the option falls back to the scene's `nextSceneId`.
 * Keys are the stringified option indexes the pack format uses.
 *
 * A graded (non-reflective) choice may only branch from its correct answer -
 * the validator rejects anything else - so calls for other options are
 * ignored instead of writing an entry the pack could not save.
 */
export function setOptionBranch(
  challenge: Challenge,
  optionIndex: number,
  targetSceneId: string | null,
): Challenge {
  if (challenge.type !== "choice") return challenge;
  if (!canOptionBranch(challenge, optionIndex)) return challenge;
  const branches: Record<string, string> = { ...(challenge.branches ?? {}) };
  if (targetSceneId) branches[String(optionIndex)] = targetSceneId;
  else delete branches[String(optionIndex)];
  if (Object.keys(branches).length === 0) {
    return { ...challenge, branches: undefined };
  }
  return { ...challenge, branches };
}

/**
 * Delete one option. Refuses to go below two (the validator requires two), and
 * keeps the correct-answer index pointing at the same option afterwards.
 * Branch routes keyed by option index shift with the option.
 */
export function removeChoiceOption(challenge: Challenge, index: number): Challenge {
  const options = [...(challenge.options ?? [])];
  if (options.length <= MIN_CHOICE_OPTIONS) return challenge;
  if (index < 0 || index >= options.length) return challenge;
  options.splice(index, 1);
  const current = answerIndex(challenge);
  const answer = current === index ? 0 : current > index ? current - 1 : current;
  // Branch routes are keyed by option index: shift the surviving entries with
  // their options and drop the removed option's route.
  let branches: Record<string, string> | undefined;
  if (challenge.branches) {
    branches = {};
    for (const [key, target] of Object.entries(challenge.branches)) {
      const i = Number(key);
      if (i === index) continue;
      branches[String(i > index ? i - 1 : i)] = target;
    }
    if (Object.keys(branches).length === 0) branches = undefined;
  }
  return {
    ...challenge,
    options,
    answer: Math.min(Math.max(answer, 0), options.length - 1),
    ...(branches ? { branches } : {}),
  };
}

export function setChoiceOption(challenge: Challenge, index: number, text: string): Challenge {
  const options = [...(challenge.options ?? [])];
  if (index < 0 || index >= options.length) return challenge;
  options[index] = text;
  return { ...challenge, options };
}

/** Mark option `index` as the correct answer, clamped into range. */
export function setCorrectOption(challenge: Challenge, index: number): Challenge {
  const count = challenge.options?.length ?? 0;
  if (count === 0) return challenge;
  const answer = Math.min(Math.max(index, 0), count - 1);
  if (challenge.reflective || !challenge.branches || answer === challenge.answer) {
    return { ...challenge, answer };
  }
  // Graded choices may only branch from the correct answer (the validator
  // enforces it). Moving the correct answer therefore re-keys the route from
  // the old correct option onto the new one - and drops any stale entries on
  // other options - so the edited pack stays valid instead of being dropped
  // on reload.
  const branches: Record<string, string> = { ...challenge.branches };
  const oldKey = String(challenge.answer);
  const newKey = String(answer);
  if (branches[oldKey] !== undefined && branches[newKey] === undefined) {
    branches[newKey] = branches[oldKey];
  }
  delete branches[oldKey];
  for (const key of Object.keys(branches)) {
    if (key !== newKey) delete branches[key];
  }
  const remaining = Object.keys(branches).length;
  return {
    ...challenge,
    answer,
    branches: remaining > 0 ? branches : undefined,
  };
}
