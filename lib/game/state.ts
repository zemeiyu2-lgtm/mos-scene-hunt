/**
 * Deterministic game engine.
 *
 * This module is the single authority on progression. It is a pure reducer:
 * `(state, action) -> state`. No timers, no I/O, no randomness, no AI.
 *
 * Spec section 15 is explicit: "GPS、任务完成、奖励必须由确定性游戏逻辑控制".
 * The engine therefore never asks a narrative layer what should happen. The AI
 * hook is data-only; progression is decided here and here alone.
 *
 * Separating this from React is what makes the acceptance criteria testable:
 * every branch of the flow can be exercised in milliseconds, without a browser.
 */

import {
  buildAcceptedPool,
  matchChoiceAnswer,
  matchTextAnswer,
  type MatchResult,
} from "./answers";
import { entryScene, sceneOrder, type Challenge, type Game, type Reward, type Scene } from "./types";

/* ------------------------------------------------------------------ */
/* State shape                                                        */
/* ------------------------------------------------------------------ */

export type SceneStatus =
  | "locked"       // a prior scene is incomplete; the player cannot enter yet
  | "available"    // reachable, the player has not arrived yet
  | "arrived"      // player is inside the trigger radius
  | "challenging"  // arrived and the challenge is open
  | "completed";   // challenge solved, reward granted

/**
 * Statuses that are *stored* in a save, as opposed to derived.
 *
 * `available` and `locked` are both computed from the scene graph: a scene is
 * available exactly when every scene that gates it is complete. Persisting them
 * would create a second source of truth that can silently disagree with
 * `availableSceneIds` - for instance after a content pack is reordered - so
 * `SceneProgress.status` only ever records what the player actually *did*:
 *
 *   locked        -> never interacted (the gate value is recomputed on read)
 *   arrived       -> stood inside the radius
 *   challenging   -> opened the question
 *   completed     -> solved it
 *
 * Read status through `resolveSceneStatus()` / `sceneStatuses()`; those merge the
 * stored facts with the current graph and are what the UI uses.
 */
export type StoredSceneStatus = "locked" | "arrived" | "challenging" | "completed";

export interface SceneProgress {
  sceneId: string;
  /**
   * Stored player interaction. `locked` doubles as "not yet interacted";
   * reachability is derived, see `StoredSceneStatus`.
   */
  status: StoredSceneStatus;
  /** Unix ms when the player first entered the trigger radius. */
  arrivedAt?: number;
  /** Unix ms when the challenge was solved. */
  completedAt?: number;
  /** Number of failed attempts. Drives hint reveal, never locks the player out. */
  attempts: number;
  /** Ids of rewards already granted, so a revisit cannot double-grant. */
  grantedRewardIds: string[];
}

export interface InventoryItem {
  /** Derived id: `${type}:${value || title}` - stable across sessions. */
  id: string;
  type: Reward["type"];
  title: string;
  description?: string;
  value?: string;
  icon?: string;
  /** Which scene produced it. */
  sceneId: string;
  acquiredAt: number;
}

