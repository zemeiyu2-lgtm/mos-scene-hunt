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
import { timeLimitMs } from "./timed-challenge";

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
  /**
   * When the current timed attempt's clock started (Unix ms).
   *
   * Persisted on purpose: this is what makes a reload continue the same attempt
   * instead of handing out a fresh window. Absent on untimed challenges, and
   * cleared when an attempt expires or the scene completes.
   */
  attemptStartedAt?: number;
  /**
   * When the current attempt ran out of time. Sticky until 重试, so an expired
   * attempt stays expired across reloads and can never be graded afterwards.
   */
  timedOutAt?: number;
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
  /**
   * Recorded branch choices: choosing scene id -> branch target scene id.
   * Written once when a choice challenge is submitted successfully; drives
   * which route the chain gate opens afterwards. Optional so saves from
   * before branching restore cleanly (treated as no routes taken).
   */
  routes?: Record<string, string>;
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
  | { type: "HYDRATE"; state: GameState }
  /**
   * The timed attempt ran out. Idempotent: only the first call after the
   * deadline is honoured, so a timer that fires twice (or a submit racing the
   * timer) can never add two failed attempts.
   */
  | { type: "EXPIRE_ATTEMPT"; sceneId: string; now: number }
  /** 重试: start a fresh, independent attempt with the full limit. */
  | { type: "RETRY_ATTEMPT"; sceneId: string; now: number };

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
 * The scene this scene leads to for THIS playthrough.
 *
 * Non-branching scenes: the static `nextSceneId`. Graded (non-reflective)
 * branching choices: only the correct answer can submit, so the route is
 * content-determined - re-derived from the pack, never trusted from the save.
 * Reflective branching choices: the route the player actually chose (recorded
 * in `routes` at submit time and re-validated against declared branches on
 * restore); before a choice is recorded the static edge remains, but the
 * choosing scene is not completed yet then, so nothing opens through it.
 */
function effectiveNextId(scene: Scene, routes: Record<string, string> | undefined): string | null {
  const challenge = scene.challenge;
  const branches = challenge?.type === "choice" ? challenge.branches : undefined;
  if (!challenge || !branches) return scene.nextSceneId;
  if (!challenge.reflective) {
    if (typeof challenge.answer === "number") {
      return branches[String(challenge.answer)] ?? scene.nextSceneId;
    }
    return scene.nextSceneId;
  }
  const target = routes?.[scene.id];
  if (target && Object.values(branches).includes(target)) return target;
  return scene.nextSceneId;
}

/**
 * sceneId -> ids of scenes that can follow it: static `nextSceneId` edges
 * plus the branch edge actually taken (`routes`) for branching choice scenes.
 */
function predecessorMap(game: Game, routes?: Record<string, string>): Map<string, string[]> {
  const preds = new Map<string, string[]>();
  const push = (from: string, to: string) => {
    const list = preds.get(to);
    if (list) list.push(from);
    else preds.set(to, [from]);
  };
  for (const scene of game.scenes) {
    const next = effectiveNextId(scene, routes);
    if (next) push(scene.id, next);
    // A branching scene whose recorded route is still open must not keep its
    // old static edge: the choice replaced it for this playthrough. But before
    // any choice is recorded the static edge stays (the scene is not completed
    // yet, so nothing opens through it either way).
  }
  return preds;
}

/**
 * Item-kind id an inventory record carries, or null for non-item records.
 *
 * This is the KIND identity ("the player holds a bronze key"), deliberately
 * distinct from the reward RECORD id (`rewardId()`, "scene a granted its
 * bronze key"). Gating must compare kinds: two different scenes may both
 * grant the same kind, and either record proves the player holds it.
 */
function itemKindOfItem(item: InventoryItem): string | null {
  if (item.type !== "item") return null;
  return item.value ?? item.title;
}

/** Item kind a scene's item reward produces, or null. */
function itemKindOfReward(scene: Scene): string | null {
  if (!scene.reward || scene.reward.type !== "item") return null;
  return scene.reward.value ?? scene.reward.title;
}

