import { validateGame, type Game, type ValidationIssue } from "./types";
import { calculateDistance } from "@/lib/location";

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
    if (game.huntArea && game.huntArea.shape !== "polygon") {
      const d = calculateDistance(scene.location, game.huntArea.center);
      if (d > game.huntArea.radiusMeters) issues.push({ path: `scenes.${scene.id}.location`, message: "点位位于探索区域之外", severity: "warning" });
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
  const lines = [`# ${game.title}`, "", "## 游戏信息", `- ID：${game.id}`, `- 版本：${game.version}`, `- 预计时间：${game.estimatedMinutes ?? ""} 分钟`, `- 难度：${game.difficulty ?? ""}`, `- 目的：${game.description}`, "", "## 空间设计", `- 探索区域：${game.huntArea?.name ?? "未设置"}`, `- 区域半径：${game.huntArea?.radiusMeters ?? ""} m`, `- 总路线：${Math.round(spatial.totalMeters)} m`, `- 粗略步行：${spatial.walkingMinutes} 分钟`, "", "## 体验点"];
  game.scenes.forEach((scene,i)=>lines.push(`### ${i+1}. ${scene.title}`,`- 地点：${scene.location.name ?? ""}`,`- GPS：${scene.location.lat}, ${scene.location.lng}`,`- 触发半径：${scene.location.radius ?? 15} m`,`- 故事：${scene.story}`,`- 到达提示：${scene.briefing ?? ""}`,`- 任务：${scene.challenge?.question ?? ""}`,`- 奖励：${scene.reward?.title ?? ""} / ${scene.reward?.value ?? ""}`,""));
  return lines.join("\n");
}
