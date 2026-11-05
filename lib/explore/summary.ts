/**
 * Pack -> view model.
 *
 * Pure on purpose: no network, no storage, no React. The server route feeds it
 * the published pack JSON; the tests feed it fixtures. Everything the pages show
 * about a pack is derived here, so "where did this number come from?" always has
 * exactly one answer.
 *
 * The rule the whole file follows: **derive or omit**. A field that the pack does
 * not actually carry (a cover image, a rating, a participant count) is not
 * synthesised — it is left out and the UI hides that slot. Only the editorial
 * annotation may add framing copy, and it can never add numbers.
 */

import { categoryBySlug, type ExploreCategorySlug } from "./taxonomy";
import type { PackAnnotation } from "./annotations";

export type ExploreDifficulty = "easy" | "medium" | "hard";

export interface ExploreChallengeMix {
  type: string;
  count: number;
}

export interface ExploreRewardMix {
  type: string;
  count: number;
}

export interface ExplorePack {
  gameId: string;
  title: string;
  /** One sentence. Annotation first, otherwise the pack's first sentence. */
  tagline: string | null;
  /** The pack's own description, unedited. */
  description: string;
  language: string;
  author: string | null;
  category: ExploreCategorySlug | null;
  tags: string[];
  city: { cityId: string; name: string | null } | null;
  /** Named meeting point, when the pack declares one. */
  place: string | null;
  /** Radius of the exploration area in metres, when declared. */
  areaMeters: number | null;
  sceneCount: number;
  minutes: number | null;
  difficulty: ExploreDifficulty | null;
  audience: string | null;
  teamMode: string | null;
  goals: string[];
  preparations: string[];
  safety: string[];
  challengeMix: ExploreChallengeMix[];
  rewardMix: ExploreRewardMix[];
  featured: boolean;
  featuredRank: number;
  updatedAt: string;
  /** Coarse start point for a static map preview; never used for gameplay. */
  startPoint: { lat: number; lng: number } | null;
}

export interface PackSource {
  gameId: string;
  updatedAt: string;
  cityId?: string | null;
  cityName?: string | null;
}

const DIFFICULTIES: readonly ExploreDifficulty[] = ["easy", "medium", "hard"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => nonEmptyString(item))
    .filter((item): item is string => item !== null)
    .slice(0, limit);
}

/** First sentence, used when no editorial tagline exists. Never invents one. */
export function firstSentence(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^[^。！？!?]+[。！？!?]?/);
  const sentence = (match?.[0] ?? trimmed).trim();
  return sentence.length > 0 ? sentence : null;
}

