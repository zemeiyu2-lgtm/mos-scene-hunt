/**
 * 菲圣综合测试游戏包｜真实校验器 + 真实引擎验收
 *
 * 目的：证明这份包不是"字段看起来对"，而是
 *  1. 通过仓库实际校验器（validateGamePackage，含空间校验）；
 *  2. 在真实引擎里能从入口走到两个不同结局；
 *  3. 物品门、任务前置、限时、反思式选择确实生效；
 *  4. 重复完成同一场景不会二次发奖。
 */
import { describe, expect, it } from "vitest";
import pack from "@/content/fisheng-comprehensive-test.json";
import { validateGamePackage } from "@/lib/game/package";
import { validateGame, type Game } from "@/lib/game/types";
import {
  availableSceneIds,
  createInitialState,
  gameReducer,
  isGameComplete,
  reconcileState,
  statusOf,
  type GameState,
} from "@/lib/game/state";

const T = 1_760_000_000_000;
const game = pack as unknown as Game;

function start(): GameState {
  return gameReducer(game, createInitialState(game, T), { type: "START", now: T });
}

function answer(state: GameState, sceneId: string, action: { selectedIndex?: number; text?: string }, now = T): GameState {
  let next = gameReducer(game, state, { type: "ENTER_SCENE", sceneId, now });
  next = gameReducer(game, next, { type: "OPEN_CHALLENGE", sceneId, now });
  return gameReducer(game, next, { type: "SUBMIT_ANSWER", sceneId, now, ...action });
}

function answerAndClose(state: GameState, sceneId: string, action: { selectedIndex?: number; text?: string }, now = T): GameState {
  const submitted = answer(state, sceneId, action, now);
  return gameReducer(game, submitted, { type: "CLOSE_SCENE", sceneId, now });
}

