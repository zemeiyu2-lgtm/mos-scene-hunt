// @vitest-environment jsdom
/**
 * Save-gate tests for the micro designer.
 *
 * The invariant under test: if `saveAuthoredGame` reports success, the very
 * next `readAuthoredGame` must return the same pack. Before the gate existed,
 * `save()` wrote whatever the editor held straight into localStorage, while
 * `readAuthoredGame` re-validated on the way out - so an invalid draft was
 * "saved" and then silently vanished from the library on reload.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  readAuthoredGame,
  saveAuthoredGame,
  saveAuthoredGameChecked,
} from "@/lib/content";
import type { Challenge, Game } from "@/lib/game/types";

const KEY_PREFIX = "mos-scene-hunt:authoring:";

function validGame(id = "guard-base"): Game {
  return {
    id,
    language: "zh-CN",
    title: "保存门槛测试",
    description: "用于验证保存校验",
    version: "0.1.0",
    startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
    huntArea: {
      center: { lat: 14.58305, lng: 120.97936 },
      radiusMeters: 300,
      shape: "circle",
      name: "区域",
    },
    entrySceneId: "s1",
    scenes: [
      {
        id: "s1",
        title: "第一站",
        story: "故事",
        location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "第一站" },
        nextSceneId: null,
        challenge: {
          type: "choice",
          question: "选哪个？",
          options: ["甲", "乙"],
          answer: 0,
        },
        reward: { type: "keyword", title: "线索", value: "线索" },
      },
    ],
  };
}

/** Trimmed to the fields each invalid case needs, so failures stay readable. */
function invalidCases(): Array<{ name: string; game: Game }> {
  const cases: Array<{ name: string; game: Game }> = [];

  const noTitle = validGame("bad-no-title");
  noTitle.title = "   ";
  cases.push({ name: "标题为空", game: noTitle });

  const noScenes = validGame("bad-no-scenes");
  noScenes.scenes = [];
  cases.push({ name: "没有任何场景", game: noScenes });

  const oneOption = validGame("bad-one-option");
  oneOption.scenes[0].challenge = {
    type: "choice",
    question: "只有一项？",
    options: ["唯一"],
    answer: 0,
  };
  cases.push({ name: "选择题只剩一个选项", game: oneOption });

  const outOfRange = validGame("bad-answer-range");
  outOfRange.scenes[0].challenge = {
    type: "choice",
    question: "越界答案？",
    options: ["甲", "乙"],
    answer: 5,
  };
  cases.push({ name: "正确答案下标越界", game: outOfRange });

  const wrongAnswerType = validGame("bad-answer-type");
  wrongAnswerType.scenes[0].challenge = {
    type: "choice",
    question: "答案类型错？",
    options: ["甲", "乙"],
    answer: "甲",
  };
  cases.push({ name: "选择题答案不是下标", game: wrongAnswerType });

  const emptyTextAnswer = validGame("bad-empty-answer");
  emptyTextAnswer.scenes[0].challenge = {
    type: "text",
    question: "文本题无答案？",
    answer: [],
  };
  cases.push({ name: "文本题答案为空", game: emptyTextAnswer });

  const danglingNext = validGame("bad-dangling-next");
  danglingNext.scenes[0].nextSceneId = "不存在";
  cases.push({ name: "下一站指向不存在的场景", game: danglingNext });

  return cases;
}

describe("保存门槛", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("有效游戏保存后可以原样读回", () => {
    const game = validGame();
    expect(saveAuthoredGame(game)).toBe(true);
    expect(readAuthoredGame(game.id)?.title).toBe(game.title);
  });

  it.each(invalidCases())("无效数据（$name）被拒绝且不写入", ({ game }) => {
    expect(saveAuthoredGame(game)).toBe(false);
    // Nothing was persisted, so the slot is exactly as it was before the attempt.
    expect(window.localStorage.getItem(`${KEY_PREFIX}${game.id}`)).toBeNull();
  });

  it("校验失败时不会覆盖已有的有效存档", () => {
    const game = validGame("guard-existing");
    expect(saveAuthoredGame(game)).toBe(true);
    const before = window.localStorage.getItem(`${KEY_PREFIX}${game.id}`);

    const broken = structuredClone(game);
    broken.title = "";
    const result = saveAuthoredGameChecked(broken);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem(`${KEY_PREFIX}${game.id}`)).toBe(before);
    expect(readAuthoredGame(game.id)?.title).toBe(game.title);
  });

  it("错误信息指出具体问题，而不是只说保存失败", () => {
    const broken = validGame("guard-message");
    broken.scenes[0].challenge = {
      type: "choice",
      question: "越界答案？",
      options: ["甲", "乙"],
      answer: 9,
    };
    const result = saveAuthoredGameChecked(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.message).join(" | ")).toContain("下标越界");
  });

  it("警告不影响保存", () => {
    const withWarning = validGame("guard-warning");
    withWarning.scenes[0].location.radius = 2; // below the recommended floor
    const result = saveAuthoredGameChecked(withWarning);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(readAuthoredGame(withWarning.id)).not.toBeNull();
  });

  it("三种挑战类型都能通过保存门槛", () => {
    const challenges: Challenge[] = [
      { type: "choice", question: "选择题", options: ["甲", "乙"], answer: 1 },
      { type: "text", question: "文本题", answer: ["钟楼"] },
      { type: "keyword", question: "关键词题", answer: ["钟楼", "钟塔"] },
    ];
    for (const [i, challenge] of challenges.entries()) {
      const game = validGame(`guard-type-${i}`);
      game.scenes[0].challenge = structuredClone(challenge);
      expect(saveAuthoredGameChecked(game).ok).toBe(true);
      expect(readAuthoredGame(game.id)?.scenes[0].challenge?.type).toBe(challenge.type);
    }
  });

  it("空白游戏模板本身可以通过保存门槛", async () => {
    const { createBlankGame } = await import("@/app/design/design-game");
    const blank = createBlankGame({ id: "guard-blank", startLocation: { lat: 14.5, lng: 120.9 } });
    const result = saveAuthoredGameChecked(blank);
    expect(result.ok).toBe(true);
    expect(readAuthoredGame("guard-blank")?.scenes.length).toBe(1);
  });
});
