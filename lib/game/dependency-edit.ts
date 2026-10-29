/**
 * Pure helpers for editing a scene's declared `requires` prerequisites.
 *
 * The engine already honours `requires` (see `sceneGateOpen` in state.ts: a
 * declared list REPLACES the implicit nextSceneId gate, and every entry must be
 * completed). What the designer must guarantee is narrower but strict: it may
 * never write a pack that `validateGame` would reject on read, because a pack
 * that fails validation is silently dropped from the local library on reload.
 *
 * Rules enforced here, mirroring the validator:
 *   - stable scene ids only (never titles as identity);
 *   - no self-dependency;
 *   - no direct or indirect `requires` cycle (A -> B -> C -> A);
 *   - no dependency on an unknown scene (dangling import);
 *   - no duplicate entries;
 *   - the entry scene cannot declare prerequisites (it would never open).
 *
 * Every helper returns a new object and leaves the input untouched.
 */

import { entryScene, type Game, type Scene } from "./types";

export interface SceneOption {
  id: string;
  title: string;
  /** 1-based position in the authored order, for display only. */
  position: number;
  selected: boolean;
  /** Adding this option would create a dependency cycle. */
  wouldCycle: boolean;
}

/** The entry scene id the engine will actually use. */
export function entrySceneIdOf(game: Game): string | undefined {
  return (game.entrySceneId ?? game.scenes[0]?.id) || undefined;
}

/**
 * True when `fromId` already depends (directly or transitively) on `toId`
 * through `requires` edges.
 */
function requiresPathExists(
  scenes: Scene[],
  fromId: string,
  toId: string,
  seen: Set<string> = new Set(),
): boolean {
  if (fromId === toId) return true;
  if (seen.has(fromId)) return false;
  seen.add(fromId);
  const scene = scenes.find((s) => s.id === fromId);
  for (const next of scene?.requires ?? []) {
    if (requiresPathExists(scenes, next, toId, seen)) return true;
  }
  return false;
}

/**
 * Would adding `dependencyId` to `sceneId`'s prerequisites create a cycle?
 *
 * The new edge is sceneId -> dependencyId ("sceneId needs dependencyId").
 * A cycle appears exactly when dependencyId already needs sceneId, directly or
 * through any chain of declared `requires` edges.
 */
export function wouldCreateRequiresCycle(
  game: Game,
  sceneId: string,
  dependencyId: string,
): boolean {
  if (sceneId === dependencyId) return true;
  return requiresPathExists(game.scenes, dependencyId, sceneId);
}

/** Options for the prerequisite picker on `sceneId`. */
export function requirableSceneOptions(game: Game, sceneId: string): SceneOption[] {
  const scene = game.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const selected = new Set(scene.requires ?? []);
  const entryId = entrySceneIdOf(game);
  return game.scenes
    .map((other, i) => ({ other, i }))
    .filter(({ other }) => other.id !== sceneId)
    .map(({ other, i }) => ({
      id: other.id,
      title: other.title,
      position: i + 1,
      selected: selected.has(other.id),
      wouldCycle: other.id === entryId ? false : wouldCreateRequiresCycle(game, sceneId, other.id),
    }));
}

/**
 * Toggle one prerequisite on a scene.
 *
 * Returns `{ scene }` on success or `{ error }` when the toggle would make the
 * pack invalid. Removing a nonexistent entry is a no-op success (idempotent),
 * and adding an existing one never duplicates.
 */
