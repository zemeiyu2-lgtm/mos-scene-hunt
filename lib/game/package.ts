import { validateGame, type Game, type ValidationIssue, type Challenge, type ChallengeType, type Reward, type Scene } from "./types";
import { calculateDistance, isPointInPolygon } from "@/lib/location";

export interface SpatialSummary {
  distances: Array<{ from: string; to: string; meters: number }>;
  totalMeters: number;
  walkingMinutes: number;
}
export interface PackageReport { game: Game | null; issues: ValidationIssue[]; spatial: SpatialSummary; canPlaytest: boolean; }

export function validateGamePackage(raw: unknown): PackageReport {
  try {
    const { game, issues } = validateGame(raw);
    const all = [...issues, ...validateSpatial(game)];
    return { game, issues: all, spatial: summarizeSpatial(game), canPlaytest: !all.some((i) => i.severity === "error") };
  } catch (error) {
    return { game: null, issues: [{ path: "$", message: error instanceof Error ? error.message : "游戏包无法解析", severity: "error" }], spatial: { distances: [], totalMeters: 0, walkingMinutes: 0 }, canPlaytest: false };
  }
}
export function validateSpatial(game: Game): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!game.huntArea) issues.push({ path: "huntArea", message: "尚未设置探索区域", severity: "warning" });
  else if (game.huntArea.radiusMeters <= 0) issues.push({ path: "huntArea.radiusMeters", message: "探索区域半径必须大于 0", severity: "error" });
  for (const scene of game.scenes) {
    const radius = scene.location.radius ?? 15;
    if (!Number.isFinite(scene.location.lat) || !Number.isFinite(scene.location.lng)) issues.push({ path: `scenes.${scene.id}.location`, message: "缺少有效 GPS 坐标", severity: "error" });
    if (radius < 5 || radius > 200) issues.push({ path: `scenes.${scene.id}.location.radius`, message: `触发半径 ${radius}m 不在建议范围 5–200m 内`, severity: "warning" });
    if (game.huntArea) {
      if (game.huntArea.shape === "polygon" && (game.huntArea.points?.length ?? 0) >= 3) {
        if (!isPointInPolygon({ lat: scene.location.lat, lng: scene.location.lng }, game.huntArea.points!)) {
          issues.push({ path: `scenes.${scene.id}.location`, message: "点位位于自定义探索区域之外", severity: "warning" });
        }
      } else {
        const d = calculateDistance(scene.location, game.huntArea.center);
        if (d > game.huntArea.radiusMeters) issues.push({ path: `scenes.${scene.id}.location`, message: "点位位于探索区域之外", severity: "warning" });
      }
    }
  }
  for (let i = 0; i < game.scenes.length; i++) for (let j = i + 1; j < game.scenes.length; j++) {
    const a = game.scenes[i], b = game.scenes[j], d = calculateDistance(a.location, b.location);
    if (d < Math.max(10, ((a.location.radius ?? 15) + (b.location.radius ?? 15)) * 0.75))
      issues.push({ path: `scenes.${b.id}`, message: `与“${a.title}”距离过近，触发圈可能重叠（约 ${Math.round(d)}m）`, severity: "warning" });
  }
  if (game.scenes.length === 0) issues.push({ path: "scenes", message: "至少需要一个体验点", severity: "error" });
  else if (!game.entrySceneId || !game.scenes.some((s) => s.id === game.entrySceneId)) issues.push({ path: "entrySceneId", message: "起始场景不存在", severity: "error" });
  if (game.scenes.length > 1 && !game.scenes.some((s) => s.nextSceneId === null)) issues.push({ path: "scenes", message: "没有终点场景", severity: "error" });
  if (game.scenes.length > 1) {
    const total = summarizeSpatial(game).totalMeters;
    if (total < 30) issues.push({ path: "spatial.route", message: "路线总长度小于 30m，多个体验点可能过于集中", severity: "warning" });
    if (total > 5000) issues.push({ path: "spatial.route", message: "路线总长度超过 5km，移动端体验可能过长", severity: "warning" });
  }
  return issues;
}
export function summarizeSpatial(game: Game): SpatialSummary {
  const distances: SpatialSummary["distances"] = []; let totalMeters = 0;
  for (let i = 1; i < game.scenes.length; i++) { const from = game.scenes[i-1], to = game.scenes[i]; const meters = calculateDistance(from.location, to.location); distances.push({from:from.id,to:to.id,meters}); totalMeters += meters; }
  return { distances, totalMeters, walkingMinutes: Math.max(1, Math.round(totalMeters / 75)) };
}
export function exportGameJson(game: Game): string { return JSON.stringify(game, null, 2); }
export function gameToMarkdown(game: Game): string {
  const spatial = summarizeSpatial(game);
  const area = game.huntArea;
  const lines = [
    `# ${game.title}`, "",
    "## 游戏信息",
    `- ID：${game.id}`, `- 语言：${game.language ?? "zh-CN"}`, `- 版本：${game.version}`,
    `- 作者：${game.author ?? ""}`, `- 预计时间：${game.estimatedMinutes ?? ""} 分钟`,
    `- 难度：${game.difficulty ?? ""}`, `- 目的：${game.description}`,
    "", "## 空间设计",
    `- 探索区域：${area?.name ?? "未设置"}`, `- 区域形状：${area?.shape ?? "circle"}`,
    `- 区域中心：${area ? `${area.center.lat}, ${area.center.lng}` : ""}`,
    `- 区域半径：${area?.radiusMeters ?? ""} m`,
    `- 区域顶点：${area?.points?.map((p) => `${p.lat}, ${p.lng}`).join(" | ") ?? ""}`,
    `- 总路线：${Math.round(spatial.totalMeters)} m`, `- 粗略步行：${spatial.walkingMinutes} 分钟`,
    "", "## 体验点"
  ];
  game.scenes.forEach((scene, i) => {
    const challenge = scene.challenge;
    const reward = scene.reward;
    lines.push(
      `### ${i + 1}. ${scene.title}`,
      `- ID：${scene.id}`, `- 地点：${scene.location.name ?? ""}`,
      `- GPS：${scene.location.lat}, ${scene.location.lng}`,
      `- 触发半径：${scene.location.radius ?? 15} m`,
      `- 故事：${scene.story}`, `- 到达提示：${scene.briefing ?? ""}`,
      `- 任务类型：${challenge?.type ?? "text"}`, `- 任务：${challenge?.question ?? ""}`,
      `- 任务选项：${challenge?.options?.join(" | ") ?? ""}`,
      `- 答案：${Array.isArray(challenge?.answer) ? challenge.answer.join(" | ") : challenge?.answer ?? ""}`,
      `- 答案说明：${challenge?.explanation ?? ""}`,
      `- 奖励类型：${reward?.type ?? "keyword"}`, `- 奖励名称：${reward?.title ?? ""}`,
      `- 奖励内容：${reward?.value ?? ""}`, ""
    );
  });
  return lines.join("\n");
}

