/**
 * Tests for the challenge editing helpers (lib/game/challenge-edit.ts).
 *
 * The designer can now switch a question between choice / keyword / text and
 * add or remove choice options. These helpers own the data-shape rules, so the
 * tests pin two things: no dead type-specific field survives a switch, and the
 * result always passes the content validator (an invalid pack is dropped on
 * reload).
 */

import { describe, expect, it } from "vitest";
import {
  addChoiceOption,
  answerLines,
  changeChallengeType,
  createChallenge,
  MAX_CHOICE_OPTIONS,
  MIN_CHOICE_OPTIONS,
  removeChoiceOption,
  setChoiceOption,
  setCorrectOption,
  withAnswerLines,
} from "@/lib/game/challenge-edit";
import type { Challenge, ChallengeType, Game } from "@/lib/game/types";
import { validateGame } from "@/lib/game/types";

const CHOICE: Challenge = {
  type: "choice",
  question: "门上的数字是几？",
  options: ["一", "二", "三"],
  answer: 2,
  explanation: "看门楣上的刻字。",
  hint: "走近一点。",
  prompt: "抬头看。",
};

function gameWith(challenge: Challenge): Game {
  return {
    id: "probe",
    language: "zh-CN",
    title: "探针",
    description: "探针游戏",
    version: "0.1.0",
    startLocation: { lat: 14.58, lng: 120.97 },
    entrySceneId: "s1",
    scenes: [
      {
        id: "s1",
        title: "第一站",
        story: "故事",
        location: { lat: 14.58, lng: 120.97, radius: 20 },
        nextSceneId: null,
        challenge,
      },
    ],
  };
}

function expectValid(challenge: Challenge) {
  expect(() => validateGame(gameWith(challenge))).not.toThrow();
}

describe("changeChallengeType", () => {
  it("returns the same object when the type does not change", () => {
    expect(changeChallengeType(CHOICE, "choice")).toBe(CHOICE);
  });

  it("choice → keyword drops options and carries the correct option as the answer", () => {
    const next = changeChallengeType(CHOICE, "keyword");
    expect(next.type).toBe("keyword");
    expect(next.options).toBeUndefined();
    expect(next.answer).toEqual(["三"]);
    expect(next.question).toBe(CHOICE.question);
    expect(next.explanation).toBe(CHOICE.explanation);
    expect(next.hint).toBe(CHOICE.hint);
    expect(next.prompt).toBe(CHOICE.prompt);
    expectValid(next);
  });

  it("choice → text keeps the question and produces a graded answer", () => {
    const next = changeChallengeType(CHOICE, "text");
    expect(next.type).toBe("text");
    expect(next.options).toBeUndefined();
    expect(Array.isArray(next.answer)).toBe(true);
    expect((next.answer as string[]).length).toBeGreaterThan(0);
    expectValid(next);
  });

  it("keyword → choice rebuilds options from the accepted answers", () => {
    const keyword: Challenge = { type: "keyword", question: "看到什么？", answer: ["钟楼", "钟塔"] };
    const next = changeChallengeType(keyword, "choice");
    expect(next.type).toBe("choice");
    expect(next.options).toEqual(["钟楼", "钟塔"]);
    expect(next.answer).toBe(0);
    expectValid(next);
  });

  it("keyword with a single answer still yields a valid two-option choice", () => {
    const keyword: Challenge = { type: "keyword", question: "看到什么？", answer: ["钟楼"] };
    const next = changeChallengeType(keyword, "choice");
    expect(next.options?.length).toBeGreaterThanOrEqual(MIN_CHOICE_OPTIONS);
    expect(next.options?.[0]).toBe("钟楼");
    expectValid(next);
  });

  it("never leaves acceptedKeywords behind on a non-keyword question", () => {
    const keyword: Challenge = {
      type: "keyword",
      question: "看到什么？",
      answer: ["钟楼"],
      acceptedKeywords: ["钟声"],
    };
    expect(changeChallengeType(keyword, "choice").acceptedKeywords).toBeUndefined();
    expect(changeChallengeType(keyword, "text").acceptedKeywords).toBeUndefined();
  });

  it("keeps reflective only for choice questions", () => {
    const reflective: Challenge = { ...CHOICE, reflective: true };
    expect(changeChallengeType(reflective, "text").reflective).toBeUndefined();
  });

  it("every switch produces a pack the validator accepts", () => {
    const types: ChallengeType[] = ["choice", "keyword", "text"];
    for (const from of types) {
      for (const to of types) {
        const source = createChallenge(from);
        expectValid(changeChallengeType(source, to));
      }
    }
  });

  it("starts from a template when there is no challenge yet", () => {
    const next = changeChallengeType(undefined, "keyword");
    expect(next.type).toBe("keyword");
    expect(next.question.length).toBeGreaterThan(0);
    expectValid(next);
  });
});