/**
 * Gate rule for one scene.
 *
 * Two independent gates must both open:
 *  1. Task gate - a scene that declares `requires` opens only when every
 *     declared prerequisite is complete (the list replaces the implicit chain
 *     gate entirely); scenes without `requires` keep the V0.1 rule (entry
 *     always open, others open when their chain predecessor is complete).
 *  2. Item gate - a scene that declares `requiresItems` opens only when the
 *     player holds ALL the listed item kinds. This is independent of the task
 *     gate: completing tasks can never satisfy an item requirement.
 *
 * `completed` / `heldItems` are the sets the engine actually honours (see
 * `legitimateProgress`), so a hand-edited save cannot satisfy a gate.
 */
function sceneGateOpen(
  scene: Scene,
  entryId: string | undefined,
  predecessors: Map<string, string[]>,
  completed: Set<string>,
  heldItems: Set<string>,
): boolean {
  const requiredItems = scene.requiresItems;
  const hasItems = !!requiredItems && requiredItems.length > 0;
  const itemGate = !hasItems || requiredItems!.every((kind) => heldItems.has(kind));
  if (!itemGate) return false;

  if (scene.requires && scene.requires.length > 0) {
    // Declared task gate replaces the implicit chain rule; the item gate above
    // still applies on top of it.
    return scene.requires.every((id) => completed.has(id));
  }
  const onTaskChain =
    scene.id === entryId || (predecessors.get(scene.id) ?? []).some((id) => completed.has(id));
  if (onTaskChain) return true;
  // A scene with no task-gate source at all (not the entry, no chain edge in,
  // no declared `requires`) is unreachable under the classic rule. If it
  // declares `requiresItems`, the item condition acts as its gate - there is
  // no chain here to prematurely advance, so this cannot skip the linear hunt.
  return hasItems;
}

/**
 * Co-fixpoint over stored completions and inventory records: a completion is
 * honoured only when its dependency gate is satisfied by other *honoured*
 * completions and *legitimate* items; an item kind is legitimate only when a
 * record from an honoured scene carries it (and matches what that scene's
 * reward actually produces). The two sets feed each other, so they are grown
 * together until stable - deterministic and monotone, hence terminating.
 *
 * This keeps linear chains identical to the old single walk from the entry
 * scene while covering declared `requires` and `requiresItems` gates.
 */
function legitimateProgress(
  game: Game,
  isCompleted: (sceneId: string) => boolean,
  inventory: InventoryItem[],
  routes?: Record<string, string>,
): { completed: Set<string>; heldItems: Set<string> } {
  const entryId = entryScene(game)?.id;
  const predecessors = predecessorMap(game, routes);
  const byId = new Map(game.scenes.map((s) => [s.id, s]));

  const completed = new Set<string>();
  const heldItems = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of inventory) {
      const kind = itemKindOfItem(item);
      if (!kind || heldItems.has(kind)) continue;
      if (!completed.has(item.sceneId)) continue;
      const source = byId.get(item.sceneId);
      // Kind-forgery guard: the record must be the kind its source scene
      // actually mints, not merely pointed at a completed scene.
      if (!source || itemKindOfReward(source) !== kind) continue;
      heldItems.add(kind);
      changed = true;
    }
    for (const scene of game.scenes) {
      if (completed.has(scene.id)) continue;
      if (!isCompleted(scene.id)) continue;
      if (sceneGateOpen(scene, entryId, predecessors, completed, heldItems)) {
        completed.add(scene.id);
        changed = true;
      }
    }
  }
  return { completed, heldItems };
}

/**
 * Scenes the player is currently allowed to enter (the unlocked frontier).
 *
 * The result keeps the V0.1 shape: scenes already completed are not listed,
 * so a linear hunt yields exactly the current target and a finished hunt
 * yields nothing. Scenes gated by declared `requires` or `requiresItems` join
 * the frontier as soon as their conditions are met, in sceneOrder order.
 */
export function availableSceneIds(game: Game, state: GameState): string[] {
  const { completed, heldItems } = legitimateProgress(
    game,
    (id) => state.scenes[id]?.status === "completed",
    state.inventory,
    state.routes,
  );
  const entryId = entryScene(game)?.id;
  const predecessors = predecessorMap(game, state.routes);

  return sceneOrder(game)
    .filter(
      (scene) =>
        !completed.has(scene.id) &&
        sceneGateOpen(scene, entryId, predecessors, completed, heldItems),
    )
    .map((scene) => scene.id);
}

