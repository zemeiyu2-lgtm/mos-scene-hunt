/**
 * Exploration taxonomy — the three top-level content categories.
 *
 * Why a fixed, in-code taxonomy instead of a database table: the platform has
 * exactly three first-level categories and the product spec forbids inventing
 * more. Keeping them here means the labels, the copy and the URLs cannot drift
 * between the centre, the category page and the detail page, and a typo in a
 * slug becomes a TypeScript error instead of a 404.
 *
 * A category is DESCRIPTIVE, never a gate: it does not restrict gameplay, and a
 * pack without a category is still fully playable — it simply does not appear
 * on a category page. Absence is represented as `null` everywhere, not as a
 * "misc" bucket, so no page ever has to pretend it knows something it does not.
 */

export type ExploreCategorySlug = "culture-history" | "nature-outdoor" | "place-activity";

export interface ExploreCategory {
  slug: ExploreCategorySlug;
  /** Short label used in navigation and chips. */
  label: string;
  /** One line used under the label on the tiles. */
  blurb: string;
  /** Longer introduction used at the top of the category page. */
  intro: string;
  /** Decorative glyph — text, not an emoji, so it inherits the text colour. */
  glyph: string;
  /** CSS custom property used for the accent of this category. */
  accentVar: string;
}

export const EXPLORE_CATEGORIES: readonly ExploreCategory[] = [
  {
    slug: "culture-history",
    label: "文化与历史",
    blurb: "城市历史、建筑、人物与地方传统",
    intro:
      "从一栋建筑、一条街、一个人物开始，理解一个地方为什么是现在的样子。这类探索以观察和阅读为主，脚步可以很慢。",
    glyph: "◈",
    accentVar: "var(--hero-gold)",
  },
  {
    slug: "nature-outdoor",
    label: "自然与户外",
    blurb: "山海、公园、生态与地理观察",
    intro:
      "把注意力放回自然：树木、地形、水岸、天空。这类探索通常在户外展开，需要一点体力和对天气的耐心。",
    glyph: "❖",
    accentVar: "var(--ok-solid)",
  },
  {
    slug: "place-activity",
    label: "地点与活动",
    blurb: "校园、景区、社区与组织者设计的互动",
    intro:
      "为某个具体场所设计的互动体验：校园、景区、社区或一场有组织的活动。路线由组织者安排，参与者按站点完成。",
    glyph: "◎",
    accentVar: "var(--nav-blue)",
  },
] as const;

const BY_SLUG = new Map<string, ExploreCategory>(EXPLORE_CATEGORIES.map((c) => [c.slug, c]));

/** Strict lookup: unknown slugs are `null`, never a silent fallback. */
export function categoryBySlug(slug: string | null | undefined): ExploreCategory | null {
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

export function isExploreCategorySlug(value: unknown): value is ExploreCategorySlug {
  return typeof value === "string" && BY_SLUG.has(value);
}