describe("choice options", () => {
  it("adds an option without touching the correct answer", () => {
    const next = addChoiceOption(CHOICE);
    expect(next.options).toHaveLength(4);
    expect(next.answer).toBe(2);
    expect(next.options?.[3]).toBe("选项 D");
  });

  it("stops adding at the mobile-friendly cap", () => {
    let challenge: Challenge = { type: "choice", question: "？", options: [], answer: 0 };
    for (let i = 0; i < 10; i++) challenge = addChoiceOption(challenge);
    expect(challenge.options).toHaveLength(MAX_CHOICE_OPTIONS);
    expect(addChoiceOption(challenge)).toBe(challenge);
  });

  it("removes an option and shifts the correct answer down with it", () => {
    const next = removeChoiceOption(CHOICE, 0);
    expect(next.options).toEqual(["二", "三"]);
    expect(next.answer).toBe(1);
  });

  it("resets the correct answer when the correct option itself is removed", () => {
    const next = removeChoiceOption(CHOICE, 2);
    expect(next.options).toEqual(["一", "二"]);
    expect(next.answer).toBe(0);
  });

  it("refuses to drop below two options", () => {
    const two: Challenge = { type: "choice", question: "？", options: ["甲", "乙"], answer: 1 };
    expect(removeChoiceOption(two, 0)).toBe(two);
  });

  it("ignores out-of-range indices", () => {
    expect(removeChoiceOption(CHOICE, 9)).toBe(CHOICE);
    expect(setChoiceOption(CHOICE, 9, "x")).toBe(CHOICE);
    expect(setCorrectOption(CHOICE, 9).answer).toBe(2);
    expect(setCorrectOption(CHOICE, -3).answer).toBe(0);
  });

  it("edits one option in place without mutating the source", () => {
    const next = setChoiceOption(CHOICE, 1, "贰");
    expect(next.options?.[1]).toBe("贰");
    expect(CHOICE.options?.[1]).toBe("二");
  });

  it("setting the correct answer keeps the pack valid", () => {
    for (let i = 0; i < 3; i++) expectValid(setCorrectOption(CHOICE, i));
  });
});

describe("accepted answers as text", () => {
  it("renders one answer per line", () => {
    expect(answerLines({ type: "keyword", question: "？", answer: ["钟楼", "钟塔"] })).toBe(
      "钟楼\n钟塔",
    );
    expect(answerLines({ type: "text", question: "？", answer: "一句话" })).toBe("一句话");
    expect(answerLines(undefined)).toBe("");
  });

  it("parses lines back, trimming and dropping blanks", () => {
    const next = withAnswerLines({ type: "keyword", question: "？" }, "  钟楼 \n\n 钟塔\n");
    expect(next.answer).toEqual(["钟楼", "钟塔"]);
  });

  it("keeps one (empty) answer instead of dropping the field entirely", () => {
    const next = withAnswerLines({ type: "keyword", question: "？", answer: ["钟楼"] }, "   ");
    expect(next.answer).toEqual([""]);
  });

  it("round-trips through answerLines", () => {
    const source: Challenge = { type: "text", question: "？", answer: ["甲", "乙"] };
    expect(answerLines(withAnswerLines(source, answerLines(source)))).toBe("甲\n乙");
  });
});