export function toggleSceneRequires(
  game: Game,
  sceneId: string,
  dependencyId: string,
): { scene: Scene } | { error: string } {
  const scene = game.scenes.find((s) => s.id === sceneId);
  if (!scene) return { error: "找不到要编辑的场景" };
  const target = game.scenes.find((s) => s.id === dependencyId);
  if (!target) return { error: `前置场景不存在：${dependencyId}` };

  const current = scene.requires ?? [];
  if (current.includes(dependencyId)) {
    const next = current.filter((id) => id !== dependencyId);
    return { scene: { ...scene, requires: next.length ? next : undefined } };
  }

  if (sceneId === dependencyId) return { error: "场景不能把自己设为前置场景" };
  if (entrySceneIdOf(game) === sceneId) {
    return { error: "起点场景不能设置前置场景：否则游戏一开始就没有可去的地方" };
  }
  if (wouldCreateRequiresCycle(game, sceneId, dependencyId)) {
    const chain = describeRequiresChain(game, dependencyId, sceneId);
    return {
      error: `会形成循环依赖：${chain}，游戏将永远无法解锁`,
    };
  }
  return { scene: { ...scene, requires: [...current, dependencyId] } };
}

/**
 * Human-readable chain from `fromId` to `toId` through `requires` edges, used
 * in cycle errors. Falls back to the bare pair when no path is found.
 */
export function describeRequiresChain(game: Game, fromId: string, toId: string): string {
  const titles = (id: string) => game.scenes.find((s) => s.id === id)?.title ?? id;
  const path: string[] = [];
  const visit = (id: string, trail: string[]): boolean => {
    if (id === toId) {
      path.push(...trail, id);
      return true;
    }
    if (trail.includes(id)) return false;
    const scene = game.scenes.find((s) => s.id === id);
    for (const next of scene?.requires ?? []) {
      if (visit(next, [...trail, id])) return true;
    }
    return false;
  };
  if (visit(fromId, [])) return path.map(titles).join(" → ");
  return `${titles(fromId)} → ${titles(toId)}`;
}

/**
 * Remove every prerequisite reference to a scene that is being deleted.
 *
 * Deleting a scene while others still require it would leave a dangling id;
 * the validator rejects that, and the whole pack would vanish on the next
 * read. The designer therefore cleans the references and reports which scenes
 * changed, so the author sees the consequence instead of a silent edit.
 */
export function removeRequiresRefsTo(
  game: Game,
  deletedSceneId: string,
): { game: Game; affected: Array<{ sceneId: string; title: string }> } {
  const affected: Array<{ sceneId: string; title: string }> = [];
  const scenes = game.scenes.map((scene) => {
    if (!scene.requires?.includes(deletedSceneId)) return scene;
    affected.push({ sceneId: scene.id, title: scene.title });
    const next = scene.requires.filter((id) => id !== deletedSceneId);
    return { ...scene, requires: next.length ? next : undefined };
  });
  return { game: { ...game, scenes }, affected };
}

/** Scenes whose `requires` references an id that no longer exists. */
export function danglingRequiresRefs(game: Game): Array<{ sceneId: string; missingId: string }> {
  const ids = new Set(game.scenes.map((s) => s.id));
  const dangling: Array<{ sceneId: string; missingId: string }> = [];
  for (const scene of game.scenes) {
    for (const id of scene.requires ?? []) {
      if (!ids.has(id)) dangling.push({ sceneId: scene.id, missingId: id });
    }
  }
  return dangling;
}

/** Convenience for the picker header: how many prerequisites are selected. */
export function requiresCount(scene: Scene): number {
  return scene.requires?.length ?? 0;
}

/**
 * Keep the first scene valid as an entry after a reorder.
 *
 * Reordering (上移/下移) makes `scenes[0]` the entry, and an entry that
 * declares `requires` can never open at game start - the engine offers nothing
 * and the run is dead. The designer therefore clears the new entry's
 * prerequisites and reports it, instead of letting the author hit a save-time
 * validator error they cannot map back to the action they took.
 */
export function normalizeEntryRequires(
  scenes: Scene[],
): { scenes: Scene[]; clearedTitle: string | null } {
  const first = scenes[0];
  if (!first?.requires?.length) return { scenes, clearedTitle: null };
  return {
    scenes: scenes.map((scene, i) => (i === 0 ? { ...scene, requires: undefined } : scene)),
    clearedTitle: first.title,
  };
}

/** True when this scene is the hunt's entry (its gate can never include deps). */
export function isEntryScene(game: Game, sceneId: string): boolean {
  return entryScene(game)?.id === sceneId;
}
