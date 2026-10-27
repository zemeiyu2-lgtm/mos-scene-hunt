/**
 * Pure helpers for editing a scene's `Reward` and `requiresItems` gate in the
 * micro designer.
 *
 * The engine already fully supports item rewards and item-kind gating
 * (`sceneGateOpen` in state.ts, validation in types.ts); these helpers only
 * make that power configurable without letting the designer save a pack that
 * would fail `validateGame` on read (a pack that fails validation is dropped
 * silently from the local library, which would look like data loss).
 *
 * Every helper returns a new object and leaves the input untouched, mirroring
 * the contract of `challenge-edit.ts`.
 */

import type { Game, Reward, RewardType, Scene } from "./types";

export const REWARD_TYPE_LABEL: Record<RewardType, string> = {
  keyword: "关键词",
  item: "物品",
  badge: "徽章",
  story: "剧情",
};

/**
 * Switch a reward's type, keeping the authored title.
 *
 * `keyword` and `item` both key off `value ?? title` (the keyword pool and the
 * item-kind identity respectively), so a meaningful value is preserved across
 * those switches. `badge`/`story` carry no mechanical identity, so `value`
 * becomes optional display text and is left as-is when present.
 */
export function setRewardType(reward: Reward | undefined, type: RewardType): Reward | undefined {
  if (!reward) {
    // No reward authored yet: start from a sensible default for the chosen type.
    const fallbackTitle = type === "item" ? "新物品" : type === "badge" ? "新徽章" : type === "story" ? "新剧情" : "新线索";
    return { type, title: fallbackTitle, value: fallbackTitle };
  }
  return { ...reward, type };
}

/** Item kinds this pack can actually produce, with the scenes that mint them. */
export function itemKindsProducedBy(
  game: Game,
): Array<{ kind: string; producerIds: string[] }> {
  const byKind = new Map<string, string[]>();
  for (const scene of game.scenes) {
    if (scene.reward?.type !== "item") continue;
    const kind = scene.reward.value ?? scene.reward.title;
    if (!kind) continue;
    const list = byKind.get(kind);
    if (list) list.push(scene.id);
    else byKind.set(kind, [scene.id]);
  }
  return Array.from(byKind.entries())
    .map(([kind, producerIds]) => ({ kind, producerIds }))
    .sort((a, b) => a.kind.localeCompare(b.kind, "zh-CN"));
}

/**
 * Toggle one item kind on a scene's `requiresItems` gate.
 *
 * Returns null when the toggle is not allowed:
 * - the kind is only produced by this very scene (the validator rejects a
 *   self-only producer as permanently unopenable);
 * - the kind is not produced anywhere in the pack.
 */
export function toggleSceneRequiresItems(
  scene: Scene,
  game: Game,
  kind: string,
): { scene: Scene } | { error: string } {
  const producers = itemKindsProducedBy(game).find((k) => k.kind === kind);
  if (!producers) return { error: `物品「${kind}」不由本游戏包中的任何物品奖励产出` };
  const otherProducers = producers.producerIds.filter((id) => id !== scene.id);
  if (otherProducers.length === 0) {
    return { error: `物品「${kind}」只能由本场景自己产出，加上门控后本场景将永远无法开始` };
  }
  const current = scene.requiresItems ?? [];
  const next = current.includes(kind)
    ? current.filter((k) => k !== kind)
    : [...current, kind];
  return { scene: { ...scene, requiresItems: next } };
}

/**
 * Switch a scene's reward type at pack level.
 *
 * Leaving the `item` type orphans any `requiresItems` entry that depended on
 * the kind this scene minted — the validator would then reject the whole pack.
 * Those stale gate entries are stripped automatically and reported, so the
 * designer sees the consequence instead of losing the save on reload.
 */
export function switchSceneRewardType(
  game: Game,
  sceneId: string,
  type: RewardType,
): { game: Game; warnings: string[] } {
  const warnings: string[] = [];
  const scenes = game.scenes.map((scene) => {
    if (scene.id === sceneId) {
      return { ...scene, reward: setRewardType(scene.reward, type) };
    }
    return scene;
  });

  if (type !== "item") {
    const source = game.scenes.find((s) => s.id === sceneId);
    const oldKind =
      source?.reward?.type === "item" ? source.reward.value ?? source.reward.title : null;
    if (oldKind) {
      let stripped = false;
      const cleaned = scenes.map((scene) => {
        if (!scene.requiresItems?.includes(oldKind)) return scene;
        stripped = true;
        return {
          ...scene,
          requiresItems: scene.requiresItems.filter((k) => k !== oldKind),
        };
      });
      if (stripped) {
        warnings.push(
          `已移除其他场景对物品「${oldKind}」的门控：该物品不再由本游戏包产出`,
        );
      }
      return { game: { ...game, scenes: cleaned }, warnings };
    }
  }
  return { game: { ...game, scenes }, warnings };
}
