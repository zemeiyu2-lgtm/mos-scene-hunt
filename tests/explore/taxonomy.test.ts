/**
 * Taxonomy guards.
 *
 * The three categories are a product decision, not data. These tests keep the
 * set closed (a fourth category must be a deliberate edit), the slugs stable
 * (they are URLs) and unknown input honestly `null` instead of a silent fallback
 * into some "other" bucket.
 */

import { describe, expect, it } from "vitest";
import {
  EXPLORE_CATEGORIES,
  categoryBySlug,
  isExploreCategorySlug,
} from "@/lib/explore/taxonomy";

describe("探索分类", () => {
  it("恰好三个一级分类，顺序与命名固定", () => {
    expect(EXPLORE_CATEGORIES.map((c) => c.slug)).toEqual([
      "culture-history",
      "nature-outdoor",
      "place-activity",
    ]);
    expect(EXPLORE_CATEGORIES.map((c) => c.label)).toEqual([
      "文化与历史",
      "自然与户外",
      "地点与活动",
    ]);
  });

  it("每个分类都有可读的说明与视觉标识", () => {
    for (const category of EXPLORE_CATEGORIES) {
      expect(category.blurb.length).toBeGreaterThan(4);
      expect(category.intro.length).toBeGreaterThan(10);
      expect(category.glyph.length).toBeGreaterThan(0);
      expect(category.accentVar.startsWith("var(--")).toBe(true);
    }
  });

  it("未知 slug 返回 null，不静默归类", () => {
    expect(categoryBySlug("other")).toBeNull();
    expect(categoryBySlug("")).toBeNull();
    expect(categoryBySlug(null)).toBeNull();
    expect(categoryBySlug(undefined)).toBeNull();
  });

  it("类型守卫只接受三个已知 slug", () => {
    expect(isExploreCategorySlug("culture-history")).toBe(true);
    expect(isExploreCategorySlug("place-activity")).toBe(true);
    expect(isExploreCategorySlug("Place-Activity")).toBe(false);
    expect(isExploreCategorySlug(3)).toBe(false);
  });
});