export interface GameState {
  gameId: string;
  gameVersion: string;
  /** Scene the player was last on. Restored on reload. */
  currentSceneId: string | null;
  scenes: Record<string, SceneProgress>;
  inventory: InventoryItem[];
  /** Collected keywords, kept separately for fast lookup by later scenes. */
  keywords: string[];
  startedAt: number;
  lastUpdatedAt: number;
  /** Set when every scene is complete. */
  finishedAt?: number;
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

export type GameAction =
  | { type: "START"; now: number }
  | { type: "FIX_UPDATE"; now: number; insideSceneIds: string[] }
  | { type: "ENTER_SCENE"; sceneId: string; now: number }
  | { type: "OPEN_CHALLENGE"; sceneId: string; now: number }
  | {
      type: "SUBMIT_ANSWER";
      sceneId: string;
      now: number;
      /** For choice challenges. */
      selectedIndex?: number;
      /** For text / keyword challenges. */
      text?: string;
    }
  | { type: "CLOSE_SCENE"; sceneId: string; now: number }
  | { type: "ADVANCE"; sceneId: string; now: number }
  | { type: "RESET"; now: number }
  | { type: "HYDRATE"; state: GameState };

/* ------------------------------------------------------------------ */
/* Derived values (computed, never stored twice)                      */
/* ------------------------------------------------------------------ */

/** Reward id is stable so a revisit cannot produce a second copy. */
export function rewardId(scene: Scene): string | null {
  if (!scene.reward) return null;
  const { type, value, title } = scene.reward;
  return `${scene.id}:${type}:${value ?? title}`;
}

/**
 * Scenes the player is currently allowed to enter.
 *
 * A scene becomes available when its predecessor is completed. The entry scene
 * is available from the start. Because V0.1 is a linear chain, this walks the
 * chain rather than doing a general topological sort - but it is written as a
 * graph walk so branching content packs keep working when V0.2 adds them.
 */
export function availableSceneIds(game: Game, state: GameState): string[] {
  const entry = entryScene(game);
  if (!entry) return [];
  const byId = new Map(game.scenes.map((s) => [s.id, s]));
  const available: string[] = [];

  const walk = (sceneId: string) => {
    const scene = byId.get(sceneId);
    if (!scene) return;
    const progress = state.scenes[scene.id];
    const done = progress?.status === "completed";
    if (!done) {
      // Reaching a scene that is not complete stops the walk: everything past it
      // stays locked.
      available.push(scene.id);
      return;
    }
    if (scene.nextSceneId) walk(scene.nextSceneId);
  };

  walk(entry.id);
  return available;
}

/** The scene the player should be heading to right now. */
export function activeScene(game: Game, state: GameState): Scene | null {
  const ids = availableSceneIds(game, state);
  const targetId = ids[ids.length - 1];
  if (!targetId) {
    // Everything reachable is complete: surface the last completed scene.
    const order = sceneOrder(game);
    return order[order.length - 1] ?? null;
  }
  return game.scenes.find((s) => s.id === targetId) ?? null;
}

export function isGameComplete(game: Game, state: GameState): boolean {
  return game.scenes.every((s) => state.scenes[s.id]?.status === "completed");
}

export function completionRatio(game: Game, state: GameState): number {
  if (!game.scenes.length) return 0;
  const done = game.scenes.filter((s) => state.scenes[s.id]?.status === "completed").length;
  return done / game.scenes.length;
}

/** Status of every scene, for the map and the progress list. */
export function sceneStatuses(
  game: Game,
  state: GameState,
): { scene: Scene; status: SceneStatus; isActive: boolean }[] {
  const available = new Set(availableSceneIds(game, state));
  const active = activeScene(game, state);

  return sceneOrder(game).map((scene) => ({
    scene,
    status: resolveSceneStatus(scene.id, state, available),
    isActive: active?.id === scene.id,
  }));
}

/**
 * Merge the stored interaction for one scene with the graph-derived gate.
 *
 * Precedence: a stored interaction wins (the player really did arrive, open the
 * question or solve it). Otherwise the scene is `available` when the graph lets
 * the player in, and `locked` when it does not.
 *
 * `availableSet` lets a caller checking many scenes pass the result of
 * `availableSceneIds` once instead of recomputing it per scene.
 */
export function resolveSceneStatus(
  sceneId: string,
  state: GameState,
  availableSet: Set<string>,
): SceneStatus {
  const stored = state.scenes[sceneId]?.status ?? "locked";
  if (stored !== "locked") return stored;
  return availableSet.has(sceneId) ? "available" : "locked";
}

/** Convenience wrapper when the caller has a `Game` and only wants one scene. */
export function statusOf(game: Game, state: GameState, sceneId: string): SceneStatus {
  return resolveSceneStatus(sceneId, state, new Set(availableSceneIds(game, state)));
}

/* ------------------------------------------------------------------ */
/* Construction                                                       */
/* ------------------------------------------------------------------ */

export function createInitialState(game: Game, now: number = Date.now()): GameState {
  const scenes: Record<string, SceneProgress> = {};
  for (const scene of game.scenes) {
    // Every scene starts at the same stored value: "no interaction yet".
    // Reachability is not stored - see StoredSceneStatus.
    scenes[scene.id] = {
      sceneId: scene.id,
      status: "locked",
      attempts: 0,
      grantedRewardIds: [],
    };
  }

  return {
    gameId: game.id,
    gameVersion: game.version,
    currentSceneId: null,
    scenes,
    inventory: [],
    keywords: [],
    startedAt: now,
    lastUpdatedAt: now,
  };
}

/**
 * Rebuild a state object from persisted data, reconciling it against the
 * content pack.
 *
 * This is the guard against a content pack being edited between sessions:
 * unknown scene ids are dropped, new scenes appear as locked, and a completed
 * scene whose reward no longer exists does not resurrect the old reward.
 */
export function reconcileState(game: Game, raw: Partial<GameState> | null, now = Date.now()): GameState {
  const base = createInitialState(game, now);
  if (!raw || raw.gameId !== game.id) return base;

  const byId = new Map(game.scenes.map((s) => [s.id, s]));
  const scenes: Record<string, SceneProgress> = {};

  for (const scene of game.scenes) {
    const persisted = raw.scenes?.[scene.id];
    if (!persisted) {
      // A scene introduced by an updated content pack. It inherits the neutral
      // baseline and will show as available only if the graph allows it.
      scenes[scene.id] = base.scenes[scene.id];
      continue;
    }
    const validStored: StoredSceneStatus[] = ["locked", "arrived", "challenging", "completed"];
    const rawStatus = persisted.status as string;
    // Tolerate saves written by an earlier schema that stored "available".
    const status: StoredSceneStatus = validStored.includes(rawStatus as StoredSceneStatus)
      ? (rawStatus as StoredSceneStatus)
      : "locked";
    scenes[scene.id] = {
      sceneId: scene.id,
      // A scene that was mid-arrival when the app closed reopens at the neutral
      // baseline rather than staying stuck at "arrived" with no position context.
      status: status === "arrived" || status === "challenging" ? "locked" : status,
      arrivedAt: persisted.arrivedAt,
      completedAt: persisted.completedAt,
      attempts: Number.isFinite(persisted.attempts) ? Math.max(0, persisted.attempts) : 0,
      grantedRewardIds: Array.isArray(persisted.grantedRewardIds)
        ? persisted.grantedRewardIds.filter((id) => typeof id === "string")
        : [],
    };
  }

  // Re-derive legitimacy so a tampered save file cannot unlock future scenes.
  // A scene may only stay `completed` if the whole chain leading to it is also
  // completed - otherwise a hand-edited localStorage entry would skip the hunt.
  const chain = sceneOrder(game);
  let gateOpen = true;
  for (const scene of chain) {
    const progress = scenes[scene.id];
    if (!gateOpen && progress.status === "completed") {
      // Unreachable but completed: strip it back to the baseline.
      scenes[scene.id] = {
        ...progress,
        status: "locked",
        completedAt: undefined,
        grantedRewardIds: [],
      };
      continue;
    }
    if (progress.status !== "completed") gateOpen = false;
  }
  // The current scene must always be one the player can actually be on.
  const allowed = new Set(
    Object.values(scenes)
      .filter((p) => p.status !== "locked")
      .map((p) => p.sceneId),
  );

  const inventory = Array.isArray(raw.inventory)
    ? raw.inventory.filter(
        (item): item is InventoryItem =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          !!byId.has(item.sceneId as string) &&
          // An item whose scene is no longer completed is a stale reward.
          scenes[item.sceneId as string]?.status === "completed",
      )
    : [];

  // Keywords are re-derived from the surviving inventory rather than trusted
  // from the save, so a tampered file cannot inject a keyword.
  const keywords = Array.from(
    new Set(
      inventory
        .map((item) => (item.type === "keyword" ? item.value ?? item.title : null))
        .filter((k): k is string => typeof k === "string" && k.length > 0),
    ),
  );

  return {
    gameId: game.id,
    gameVersion: game.version,
    currentSceneId:
      raw.currentSceneId && allowed.has(raw.currentSceneId) ? raw.currentSceneId : null,
    scenes,
    inventory,
    keywords,
    startedAt: Number.isFinite(raw.startedAt) ? (raw.startedAt as number) : now,
    lastUpdatedAt: now,
    finishedAt: Number.isFinite(raw.finishedAt) ? (raw.finishedAt as number) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                            */
/* ------------------------------------------------------------------ */

function withProgress(
  state: GameState,
  sceneId: string,
  patch: Partial<SceneProgress>,
): GameState {
  const existing = state.scenes[sceneId];
  if (!existing) return state;
  return {
    ...state,
    lastUpdatedAt: Date.now(),
    scenes: { ...state.scenes, [sceneId]: { ...existing, ...patch } },
  };
}

export function gameReducer(game: Game, state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "HYDRATE":
      return action.state;

    case "START": {
      const entry = entryScene(game);
      // Starting only moves the pointer; the entry scene is already reachable by
      // construction, so there is no stored flag to flip here.
      return { ...state, currentSceneId: entry ? entry.id : null, lastUpdatedAt: action.now };
    }

    case "FIX_UPDATE": {
      // Position updates only ever move a scene between "not yet interacted" and
      // "arrived". They can never complete a scene or grant a reward.
      const inside = new Set(action.insideSceneIds);
      const available = new Set(availableSceneIds(game, state));
      let changed = false;
      const scenes = { ...state.scenes };

      for (const scene of game.scenes) {
        const progress = scenes[scene.id];
        if (!progress) continue;

        if (progress.status === "locked" && inside.has(scene.id) && available.has(scene.id)) {
          scenes[scene.id] = { ...progress, status: "arrived", arrivedAt: action.now };
          changed = true;
        } else if (progress.status === "arrived" && !inside.has(scene.id)) {
          // The player walked back out before solving. Return to the neutral
          // baseline, but keep arrivedAt so progress is not lost.
          scenes[scene.id] = { ...progress, status: "locked" };
          changed = true;
        }
        // "challenging" deliberately survives leaving the radius: a player who
        // steps away mid-question should not lose the open challenge.
      }
      return changed ? { ...state, scenes, lastUpdatedAt: action.now } : state;
    }

    case "ENTER_SCENE": {
      const progress = state.scenes[action.sceneId];
      if (!progress) return state;
      // Entering is a deliberate act, but the gate still applies: a locked scene
      // cannot be entered even if the UI somehow dispatches this.
      if (!new Set(availableSceneIds(game, state)).has(action.sceneId)) return state;
      return withProgress(state, action.sceneId, {
        status: progress.status === "completed" ? "completed" : "arrived",
        arrivedAt: progress.arrivedAt ?? action.now,
      });
    }

    case "OPEN_CHALLENGE": {
      const scene = game.scenes.find((s) => s.id === action.sceneId);
      const progress = state.scenes[action.sceneId];
      if (!scene?.challenge || !progress) return state;
      if (progress.status === "completed") return state;
      if (!new Set(availableSceneIds(game, state)).has(action.sceneId)) return state;
      return withProgress(state, action.sceneId, { status: "challenging" });
    }

    case "SUBMIT_ANSWER": {
      const scene = game.scenes.find((s) => s.id === action.sceneId);
      const progress = state.scenes[action.sceneId];
      if (!scene?.challenge || !progress) return state;
      // Guard: a completed scene cannot be re-answered, which is what prevents
      // double reward grants on revisit.
      if (progress.status === "completed") return state;
      if (!new Set(availableSceneIds(game, state)).has(action.sceneId)) return state;

      const result = evaluateChallenge(scene.challenge, action);

      if (!result.correct) {
        return withProgress(state, action.sceneId, {
          attempts: progress.attempts + 1,
          // A wrong answer must never advance, and must not unlock the next scene.
          status: "challenging",
        });
      }

      return completeScene(game, state, scene, action.now);
    }

    case "ADVANCE":
    case "CLOSE_SCENE": {
      return { ...state, currentSceneId: null, lastUpdatedAt: action.now };
    }

    case "RESET":
      return createInitialState(game, action.now);

    default:
      return state;
  }
}

/** Pure challenge evaluation. Exported so tests can hit it directly. */
export function evaluateChallenge(
  challenge: Challenge,
  action: { selectedIndex?: number; text?: string },
): MatchResult {
  if (challenge.type === "choice") {
    if (typeof action.selectedIndex !== "number") {
      return { correct: false, method: "none" };
    }
    if (challenge.reflective) return { correct: true, method: "exact" };
    if (typeof challenge.answer !== "number") return { correct: false, method: "none" };
    return {
      correct: matchChoiceAnswer(action.selectedIndex, challenge.answer, challenge.options ?? []),
      method: "exact",
    };
  }
  return matchTextAnswer(
    action.text ?? "",
    challenge.answer as string | string[],
    { acceptedExtra: buildAcceptedPool(challenge.answer as string | string[], challenge.acceptedKeywords) },
  );
}

/**
 * Complete a scene and grant its reward.
 *
 * Idempotent by construction: `grantedRewardIds` is checked before appending, so
 * re-entering a finished location (spec section 17) yields no second reward and
 * no state change at all.
 */
export function completeScene(
  game: Game,
  state: GameState,
  scene: Scene,
  now: number,
): GameState {
  const progress = state.scenes[scene.id];
  if (!progress) return state;
  if (progress.status === "completed") return state;

  const rewardKey = rewardId(scene);
  const alreadyGranted = rewardKey ? progress.grantedRewardIds.includes(rewardKey) : true;

  let inventory = state.inventory;
  let keywords = state.keywords;

  if (scene.reward && rewardKey && !alreadyGranted) {
    const item: InventoryItem = {
      id: rewardKey,
      type: scene.reward.type,
      title: scene.reward.title,
      description: scene.reward.description,
      value: scene.reward.value,
      icon: scene.reward.icon,
      sceneId: scene.id,
      acquiredAt: now,
    };
    inventory = [...inventory, item];
    // Only `keyword` rewards enter the keyword pool. A `badge` or `item` may also
    // carry a `value`, but that is an asset id, not a word the player collected -
    // conflating them would leak internal ids into narrative text.
    const keyword = scene.reward.type === "keyword"
      ? scene.reward.value ?? scene.reward.title
      : null;
    if (keyword && !keywords.includes(keyword)) keywords = [...keywords, keyword];
  }

  const next: GameState = {
    ...state,
    lastUpdatedAt: now,
    inventory,
    keywords,
    scenes: {
      ...state.scenes,
      [scene.id]: {
        ...progress,
        status: "completed",
        completedAt: now,
        grantedRewardIds: rewardKey && !alreadyGranted
          ? [...progress.grantedRewardIds, rewardKey]
          : progress.grantedRewardIds,
      },
    },
  };

  // Unlocking is implicit: `availableSceneIds` walks completed scenes. We do not
  // eagerly flip the next scene to "available" here, because doing so would let
  // two sources of truth drift apart.
  const complete = game.scenes.every((s) => next.scenes[s.id]?.status === "completed");
  return complete ? { ...next, finishedAt: now } : next;
}

/** Has the player earned a given reward already? */
export function hasReward(state: GameState, scene: Scene): boolean {
  const key = rewardId(scene);
  if (!key) return false;
  return state.inventory.some((item) => item.id === key);
}

/** Convenience: is a specific scene complete in this state? */
export function isSceneComplete(state: GameState, sceneId: string): boolean {
  return state.scenes[sceneId]?.status === "completed";
}