export function markdownToGame(markdown: string): unknown {
  const source = markdown.replace(/\r/g, "").trim();
  if (!source) throw new Error("Markdown 文件为空");
  const lines = source.split("\n");
  const titleMatch = lines.find((line) => /^# /.test(line.trim()))?.trim().match(/^# (.+)$/);
  const title = titleMatch?.[1]?.trim();
  if (!title) throw new Error("缺少游戏标题：第一行应为 # 游戏名称");

  const info = readSectionFields(lines, "## 游戏信息");
  const spatial = readSectionFields(lines, "## 空间设计");
  const sceneBlocks = readSceneBlocks(lines);
  if (!sceneBlocks.length) throw new Error("没有找到体验点：需要至少一个 ### 体验点标题");

  const parseNumber = (value?: string): number | undefined => {
    if (!value?.trim()) return undefined;
    const n = Number(value.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  const parseLatLng = (value?: string): { lat: number; lng: number } | null => {
    if (!value) return null;
    const parts = value.split(",").map((v) => Number(v.trim()));
    return parts.length === 2 && parts.every(Number.isFinite) ? { lat: parts[0], lng: parts[1] } : null;
  };

  const scenes: Scene[] = sceneBlocks.map((block, index) => {
    const fields = block.fields;
    const coords = parseLatLng(fields["GPS"]);
    if (!coords) throw new Error(`第${index + 1}个体验点缺少有效 GPS：${fields["GPS"] ?? ""}`);
    const type = fields["任务类型"];
    const challengeType: ChallengeType = type === "choice" || type === "keyword" || type === "text" ? type : "text";
    const question = fields["任务"] ?? "";
    const options = fields["任务选项"] ? fields["任务选项"].split("|").map((v) => v.trim()).filter(Boolean) : undefined;
    const answerText = fields["答案"]?.trim();
    let answer: number | string | string[] = ["完成"];
    if (challengeType === "choice" && options?.length) {
      const indexOfAnswer = options.findIndex((v) => v === answerText);
      answer = indexOfAnswer >= 0 ? indexOfAnswer : 0;
    } else if (answerText) {
      answer = answerText.split("|").map((v) => v.trim()).filter(Boolean);
    }
    const challenge: Challenge = {
      type: challengeType,
      question: question || "完成现场任务",
      ...(options?.length ? { options } : {}),
      answer,
      ...(fields["答案说明"] ? { explanation: fields["答案说明"] } : {}),
    };
    const rewardTitle = fields["奖励名称"] || "线索";
    const reward: Reward = {
      type: fields["奖励类型"] === "item" || fields["奖励类型"] === "badge" || fields["奖励类型"] === "story" ? fields["奖励类型"] : "keyword",
      title: rewardTitle,
      value: fields["奖励内容"] || rewardTitle,
    };
    return {
      id: fields["ID"] || `scene-${String(index + 1).padStart(2, "0")}`,
      title: block.title,
      story: fields["故事"] || "",
      ...(fields["到达提示"] ? { briefing: fields["到达提示"] } : {}),
      location: { ...coords, radius: parseNumber(fields["触发半径"]) ?? 15, ...(fields["地点"] ? { name: fields["地点"] } : {}) },
      nextSceneId: null,
      challenge,
      reward,
    };
  });
  scenes.forEach((scene, index) => { scene.nextSceneId = scenes[index + 1]?.id ?? null; });

  const center = parseLatLng(spatial["区域中心"]) ?? { lat: scenes[0].location.lat, lng: scenes[0].location.lng };
  const radius = parseNumber(spatial["区域半径"]) ?? 100;
  const shape = spatial["区域形状"] === "polygon" ? "polygon" : "circle";
  const points = shape === "polygon" && spatial["区域顶点"]
    ? spatial["区域顶点"].split("|").map(parseLatLng).filter((p): p is {lat:number;lng:number} => Boolean(p))
    : undefined;

  return {
    id: info["ID"] || slugify(title),
    language: info["语言"] || "zh-CN",
    title,
    description: info["目的"] || title,
    ...(info["作者"] ? { author: info["作者"] } : {}),
    version: info["版本"] || "0.6.0",
    estimatedMinutes: parseNumber(info["预计时间"]),
    ...(info["难度"] === "easy" || info["难度"] === "medium" || info["难度"] === "hard" ? { difficulty: info["难度"] } : {}),
    startLocation: { lat: center.lat, lng: center.lng, name: spatial["探索区域"] || title },
    huntArea: { center, radiusMeters: radius, shape, ...(points && points.length >= 3 ? { points } : {}), name: spatial["探索区域"] || "游戏区域" },
    entrySceneId: scenes[0].id,
    scenes,
  } satisfies Game;
}

function readSectionFields(lines: string[], heading: string): Record<string, string> {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return {};
  const out: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("## ") || line.startsWith("### ")) break;
    const match = line.match(/^- ([^：]+)：(.*)$/);
    if (match) out[match[1].trim()] = match[2].trim();
  }
  return out;
}

function readSceneBlocks(lines: string[]): Array<{ title: string; fields: Record<string, string> }> {
  const indexes = lines.map((line, i) => /^### \d+\. /.test(line.trim()) ? i : -1).filter((i) => i >= 0);
  return indexes.map((start, n) => {
    const end = indexes[n + 1] ?? lines.length;
    const title = lines[start].trim().replace(/^### \d+\. /, "");
    const fields: Record<string, string> = {};
    for (let i = start + 1; i < end; i++) {
      const match = lines[i].trim().match(/^- ([^：]+)：(.*)$/);
      if (match) fields[match[1].trim()] = match[2].trim();
    }
    return { title, fields };
  });
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || `hunt-${Date.now().toString(36)}`;
}
