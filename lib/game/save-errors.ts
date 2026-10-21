/**
 * Turn validator issues into something a designer can act on.
 *
 * The validator speaks in JSON paths (`$.scenes[2].challenge.answer`). A
 * designer editing on a phone needs "第 3 个体验点的正确答案" instead. This
 * module is deliberately pure so the wording can be pinned by tests without
 * mounting the whole editor page.
 */

import type { ValidationIssue } from "./types";

export interface SaveProblem {
  /** What the designer sees as the subject, e.g. "第 2 个体验点的正确答案". */
  label: string;
  /** The validator's own explanation, already player-facing Chinese. */
  message: string;
  /** Original JSON path, kept for debugging and tests. */
  path: string;
}

const ROOT_LABELS: Array<[RegExp, string]> = [
  [/^\$\.id$/, "存档 ID"],
  [/^\$\.language$/, "语言"],
  [/^\$\.title$/, "游戏名称"],
  [/^\$\.description$/, "游戏简介"],
  [/^\$\.version$/, "版本号"],
  [/^\$\.entrySceneId$/, "起始站点"],
  [/^\$\.startLocation/, "起点坐标"],
  [/^\$\.huntArea/, "探索区域"],
  [/^\$\.scenes$/, "体验点列表"],
];

const SCENE_FIELD_LABELS: Array<[string, string]> = [
  ["location", "地点坐标"],
  ["title", "名称"],
  ["story", "故事"],
  ["briefing", "到达提示"],
  ["nextSceneId", "下一站"],
  ["id", "ID"],
  ["challenge.options", "选项"],
  ["challenge.answer", "正确答案"],
  ["challenge.question", "问题"],
  ["challenge.type", "题型"],
  ["challenge.acceptedKeywords", "提示词"],
  ["challenge.media", "素材"],
  ["challenge", "任务"],
  ["reward.type", "奖励类型"],
  ["reward.title", "奖励名称"],
  ["reward", "奖励"],
  ["media", "素材"],
];

function sceneLabel(index: number, field: string): string {
  // `$.scenes` itself carries the "at least one scene" message.
  if (!Number.isInteger(index) || index < 0) return "体验点列表";
  const prefix = `第 ${index + 1} 个体验点`;
  const matched = SCENE_FIELD_LABELS.find(([key]) => field === key || field.startsWith(`${key}.`));
  if (!matched) return prefix;
  // A missing `id` / `title` on a scene is best described by its own words.
  return `${prefix}的${matched[1]}`;
}

/** Describe a single validator issue in designer vocabulary. */
export function describeIssue(issue: ValidationIssue): SaveProblem {
  const path = issue.path ?? "$";
  if (path === "$") {
    return { label: "游戏数据", message: issue.message, path };
  }

  const sceneMatch = path.match(/^\$\.scenes\[(\d+)\](?:\.(.+))?$/);
  if (sceneMatch) {
    return {
      label: sceneLabel(Number(sceneMatch[1]), sceneMatch[2] ?? ""),
      message: issue.message,
      path,
    };
  }

  const root = ROOT_LABELS.find(([pattern]) => pattern.test(path));
  if (root) return { label: root[1], message: issue.message, path };

  return { label: "游戏数据", message: issue.message, path };
}

export interface SaveFailureText {
  /** One-line headline for the editor banner. */
  summary: string;
  /** Up to `limit` concrete problems, in validator order. */
  problems: SaveProblem[];
  /** How many problems were not listed, so the banner can say "还有 N 项". */
  hidden: number;
}

/**
 * Build the banner text for a failed save.
 *
 * The summary names the first problem outright: a designer who only reads the
 * headline still learns what to fix, instead of being told "保存失败".
 */
export function describeSaveErrors(
  errors: ValidationIssue[],
  limit = 3,
): SaveFailureText {
  const problems = errors.map(describeIssue);
  if (problems.length === 0) {
    return { summary: "保存失败：游戏数据未通过校验，请检查后重试。", problems, hidden: 0 };
  }
  const first = problems[0];
  const head =
    problems.length === 1
      ? `未保存：${first.label}${first.message.includes(first.label) ? "" : ` —— ${first.message}`}`
      : `未保存：${first.label}${first.message.includes(first.label) ? "" : ` —— ${first.message}`}（共 ${problems.length} 处需要修正）`;
  return {
    summary: head,
    problems: problems.slice(0, Math.max(1, limit)),
    hidden: Math.max(0, problems.length - Math.max(1, limit)),
  };
}
