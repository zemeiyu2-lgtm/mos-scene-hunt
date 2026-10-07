import { describe, expect, it } from "vitest";
import { validateGamePackage, summarizeSpatial, gameToMarkdown, markdownToGame } from "@/lib/game/package";
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
 it("warns when a point is outside the circle",()=>{
  const report=validateGamePackage({...base,scenes:[...base.scenes.slice(0,1),{...base.scenes[1],location:{...base.scenes[1].location,lat:14.70}}]});
  expect(report.issues.some(i=>i.message.includes("探索区域之外"))).toBe(true);
 });
});