/** The scene the player should be heading to right now. */
export function activeScene(game: Game, state: GameState): Scene | null {
  const ids = availableSceneIds(game, state);
  const targetId = ids[ids.length - 1];
  if (!targetId) {
    // Everything reachable is complete: surface the scene finished most
    // recently - in a multi-ending hunt that is the ending just reached, not
    // an arbitrary last entry of the pack.
    let latest: { scene: Scene; at: number } | null = null;
    for (const scene of game.scenes) {
      const progress = state.scenes[scene.id];
      if (progress?.status !== "completed") continue;
      if (!latest || (progress.completedAt ?? 0) >= latest.at) {
        latest = { scene, at: progress.completedAt ?? 0 };
      }
    }
    return latest?.scene ?? null;
  }
  return game.scenes.find((s) => s.id === targetId) ?? null;
}

/** The route-aware next scene after `sceneId`, or null when it is an ending. */
export function nextSceneIdOf(game: Game, state: GameState, sceneId: string): string | null {
  const scene = game.scenes.find((s) => s.id === sceneId);
  return scene ? effectiveNextId(scene, state.routes) : null;
}

/** True when the scene has no onward route for this playthrough (an ending). */
function isEndingScene(scene: Scene, state: GameState): boolean {
  return effectiveNextId(scene, state.routes) === null;
}

/**
 * The hunt is complete once the player finishes ANY legal ending - a completed
 * scene with no onward route. Single-line packs have exactly one such scene
 * (the last), so the old "everything completed" outcome is unchanged; in a
 * multi-ending hunt the other branches' scenes are not required.
 */
