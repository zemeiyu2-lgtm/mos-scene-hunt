import type { Game, Scene, Challenge } from "@/lib/game/types";

const DEFAULT_LAT = 14.687912;
const DEFAULT_LNG = 121.032952;

export interface AIImportResult {
  game: Game;
  warnings: string[];
}

function clean(value: string): string {
  return value.replace(/^\s+|\s+$/g, "").replace(/^[-•*]\s*/, "").replace(/^\d+[.)、]\s*/, "");
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || `hunt-${Date.now().toString(36)}`;
}

function field(lines: string[], labels: string[]): string | undefined {
  const wanted = labels.map((x) => x.replace(/[：:]$/, ""));
  for (const line of lines) {
    const m = line.trim().match(/^([^：:]{1,30})[：:]\s*(.+)$/);
    if (m && wanted.includes(m[1].trim())) return clean(m[2]);
  }
  return undefined;
}

function blocks(source: string): Array<{ title: string; lines: string[] }> {
  const lines = source.replace(/\r/g, "").split("\n");
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (/^(?:#{1,4}\s*)?(?:第\s*\d+\s*[站个]?|场景\s*\d+|地点\s*\d+)/i.test(line.trim())) starts.push(i);
  });
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? lines.length;
    const rawTitle = lines[start].trim()
      .replace(/^#{1,4}\s*/, "")
      .replace(/^第\s*\d+\s*[站个]?\s*[：:.-]?\s*/i, "")
      .replace(/^场景\s*\d+\s*[：:.-]?\s*/i, "")
      .replace(/^地点\s*\d+\s*[：:.-]?\s*/i, "");
    return { title: clean(rawTitle) || `体验点 ${i + 1}`, lines: lines.slice(start + 1, end) };
  });
}

function choices(lines: string[]): string[] {
  const out: string[] = [];
  let inChoices = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^(玩家可以选择|选择|选项|答案选项)[：:]?$/i.test(t)) { inChoices = true; continue; }
    if (inChoices && /^(完成任务|任务|玩家思考|问题|故事|地点|下一步|奖励)[：:]/i.test(t)) { inChoices = false; continue; }
    if (inChoices) {
      const v = clean(t.replace(/^[A-FＡ-Ｆ][.)、：:]\s*/i, ""));
      if (v && v.length > 1) out.push(v);
    }
    const m = t.match(/^[A-FＡ-Ｆ][.)、：:]\s*(.+)$/i);
    if (m) out.push(clean(m[1]));
  }
  return [...new Set(out)].slice(0, 6);
}

export function parseAIText(source: string): AIImportResult {
  const text = source.replace(/\r/g, "").trim();
  if (!text) throw new Error("请先粘贴 AI 生成的游戏内容。");

  const allLines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const titleLine = allLines.find((x) => /^(游戏名称|游戏名|标题)[：:]/.test(x));
  const heading = allLines.find((x) => /^#\s+/.test(x));
  const title = titleLine ? titleLine.split(/[：:]/).slice(1).join(":").trim() : heading?.replace(/^#\s+/, "").trim();
  if (!title) throw new Error("没有找到游戏名称。请让 AI 输出“游戏名称：……”或“# 游戏名称”。");

  const sceneBlocks = blocks(text);
  if (!sceneBlocks.length) throw new Error("没有找到游戏场景。请至少提供“第1站：……”并继续列出地点、故事、问题和任务。");

  const warnings: string[] = [];
  const estimated = Number((field(allLines, ["预计时间", "游戏时间"]) ?? "").replace(/[^0-9]/g, ""));
  const difficultyRaw = field(allLines, ["难度", "游戏难度"])?.toLowerCase();
  const difficulty = difficultyRaw?.includes("难") ? "hard" : difficultyRaw?.includes("中") ? "medium" : "easy";

  const scenes: Scene[] = sceneBlocks.map((block, index) => {
    const locationName = field(block.lines, ["地点", "位置", "场地"]) ?? block.title;
    const story = field(block.lines, ["故事", "引导", "场景故事"]) ?? "";
    const question = field(block.lines, ["玩家思考的问题", "思考问题", "问题", "任务"]) ?? "完成现场任务";
    const task = field(block.lines, ["完成任务", "现场任务", "任务"]) ?? "在现场完成一次观察、行动或反思。";
    const options = choices(block.lines);
    const challenge: Challenge = options.length >= 2
      ? { type: "choice", question, options, reflective: true }
      : { type: "text", question: `${question}\n\n任务：${task}`, answer: ["完成", "完成任务"], explanation: "完成现场任务即可继续。" };

    const lat = DEFAULT_LAT;
    const lng = DEFAULT_LNG;
    warnings.push(`第${index + 1}站“${block.title}”尚未设置真实 GPS，已暂用示范坐标；试玩前请在地图上拖动到真实地点。`);
    return {
      id: `ai-scene-${String(index + 1).padStart(2, "0")}`,
      title: block.title,
      story: story || task,
      briefing: locationName,
      location: { lat, lng, radius: 20, name: locationName },
      nextSceneId: null,
      challenge,
    };
  });

  scenes.forEach((scene, i) => { scene.nextSceneId = scenes[i + 1]?.id ?? null; });
  return {
    game: {
      id: slugify(title),
      language: "zh-CN",
      title,
      description: field(allLines, ["游戏简介", "游戏目标", "简介", "目的"]) ?? title,
      author: field(allLines, ["作者", "设计者"]) ?? "AI 创作",
      version: "1.0.0",
      ...(Number.isFinite(estimated) && estimated > 0 ? { estimatedMinutes: estimated } : {}),
      difficulty,
      startLocation: { lat: DEFAULT_LAT, lng: DEFAULT_LNG, name: title, radius: 30 },
      huntArea: { center: { lat: DEFAULT_LAT, lng: DEFAULT_LNG }, radiusMeters: 200, shape: "circle", name: "待设置游戏区域" },
      entrySceneId: scenes[0].id,
      scenes,
      aiProfile: { tone: "由 AI 协助生成的手机寻宝游戏", allowGeneration: true },
    },
    warnings,
  };
}
