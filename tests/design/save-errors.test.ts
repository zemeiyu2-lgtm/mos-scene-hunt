import { describe, expect, it } from "vitest";
import { describeIssue, describeSaveErrors } from "@/lib/game/save-errors";
import type { ValidationIssue } from "@/lib/game/types";

const issue = (path: string, message: string): ValidationIssue => ({
  path,
  message,
  severity: "error",
});

describe("保存错误文案", () => {
  it("把 JSON 路径翻译成设计者看得懂的位置", () => {
    expect(describeIssue(issue("$.title", "必须是非空字符串")).label).toBe("游戏名称");
    expect(describeIssue(issue("$.scenes[2].challenge.answer", "选项下标越界：9")).label).toBe(
      "第 3 个体验点的正确答案",
    );
    expect(describeIssue(issue("$.scenes[0].location", "缺少 location")).label).toBe(
      "第 1 个体验点的地点坐标",
    );
    expect(describeIssue(issue("$.scenes[0].id", "场景 id 重复：a")).label).toBe(
      "第 1 个体验点的ID",
    );
    expect(describeIssue(issue("$.scenes", "至少需要一个场景")).label).toBe("体验点列表");
    expect(describeIssue(issue("$.huntArea.radiusMeters", "必须是正数")).label).toBe("探索区域");
  });

  it("摘要直接点名第一个问题，而不是只说保存失败", () => {
    const text = describeSaveErrors([issue("$.title", "必须是非空字符串")]);
    expect(text.summary).toContain("游戏名称");
    expect(text.summary).toContain("必须是非空字符串");
    expect(text.summary).not.toBe("保存失败");
  });

  it("多处问题时给出总数，但只列前三项", () => {
    const text = describeSaveErrors([
      issue("$.title", "必须是非空字符串"),
      issue("$.scenes[0].title", "必须是非空字符串"),
      issue("$.scenes[0].story", "必须是非空字符串"),
      issue("$.scenes[0].challenge.answer", "选项下标越界：9"),
    ]);
    expect(text.summary).toContain("共 4 处需要修正");
    expect(text.problems).toHaveLength(3);
    expect(text.hidden).toBe(1);
  });

  it("空错误列表也有可读的默认文案", () => {
    const text = describeSaveErrors([]);
    expect(text.summary).toContain("保存失败");
    expect(text.problems).toHaveLength(0);
  });
});