function countBy(items: unknown[], pick: (item: Record<string, unknown>) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const record = asRecord(item);
    if (!record) continue;
    const key = pick(record);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Build the view model, or `null` when the payload is not a usable pack.
 *
 * `null` is a real answer: the detail route turns it into a 404, the list drops
 * the row. Rendering a half-empty card would be worse than not rendering it.
 */
export function summarizePack(
  raw: unknown,
  source: PackSource,
  annotation: PackAnnotation | null,
): ExplorePack | null {
  const pack = asRecord(raw);
  if (!pack) return null;

  const gameId = nonEmptyString(pack.id) ?? source.gameId;
  const title = nonEmptyString(pack.title);
  if (!title) return null;

  const scenes = Array.isArray(pack.scenes) ? pack.scenes : [];
  if (scenes.length === 0) return null;

  const description = nonEmptyString(pack.description) ?? "";
  const category = annotation?.category && categoryBySlug(annotation.category) ? annotation.category : null;

  const start = asRecord(pack.startLocation);
  const startLat = finiteNumber(start?.lat);
  const startLng = finiteNumber(start?.lng);

  const huntArea = asRecord(pack.huntArea);
  const areaMetersRaw = finiteNumber(huntArea?.radiusMeters);
  const areaMeters = areaMetersRaw !== null && areaMetersRaw > 0 ? Math.round(areaMetersRaw) : null;

  const minutesRaw = finiteNumber(pack.estimatedMinutes);
  const minutes =
    minutesRaw !== null && minutesRaw > 0 && minutesRaw <= 600 ? Math.round(minutesRaw) : null;

  const difficulty =
    typeof pack.difficulty === "string" && (DIFFICULTIES as readonly string[]).includes(pack.difficulty)
      ? (pack.difficulty as ExploreDifficulty)
      : null;

  return {
    gameId,
    title,
    tagline: nonEmptyString(annotation?.tagline) ?? firstSentence(description),
    description,
    language: nonEmptyString(pack.language) ?? "zh-CN",
    author: nonEmptyString(pack.author),
    category,
    tags: stringList(annotation?.tags, 6),
    city: source.cityId
      ? { cityId: source.cityId, name: nonEmptyString(source.cityName) }
      : null,
    place: nonEmptyString(start?.name),
    areaMeters,
    sceneCount: scenes.length,
    minutes,
    difficulty,
    audience: nonEmptyString(annotation?.audience),
    teamMode: nonEmptyString(annotation?.teamMode),
    goals: stringList(annotation?.goals, 4),
    preparations: stringList(annotation?.preparations, 4),
    safety: stringList(annotation?.safety, 4),
    challengeMix: countBy(scenes, (scene) => {
      const challenge = asRecord(scene.challenge);
      return challenge ? nonEmptyString(challenge.type) : null;
    }),
    rewardMix: countBy(scenes, (scene) => {
      const reward = asRecord(scene.reward);
      return reward ? nonEmptyString(reward.type) : null;
    }),
    featured: annotation?.featured === true,
    featuredRank:
      typeof annotation?.featuredRank === "number" && Number.isFinite(annotation.featuredRank)
        ? annotation.featuredRank
        : 1000,
    updatedAt: source.updatedAt,
    startPoint:
      startLat !== null && startLng !== null ? { lat: startLat, lng: startLng } : null,
  };
}

export const DIFFICULTY_LABEL: Record<ExploreDifficulty, string> = {
  easy: "轻松",
  medium: "标准",
  hard: "进阶",
};

export const CHALLENGE_LABEL: Record<string, string> = {
  choice: "选择题",
  keyword: "关键词题",
  text: "简答题",
};

export const REWARD_LABEL: Record<string, string> = {
  keyword: "关键词",
  item: "道具",
  badge: "徽章",
  story: "故事",
};

export function difficultyLabel(value: ExploreDifficulty | null): string | null {
  return value ? DIFFICULTY_LABEL[value] : null;
}

/** Human-readable duration. Null when the pack does not declare one. */
export function durationLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `约 ${hours} 小时` : `约 ${hours} 小时 ${rest} 分钟`;
}

export function areaLabel(meters: number | null): string | null {
  if (meters === null) return null;
  if (meters < 1000) return `约 ${meters} m 范围`;
  const km = meters / 1000;
  return `约 ${km.toFixed(km < 10 ? 1 : 0)} km 范围`;
}

/**
 * Ordering for discovery pages.
 *
 * "featured" is an editorial ordering over real packs, not a separate pool:
 * every featured pack is also a normal published pack, and a page can never
 * show a featured item that is not publicly readable.
 */
export type ExploreSort = "featured" | "latest";

export function sortPacks(packs: ExplorePack[], sort: ExploreSort): ExplorePack[] {
  const copy = [...packs];
  if (sort === "featured") {
    copy.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.featured && b.featured && a.featuredRank !== b.featuredRank) {
        return a.featuredRank - b.featuredRank;
      }
      return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
    });
    return copy;
  }
  copy.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return copy;
}

export function packsInCategory(packs: ExplorePack[], slug: ExploreCategorySlug): ExplorePack[] {
  return packs.filter((pack) => pack.category === slug);
}

/** Tags actually present in a set of packs, most frequent first. */
export function availableTags(packs: ExplorePack[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const pack of packs) {
    for (const tag of pack.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Cities actually present in a set of packs. Never includes empty cities. */
export function availableCities(packs: ExplorePack[]): Array<{ cityId: string; name: string; count: number }> {
  const map = new Map<string, { cityId: string; name: string; count: number }>();
  for (const pack of packs) {
    if (!pack.city) continue;
    const existing = map.get(pack.city.cityId);
    if (existing) existing.count += 1;
    else map.set(pack.city.cityId, { cityId: pack.city.cityId, name: pack.city.name ?? pack.city.cityId, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
