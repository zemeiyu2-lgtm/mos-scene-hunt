import { describe, expect, it } from "vitest";
import { validateGamePackage, summarizeSpatial, gameToMarkdown, markdownToGame, exportGameJson, unwrapGamePackage } from "@/lib/game/package";
import type { Game } from "@/lib/game/types";
const base: Game = {
 id:"test-package", language:"zh-CN", title:"测试游戏", description:"测试", version:"1.0.0",
 startLocation:{lat:14.6885,lng:120.9717}, huntArea:{center:{lat:14.6885,lng:120.9717},radiusMeters:200},
 entrySceneId:"s1",
 scenes:[
  {id:"s1",title:"一",story:"故事",location:{lat:14.6885,lng:120.9717,radius:20},nextSceneId:"s2",challenge:{type:"text",question:"x",answer:["x"]},reward:{type:"keyword",title:"a",value:"a"}},
  {id:"s2",title:"二",story:"故事",location:{lat:14.689,lng:120.9717,radius:20},nextSceneId:null,challenge:{type:"text",question:"x",answer:["x"]},reward:{type:"keyword",title:"b",value:"b"}}
 ]
};
describe("V0.6 game package",()=>{
 it("calculates route summary",()=>expect(summarizeSpatial(base).totalMeters).toBeGreaterThan(40));
 it("accepts a valid package",()=>expect(validateGamePackage(base).canPlaytest).toBe(true));
 it("round-trips the V1 JSON envelope",()=> {
  const exported = exportGameJson(base);
  const raw = JSON.parse(exported);
  expect(raw.format).toBe("mos-scene-hunt-game");
  expect(raw.formatVersion).toBe("1.0");
  expect(unwrapGamePackage(raw)).toEqual(base);
  expect(validateGamePackage(raw).canPlaytest).toBe(true);
 });
 it("warns when a point is outside the circle",()=>{
  const report=validateGamePackage({...base,scenes:[...base.scenes.slice(0,1),{...base.scenes[1],location:{...base.scenes[1].location,lat:14.70}}]});
  expect(report.issues.some(i=>i.message.includes("探索区域之外"))).toBe(true);
 });
  it("round-trips the exported Markdown design package",()=> {
  const imported = markdownToGame(gameToMarkdown(base));
  const report = validateGamePackage(imported);
  expect(report.canPlaytest).toBe(true);
  expect(report.game?.title).toBe(base.title);
  expect(report.game?.scenes).toHaveLength(2);
  expect(report.game?.scenes[0].challenge?.type).toBe("text");
  expect(report.game?.scenes[0].challenge?.answer).toEqual(["x"]);
  expect(report.game?.scenes[1].nextSceneId).toBeNull();
});
});