export function isGameComplete(game: Game, state: GameState): boolean {
  return game.scenes.some((s) => state.scenes[s.id]?.status === "completed" && isEndingScene(s, state));
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
    routes: {},
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
    // Timed-attempt bookkeeping survives a reload verbatim (that is the whole
    // point of persisting the start stamp), but is dropped when the pack no
    // longer declares a limit - an author removing 限时 must not leave a stale
    // clock behind in a save the player keeps.
    const timed = timeLimitMs(scene.challenge) !== null;
    scenes[scene.id] = {
      sceneId: scene.id,
      // A scene that was mid-arrival when the app closed reopens at the neutral
      // baseline rather than staying stuck at "arrived" with no position context.
      status: status === "arrived" ? "locked" : status,
      arrivedAt: persisted.arrivedAt,
      completedAt: persisted.completedAt,
      attempts: Number.isFinite(persisted.attempts) ? Math.max(0, persisted.attempts) : 0,
      attemptStartedAt:
        timed && Number.isFinite(persisted.attemptStartedAt)
          ? (persisted.attemptStartedAt as number)
          : undefined,
      timedOutAt:
        timed && Number.isFinite(persisted.timedOutAt) ? (persisted.timedOutAt as number) : undefined,
      grantedRewardIds: Array.isArray(persisted.grantedRewardIds)
        ? persisted.grantedRewardIds.filter((id) => typeof id === "string")
        : [],
    };
  }

  // Sanitize recorded routes before they influence any gate. A route entry
  // survives only when the pack actually declares that branch on that scene's
  // choice challenge; graded (non-reflective) choices are re-derived from the
  // correct answer instead of trusted, since only the correct option can ever
  // submit. Forged routes therefore cannot unlock undeclared paths.
  const rawRoutes = raw.routes && typeof raw.routes === "object" ? raw.routes : {};
  const routes: Record<string, string> = {};
  for (const scene of game.scenes) {
    const challenge = scene.challenge;
    const branches = challenge?.type === "choice" ? challenge.branches : undefined;
    if (!challenge || !branches) continue;
    if (!challenge.reflective) {
      if (typeof challenge.answer === "number") {
        const derived = branches[String(challenge.answer)];
        if (derived) routes[scene.id] = derived;
      }
      continue;
    }
    const stored = (rawRoutes as Record<string, unknown>)[scene.id];
    if (typeof stored === "string" && Object.values(branches).includes(stored)) {
      routes[scene.id] = stored;
    }
  }

  // Re-derive legitimacy so a tampered save file cannot unlock future scenes.
  // Completions and items are legitimate only together: a completion needs its
  // dependency gate (task gate + item gate) satisfied, an item kind needs a
  // record from a legitimate scene producing exactly that kind. The co-fixpoint
  // avoids any circular dependency between the two derivations - otherwise a
  // hand-edited localStorage entry could forge an item to legitimize a
  // combine-scene completion (or vice versa).
  const { completed: honoured } = legitimateProgress(
    game,
    (id) => scenes[id]?.status === "completed",
    Array.isArray(raw.inventory) ? (raw.inventory as InventoryItem[]) : [],
    routes,
  );
  for (const scene of game.scenes) {
    const progress = scenes[scene.id];
    if (progress.status === "completed" && !honoured.has(scene.id)) {
      // Unreachable but completed: strip it back to the baseline.
      scenes[scene.id] = {
        ...progress,
        status: "locked",
        completedAt: undefined,
        grantedRewardIds: [],
      };
    }
  }
  // The current scene must always be one the player can actually be on.
  const allowed = new Set(
    Object.values(scenes)
      .filter((p) => p.status !== "locked")
      .map((p) => p.sceneId),
  );

  const inventory = Array.isArray(raw.inventory)
    ? raw.inventory.filter((item): item is InventoryItem => {
        if (!item || typeof item.id !== "string" || typeof item.title !== "string") return false;
        if (!byId.has(item.sceneId as string)) return false;
        // An item whose scene is not legitimately completed is a stale reward.
        if (!honoured.has(item.sceneId as string)) return false;
        const source = byId.get(item.sceneId as string)!;
        if (item.type === "item") {
          // Kind-forgery guard: the record must carry exactly the kind its
          // source reward mints, not merely point at a completed scene.
          return itemKindOfReward(source) === itemKindOfItem(item);
        }
        return true;
      })
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

  const reconciled: GameState = {
    gameId: game.id,
    gameVersion: game.version,
    currentSceneId:
      raw.currentSceneId && allowed.has(raw.currentSceneId) ? raw.currentSceneId : null,
    scenes,
    inventory,
    keywords,
    routes,
    startedAt: Number.isFinite(raw.startedAt) ? (raw.startedAt as number) : now,
    lastUpdatedAt: now,
    finishedAt: undefined,
  };
  // finishedAt is re-derived, not trusted: a forged timestamp cannot mark an
  // unfinished hunt complete, and a real finish survives the restore.
  if (isGameComplete(game, reconciled)) {
    reconciled.finishedAt = Number.isFinite(raw.finishedAt) ? (raw.finishedAt as number) : now;
  }
  return reconciled;
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
      // First start moves the pointer to the entry scene. A re-entry (退出后
      // 从游戏中心重新进入) keeps the pointer where the player left it, so
      // resuming restores the current target instead of walking back to the
      // entry; completed scenes and rewards are never touched either way.
      if (state.currentSceneId) return { ...state, lastUpdatedAt: action.now };
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
      // Timed question: the clock starts the moment it becomes answerable, and
      // only once. Re-opening an attempt that is already running (leaving the
      // screen and coming back) must not restart it, and an expired attempt
      // stays expired until 重试 - otherwise navigating away would buy time.
      const limitMs = timeLimitMs(scene.challenge);
      const startClock =
        limitMs !== null && progress.attemptStartedAt === undefined && progress.timedOutAt === undefined;
      return withProgress(state, action.sceneId, {
        status: "challenging",
        ...(startClock ? { attemptStartedAt: action.now } : {}),
      });
    }

    case "EXPIRE_ATTEMPT": {
      const scene = game.scenes.find((s) => s.id === action.sceneId);
      const progress = state.scenes[action.sceneId];
      if (!scene?.challenge || !progress) return state;
      if (progress.status !== "challenging") return state;
      const limitMs = timeLimitMs(scene.challenge);
      if (limitMs === null) return state;
      // Exactly once per attempt: `timedOutAt` is the latch, and the start
      // stamp is cleared so a second timer tick finds nothing to expire.
      if (progress.timedOutAt !== undefined) return state;
      if (progress.attemptStartedAt === undefined) return state;
      if (action.now - progress.attemptStartedAt < limitMs) return state;
      return withProgress(state, action.sceneId, {
        status: "challenging",
        attempts: progress.attempts + 1,
        attemptStartedAt: undefined,
        timedOutAt: action.now,
      });
    }

    case "RETRY_ATTEMPT": {
      const scene = game.scenes.find((s) => s.id === action.sceneId);
      const progress = state.scenes[action.sceneId];
      if (!scene?.challenge || !progress) return state;
      if (progress.status !== "challenging") return state;
      if (timeLimitMs(scene.challenge) === null) return state;
      // Retry only exists for an expired attempt. Guarding on the latch makes a
      // double-tap idempotent: the second dispatch finds no expiry to clear and
      // cannot start a second clock.
      if (progress.timedOutAt === undefined) return state;
      if (!new Set(availableSceneIds(game, state)).has(action.sceneId)) return state;
      return withProgress(state, action.sceneId, {
        attemptStartedAt: action.now,
        timedOutAt: undefined,
      });
    }

    case "SUBMIT_ANSWER": {
      const scene = game.scenes.find((s) => s.id === action.sceneId);
      const progress = state.scenes[action.sceneId];
      if (!scene?.challenge || !progress) return state;
      // Guard: a completed scene cannot be re-answered, which is what prevents
      // double reward grants on revisit.
      if (progress.status === "completed") return state;
      if (!new Set(availableSceneIds(game, state)).has(action.sceneId)) return state;

      // Timed questions are graded against the stored deadline, not against what
      // the screen believed: a late answer is either rejected (attempt already
      // expired) or converted into the expiry it actually is. Without this, a
      // stale tab could still submit after the countdown hit zero.
      const limitMs = timeLimitMs(scene.challenge);
      if (limitMs !== null) {
        if (progress.timedOutAt !== undefined) return state;
        if (
          progress.attemptStartedAt !== undefined &&
          action.now - progress.attemptStartedAt >= limitMs
        ) {
          return withProgress(state, action.sceneId, {
            status: "challenging",
            attempts: progress.attempts + 1,
            attemptStartedAt: undefined,
            timedOutAt: action.now,
          });
        }
      }

      const result = evaluateChallenge(scene.challenge, action);

      if (!result.correct) {
        return withProgress(state, action.sceneId, {
          attempts: progress.attempts + 1,
          // A wrong answer must never advance, and must not unlock the next scene.
          status: "challenging",
        });
      }

      // Determine the route this successful submission takes BEFORE completing
      // the scene. The ending check inside completeScene derives each scene's
      // onward edge from `routes`; running it against a state that still lacks
      // the just-taken route would misjudge a reflective choice whose static
      // nextSceneId is null but whose branch points onward as an ending and
      // set finishedAt prematurely.
      const branches = scene.challenge.type === "choice" ? scene.challenge.branches : undefined;
      const target =
        branches && typeof action.selectedIndex === "number"
          ? branches[String(action.selectedIndex)]
          : undefined;
      // Only a declared branch of the actually-submitted option is recorded,
      // and only together with the completion (which the guards above enforce)
      // - opening the question, arriving at the scene, or tapping an option
      // never writes a route. Wrong answers return above and undeclared
      // options produce no target, so neither can influence the finish state.
      const routed: GameState = target
        ? { ...state, routes: { ...(state.routes ?? {}), [scene.id]: target } }
        : state;
      return completeScene(game, routed, scene, action.now);
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
        // Success ends the attempt: no countdown may survive it, and a solved
        // timed question must never resurrect an expiry on the next visit.
        attemptStartedAt: undefined,
        timedOutAt: undefined,
        grantedRewardIds: rewardKey && !alreadyGranted
          ? [...progress.grantedRewardIds, rewardKey]
          : progress.grantedRewardIds,
      },
    },
  };

  // Unlocking is implicit: `availableSceneIds` walks completed scenes. We do not
  // eagerly flip the next scene to "available" here, because doing so would let
  // two sources of truth drift apart.
  // The hunt is finished when a legal ending has been completed - not when
  // every scene is (other branches' endings are optional by design).
  const complete = game.scenes.some(
    (s) => next.scenes[s.id]?.status === "completed" && isEndingScene(s, next),
  );
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
