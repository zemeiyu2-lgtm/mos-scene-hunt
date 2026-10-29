import type { Scene } from "./types";

/**
 * Why a scene is still locked — derived, never stored.
 *
 * The quest screen used to print one hardcoded sentence ("完成「前一个地点」
 * 后解锁"), which is wrong for every pack that uses declarative gating: with
 * `requires` the prerequisites may be any scenes, not the previous row, and
 * with `requiresItems` the blocker may be an item rather than a task at all.
 * Keeping this logic here (rather than inline in the page) lets it be tested
 * against every gate combination.
 *
 * `Scene.lockReason`-style duplication is avoided on purpose: the authoritative
 * gate lives in `state.ts#sceneGateOpen`. This module only *explains* the same
 * rules in words, and intentionally stays read-only.
 */

export interface SceneLockReason {
  /** Titles of prerequisite scenes that are not yet complete. */
  tasks: string[];
  /** Display names of required item kinds the player does not hold yet. */
  items: string[];
}

/** Item kind an inventory entry satisfies — mirrors `state.ts#itemKindOfItem`. */
function inventoryItemKind(value: string | undefined, title: string): string {
  return value ?? title;
}

/** Map of item kind -> the reward title that produces it, from all scenes. */
function itemKindNames(scenes: Scene[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const scene of scenes) {
    const reward = scene.reward;
    if (!reward || reward.type !== "item") continue;
    const kind = reward.value ?? reward.title;
    if (!names.has(kind)) names.set(kind, reward.title);
  }
  return names;
}

/**
 * Compute what is still blocking `scene`.
 *
 * Returns empty arrays when the scene declares neither gate — that is the
 * signal for the caller to fall back to the implicit chain explanation.
 */
export function sceneLockReason(
  scene: Scene,
  scenes: Scene[],
  completedSceneIds: ReadonlySet<string>,
  heldItemKinds: ReadonlySet<string>,
): SceneLockReason {
  const titles = new Map(scenes.map((s) => [s.id, s.title]));
  const kinds = itemKindNames(scenes);

  const items: string[] = [];
  for (const kind of scene.requiresItems ?? []) {
    if (heldItemKinds.has(kind)) continue;
    items.push(kinds.get(kind) ?? kind);
  }

  const tasks: string[] = [];
  for (const id of scene.requires ?? []) {
    if (completedSceneIds.has(id)) continue;
    tasks.push(titles.get(id) ?? id);
  }

  return { tasks, items };
}

/** Collect the item kinds the player currently holds from a save. */
export function heldItemKindsFrom(
  inventory: ReadonlyArray<{ type: string; title: string; value?: string }>,
): Set<string> {
  const held = new Set<string>();
  for (const item of inventory) {
    if (item.type !== "item") continue;
    held.add(inventoryItemKind(item.value, item.title));
  }
  return held;
}

/**
 * Render the reason as one sentence.
 *
 * `fallback` is used when the scene declares no gates at all — the implicit
 * chain still applies there, and describing it belongs to the caller.
 */
export function describeSceneLock(reason: SceneLockReason, fallback: string): string {
  const quotedTasks = reason.tasks.map((t) => `「${t}」`);
  const quotedItems = reason.items.map((i) => `「${i}」`);

  if (quotedTasks.length > 0 && quotedItems.length > 0) {
    return `需先完成${quotedTasks.join("")}，并获得${quotedItems.join("")}`;
  }
  if (quotedTasks.length > 0) {
    return `需先完成${quotedTasks.join("")}`;
  }
  if (quotedItems.length > 0) {
    return `需先获得物品${quotedItems.join("")}`;
  }
  return fallback;
}
