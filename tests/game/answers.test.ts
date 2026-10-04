/**
 * Answer normalisation and matching tests.
 * Real players type sloppily; these tests pin down exactly how forgiving we are.
 */

import { describe, expect, it } from "vitest";
import {
  buildAcceptedPool,
  foldTraditional,
  foldWidth,
  levenshtein,
  matchChoiceAnswer,
  matchTextAnswer,
  normalizeAnswer,
} from "@/lib/game/answers";

describe("normalizeAnswer", () => {
  it("lowercases and strips surrounding whitespace", () => {
    expect(normalizeAnswer("  Memory  ")).toBe("memory");
  });

  it("strips punctuation, including CJK punctuation", () => {
    expect(normalizeAnswer("memory!!")).toBe("memory");
    expect(normalizeAnswer("记忆。")).toBe("记忆");
    expect(normalizeAnswer("归处，")).toBe("归处");
    expect(normalizeAnswer("记忆 · 方向")).toBe("记忆方向");
  });

  it("folds full-width characters to half-width", () => {
    expect(foldWidth("ＡＢＣ")).toBe("ABC");
    expect(foldWidth("１２３")).toBe("123");
    expect(normalizeAnswer("ＭＥＭＯＲＹ")).toBe("memory");
  });

  it("folds common traditional characters to simplified", () => {
    expect(foldTraditional("記憶")).toBe("记忆");
    expect(foldTraditional("方向")).toBe("方向");
    expect(normalizeAnswer("記憶")).toBe("记忆");
  });

  it("returns an empty string for non-string input", () => {
    expect(normalizeAnswer(undefined as unknown as string)).toBe("");
    expect(normalizeAnswer(null as unknown as string)).toBe("");
  });
});

describe("levenshtein", () => {
  it("computes the classic distances", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("a", "")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("memory", "memori")).toBe(1);
    expect(levenshtein("memory", "memory")).toBe(0);
  });
});

describe("matchTextAnswer", () => {
  it("accepts an exact answer", () => {
    const r = matchTextAnswer("归处", ["归处", "回家"]);
    expect(r.correct).toBe(true);
    expect(r.method).toBe("exact");
  });

  it("accepts any member of an answer list", () => {
    expect(matchTextAnswer("回家", ["归处", "回家"]).correct).toBe(true);
    expect(matchTextAnswer("故乡", ["归处", "回家", "故乡"]).correct).toBe(true);
  });

  it("is forgiving about case, width and punctuation", () => {
    expect(matchTextAnswer("  MEMORY! ", "memory").correct).toBe(true);
    expect(matchTextAnswer("Ｍｅｍｏｒｙ", "memory").correct).toBe(true);
    expect(matchTextAnswer("记忆。", "记忆").correct).toBe(true);
  });

  it("accepts a single-character typo on long latin answers", () => {
    const r = matchTextAnswer("memori", "memory");
    expect(r.correct).toBe(true);
    expect(r.method).toBe("typo");
  });

  it("does NOT apply typo tolerance to short latin answers", () => {
    // "hope" vs "home" must stay wrong: 4 chars is below the tolerance floor.
    expect(matchTextAnswer("hope", "home").correct).toBe(false);
  });

  it("does NOT apply typo tolerance to CJK, where one glyph changes meaning", () => {
    expect(matchTextAnswer("方向的", "方向").correct).toBe(false);
    expect(matchTextAnswer("归去", "归处").correct).toBe(false);
  });

  it("honours acceptedExtra keywords", () => {
    expect(matchTextAnswer("归途", "归处", { acceptedExtra: ["归途"] }).correct).toBe(true);
  });

  it("rejects an empty submission", () => {
    const r = matchTextAnswer("   ", "memory");
    expect(r.correct).toBe(false);
    expect(r.method).toBe("none");
  });

  it("rejects a wrong answer", () => {
    expect(matchTextAnswer("吃饭", "归处").correct).toBe(false);
  });
});

describe("matchChoiceAnswer", () => {
  const options = ["白色", "灰色", "红色"];

  it("matches on index", () => {
    expect(matchChoiceAnswer(1, 1, options)).toBe(true);
    expect(matchChoiceAnswer(0, 1, options)).toBe(false);
  });

  it("matches on option text, so persisted data survives reordering", () => {
    expect(matchChoiceAnswer("灰色", 1, options)).toBe(true);
    expect(matchChoiceAnswer("红色", 1, options)).toBe(false);
  });

  it("is forgiving about option text formatting", () => {
    expect(matchChoiceAnswer(" 灰色 ", "灰色", options)).toBe(true);
  });

  it("rejects an out-of-range index", () => {
    expect(matchChoiceAnswer(9, 1, options)).toBe(false);
  });
});

describe("buildAcceptedPool", () => {
  it("unions the answer list with the accepted keywords", () => {
    expect(buildAcceptedPool(["方向", "路"], ["道"]).sort()).toEqual(["方向", "路", "道"].sort());
  });

  it("handles a single-string answer", () => {
    expect(buildAcceptedPool("记忆", ["记"])).toEqual(["记忆", "记"]);
  });
});