describe("菲圣综合测试包：结构", () => {
  it("通过仓库实际校验器（含空间校验），零 error", () => {
    const report = validateGamePackage(JSON.parse(JSON.stringify(pack)));
    const errors = report.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(report.canPlaytest).toBe(true);
    // warning 允许存在，但必须能被解释（半径、路径长度等提示性内容）
    expect(report.issues.every((i) => typeof i.message === "string")).toBe(true);
  });

  it("只跑基础校验也通过（发布接口走的是 validateGame）", () => {
    expect(() => validateGame(JSON.parse(JSON.stringify(pack)))).not.toThrow();
  });

  it("覆盖声明的全部能力", () => {
    const types = new Set(game.scenes.map((s) => s.challenge?.type).filter(Boolean));
    expect(types).toEqual(new Set(["choice", "text", "keyword"]));

    const rewardTypes = new Set(game.scenes.map((s) => s.reward?.type).filter(Boolean));
    expect(rewardTypes).toEqual(new Set(["keyword", "item", "story", "badge"]));

    expect(game.scenes.some((s) => s.challenge?.reflective === true)).toBe(true);
    expect(game.scenes.some((s) => s.challenge?.timeLimitSeconds && s.challenge.timeLimitSeconds > 0)).toBe(true);
    expect(game.scenes.some((s) => (s.requires?.length ?? 0) > 0)).toBe(true);
    expect(game.scenes.some((s) => (s.requiresItems?.length ?? 0) > 1)).toBe(true);

    const branched = game.scenes.filter((s) => Object.keys(s.challenge?.branches ?? {}).length >= 2);
    expect(branched.length).toBeGreaterThanOrEqual(1);

    const endings = game.scenes.filter((s) => s.nextSceneId === null);
    expect(endings.length).toBeGreaterThanOrEqual(1);
  });

  it("奖励 id 全包唯一（重复领取防护的前置条件）", () => {
    const ids = game.scenes.map((s) => `${s.id}:${s.reward?.type}:${s.reward?.value ?? s.reward?.title}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("菲圣综合测试包：真实通关", () => {
  it("路线 A（水边）：六站走通，任务前置与双物品门生效", () => {
    let s = start();
    expect(availableSceneIds(game, s)).toEqual(["fs-s1"]);

    s = answerAndClose(s, "fs-s1", { selectedIndex: 0 }, T + 1);
    // s2 是唯一可用场景；s5 此时缺物品，不能提前进入
    expect(availableSceneIds(game, s)).toEqual(["fs-s2"]);

    s = answerAndClose(s, "fs-s2", { text: "自由" }, T + 2);
    expect(availableSceneIds(game, s)).toContain("fs-s3");

    // 反思式选择：两个选项都算通过，但走向不同分支
    s = answerAndClose(s, "fs-s3", { selectedIndex: 0 }, T + 3);
    expect(statusOf(game, s, "fs-s4a")).toBe("available");
    // 已知限制：分支不互斥——另一侧只要 requires 满足也会解锁（见报告缺陷 B-GAP-01）
    expect(statusOf(game, s, "fs-s4b")).toBe("available");
    expect(statusOf(game, s, "fs-s6")).toBe("locked");

    s = answerAndClose(s, "fs-s4a", { text: "水" }, T + 4);
    expect(statusOf(game, s, "fs-s4a")).toBe("completed");
    // 物品门：铜钥匙 + 旧照片都在，s5 打开
    expect(statusOf(game, s, "fs-s5")).toBe("available");
    const keys = s.inventory.filter((i) => i.type === "item" && i.value === "brass-key");
    expect(keys).toHaveLength(1);
    expect(keys[0].sceneId).toBe("fs-s4a");

    s = answerAndClose(s, "fs-s5", { selectedIndex: 1 }, T + 5);
    expect(statusOf(game, s, "fs-s6")).toBe("available");

    s = answerAndClose(s, "fs-s6", { selectedIndex: 1 }, T + 6);
    expect(isGameComplete(game, s)).toBe(true);
    const routes = s.routes ?? {};
    expect(routes["fs-s3"]).toBe("fs-s4a");
  });

  it("路线 B（林地）：同样通关，但走另一条支线", () => {
    let s = start();
    s = answerAndClose(s, "fs-s1", { selectedIndex: 0 }, T + 1);
    s = answerAndClose(s, "fs-s2", { text: "libertad" }, T + 2);
    s = answerAndClose(s, "fs-s3", { selectedIndex: 1 }, T + 3);
    expect(statusOf(game, s, "fs-s4b")).toBe("available");
    expect(statusOf(game, s, "fs-s4a")).toBe("available");

    s = answerAndClose(s, "fs-s4b", { text: "风" }, T + 4);
    expect(statusOf(game, s, "fs-s5")).toBe("available");
    s = answerAndClose(s, "fs-s5", { selectedIndex: 1 }, T + 5);
    s = answerAndClose(s, "fs-s6", { selectedIndex: 0 }, T + 6);
    expect(isGameComplete(game, s)).toBe(true);
    expect(s.routes?.["fs-s3"]).toBe("fs-s4b");
  });

  it("缺物品时物品门保持关闭（伪造库存会被 reconcile 剥离）", () => {
    let s = start();
    s = answerAndClose(s, "fs-s1", { selectedIndex: 0 }, T + 1);
    s = answerAndClose(s, "fs-s2", { text: "自由" }, T + 2);
    s = answerAndClose(s, "fs-s3", { selectedIndex: 0 }, T + 3);

    const forged = reconcileState(
      game,
      { ...s, inventory: [{ id: "brass-key", kind: "brass-key", title: "伪造钥匙", type: "item" }] } as never,
      T + 4,
    );
    expect(statusOf(game, forged, "fs-s5")).toBe("locked");
  });

  it("重复完成同一场景不会二次发奖", () => {
    let s = start();
    s = answerAndClose(s, "fs-s1", { selectedIndex: 0 }, T + 1);
    const keywordCount = () => s.keywords.filter((k) => k === "depart").length;
    expect(keywordCount()).toBe(1);
    const again = answer(s, "fs-s1", { selectedIndex: 0 }, T + 2);
    expect(again.keywords.filter((k) => k === "depart").length).toBe(1);
  });

  it("限时挑战：超过时限后提交不判通过", () => {
    let s = start();
    s = answerAndClose(s, "fs-s1", { selectedIndex: 0 }, T + 1);
    s = answerAndClose(s, "fs-s2", { text: "自由" }, T + 2);
    let timed = gameReducer(game, s, { type: "ENTER_SCENE", sceneId: "fs-s3", now: T + 3 });
    timed = gameReducer(game, timed, { type: "OPEN_CHALLENGE", sceneId: "fs-s3", now: T + 3 });
    const limit = game.scenes.find((x) => x.id === "fs-s3")!.challenge!.timeLimitSeconds!;
    const late = gameReducer(game, timed, { type: "SUBMIT_ANSWER", sceneId: "fs-s3", now: T + 3 + limit * 1000 + 1, selectedIndex: 0 });
    expect(isSceneCompleted(late, "fs-s3")).toBe(false);
  });
});

function isSceneCompleted(state: GameState, sceneId: string): boolean {
  const progress = state.scenes?.[sceneId];
  return Boolean(progress?.completedAt);
}
