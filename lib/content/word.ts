import type { Challenge, Game, Scene } from "@/lib/game/types";

function clean(s: string): string { return s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim(); }
function between(text: string, start: string, ends: string[]): string {
  const i = text.indexOf(start); if (i < 0) return "";
  const body = text.slice(i + start.length).replace(/^[:：]\s*/, "").trim();
  let end = body.length;
  for (const marker of ends) { const p = body.indexOf("\n" + marker); if (p >= 0) end = Math.min(end, p); }
  return clean(body.slice(0, end));
}
export function parseWordText(text: string): Game {
  const normalized = text.replace(/\r/g, "").replace(/[\u200b\ufeff]/g, "").trim();
  const title = (normalized.match(/《([^》]+)》/)?.[1] || normalized.match(/游戏名称\s*[：:]\s*([^\n]+)/)?.[1] || "未命名游戏").trim();
  const description = between(normalized, "游戏简介", ["游戏时间","预计时间","游戏难度","建议玩家","游戏目标","游戏区域"]) || between(normalized, "游戏目标", ["游戏时间","预计时间","游戏难度","建议玩家","游戏区域"]) || "由 Word 游戏设计稿生成的场景探索游戏。";
  const timeMatch = normalized.match(/(?:预计时间|游戏时间)\s*(?:[：:]\s*)?(?:\\n\s*)?约?\s*(\d+)/);
  const dm = normalized.match(/(?:难度|游戏难度)\s*(?:[：:]\s*)?(?:\\n\s*)?(简单|中等|困难)/);
  const difficulty = dm ? ({简单:"easy",中等:"medium",困难:"hard"} as const)[dm[1] as "简单"|"中等"|"困难"] : "medium";
  const matches = [...normalized.matchAll(/(?:^|\n)\s*第(\d+)站：([^\n]+)/g)];
  if (!matches.length) throw new Error("没有找到“第1站：标题”。请使用 MOS Scene Hunt Word 模板。");
  const scenes: Scene[] = matches.map((m,i) => {
    const start = m.index ?? 0; const end = matches[i+1]?.index ?? normalized.length; const block = normalized.slice(start,end);
    const location = between(block,"地点",["故事 / 引导","玩家思考的问题","玩家可以选择","完成任务"]);
    const story = between(block,"故事 / 引导",["地点","玩家思考的问题","玩家可以选择","完成任务"]);
    const question = between(block,"玩家思考的问题",["地点","故事 / 引导","玩家可以选择","完成任务"]);
    const choiceText = between(block,"玩家可以选择",["地点","故事 / 引导","玩家思考的问题","完成任务"]);
    const choices = choiceText.split("\n").map(clean).filter(Boolean).map(x=>x.replace(/^□\s*/,""));
    const task = between(block,"完成任务",["地点","故事 / 引导","玩家思考的问题","玩家可以选择"]);
    if (!location || !story || !question || choices.length < 2 || !task) throw new Error("第"+(i+1)+"站内容不完整：请检查地点、故事 / 引导、问题、至少两个选项和完成任务。");
    const id = "word-scene-"+String(i+1).padStart(2,"0");
    const challenge: Challenge = { type:"choice", question, options:choices, reflective:true, prompt:story, explanation:task };
    return { id, title:clean(m[2]), story, briefing:task, location:{lat:14.687912,lng:121.032952,radius:20,name:location}, nextSceneId:null, challenge };
  });
  scenes.forEach((s,i)=>{s.nextSceneId=scenes[i+1]?.id??null;});
  return { id:"word-"+Date.now().toString(36), language:"zh-CN", title, description, author:"Word 游戏设计稿", version:"1.0", estimatedMinutes:timeMatch?Number(timeMatch[1]):undefined, difficulty, startLocation:{lat:14.687912,lng:121.032952,radius:30,name:"游戏起点（待现场确认）"}, huntArea:{center:{lat:14.687912,lng:121.032952},radiusMeters:180,shape:"circle",name:"游戏区域（待现场确认）"}, entrySceneId:scenes[0].id, scenes };
}
export function wordTemplateHelp(): string { return "使用《MOS Scene Hunt 普通人游戏设计模板》：游戏名称、游戏简介/目标、预计时间、难度，以及连续的“第1站：标题”与每站的地点、故事 / 引导、玩家思考的问题、玩家可以选择、完成任务。"; }
