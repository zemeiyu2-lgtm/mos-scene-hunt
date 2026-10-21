/**
 * Blank-game factory for the micro designer.
 *
 * Extracted from `app/design/page.tsx` so 「新建空白游戏」 is unit-testable: the
 * id allocation rule and the minimal default content are the two things that
 * must not drift (a colliding id would overwrite another saved game; too little
 * content would produce a pack that fails validation and silently disappears
 * from the local library on reload).
 */

import type { Game, Scene } from "@/lib/game/types";

export const BLANK_GAME_TITLE = "未命名寻宝";
export const BLANK_GAME_DESCRIPTION = "在这里写一句给玩家的介绍。";

/**
 * Allocate an id that is not in `reserved`.
 *
 * Deterministic for a given seed, so tests can pin the output. Collisions
 * (two blanks created inside the same millisecond, or a hostile saved id) fall
 * back to a `-2`, `-3`… suffix rather than overwriting.
 */
export function nextBlankGameId(reserved: Iterable<string>, seed: number = Date.now()): string {
  const taken = new Set(reserved);
  const base = `my-hunt-${Math.abs(Math.trunc(seed)).toString(36)}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export interface BlankGameOptions {
  id: string;
  /**
   * Where the new hunt starts. The designer passes the current map centre so
   * the editor keeps the area they were already looking at instead of jumping
   * to (0,0); the coordinates are still placeholders they must confirm.
   */
  startLocation?: { lat: number; lng: number; name?: string };
  title?: string;
}

/** Minimal playable pack: one scene with a starter challenge and reward. */
export function createBlankGame(options: BlankGameOptions): Game {
  const origin = options.startLocation ?? { lat: 0, lng: 0 };
  const sceneId = `${options.id}-scene-1`;
  const firstScene: Scene = {
    id: sceneId,
    title: "第1站 · 新地点",
    story: "到达这里时，玩家会看到这段文字。换成你希望他看到的内容。",
    briefing: "前往这个地点，到达后解锁任务。",
    // 15 m: the recommended default trigger radius (稳定落在真实 GPS 误差内).
    location: { lat: origin.lat, lng: origin.lng, radius: 15, name: "新地点" },
    nextSceneId: null,
    challenge: {
      type: "choice",
      question: "你在现场观察到了什么？",
      options: ["选项 A", "选项 B", "选项 C"],
      answer: 0,
    },
    reward: { type: "keyword", title: "新线索", value: "线索" },
  };

  return {
    id: options.id,
    language: "zh-CN",
    title: options.title ?? BLANK_GAME_TITLE,
    description: BLANK_GAME_DESCRIPTION,
    version: "0.1.0",
    estimatedMinutes: 15,
    difficulty: "easy",
    startLocation: { lat: origin.lat, lng: origin.lng, radius: 30, name: "起点" },
    entrySceneId: sceneId,
    scenes: [firstScene],
  };
}
