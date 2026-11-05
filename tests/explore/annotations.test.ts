/**
 * Editorial annotation guard.
 *
 * An annotation may add framing — category, tags, audience, preparation, safety —
 * and must never add a fact the pack owns. It also may not annotate content that
 * is not publicly readable: an entry for a draft or a non-existent id would be
 * copy nobody can see, or worse, a hint that unpublished ids exist.
 */

import { describe, expect, it } from "vitest";
import { PACK_ANNOTATIONS, annotationFor } from "@/lib/explore/annotations";
import { CLOUD_CATALOG } from "@/lib/cloud/catalog";
import { EXPLORE_CATEGORIES } from "@/lib/explore/taxonomy";

const publishedIds = CLOUD_CATALOG.games
  .filter((game) => game.status === "published")
  .map((game) => game.id);

const CATEGORY_SLUGS = EXPLORE_CATEGORIES.map((category) => category.slug);

describe("编辑标注 — 只标注真实公开内容", () => {
  it("每一条标注都对应一个已发布的内容包", () => {
    for (const gameId of Object.keys(PACK_ANNOTATIONS)) {
      expect(publishedIds).toContain(gameId);
    }
  });

  it("未知 id 没有标注", () => {
    expect(annotationFor("not-a-real-pack")).toBeNull();
    expect(annotationFor("")).toBeNull();
  });

  it("分类只能是三个一级分类之一", () => {
    for (const annotation of Object.values(PACK_ANNOTATIONS)) {
      if (annotation.category) expect(CATEGORY_SLUGS).toContain(annotation.category);
    }
  });
});

describe("编辑标注 — 不加数字、不加社会证明", () => {
  const strings = Object.values(PACK_ANNOTATIONS).flatMap((annotation) =>
    [
      annotation.tagline,
      annotation.audience,
      annotation.teamMode,
      ...(annotation.tags ?? []),
      ...(annotation.goals ?? []),
      ...(annotation.preparations ?? []),
      ...(annotation.safety ?? []),
    ].filter((value): value is string => typeof value === "string"),
  );

  it("不重复时长、距离、站点数一类包内事实", () => {
    for (const text of strings) {
      expect(text).not.toMatch(/分钟|小时|公里|km|米|站点数/);
    }
  });

  it("不编造评分、参与人数、排名一类社会证明", () => {
    for (const text of strings) {
      expect(text).not.toMatch(/评分|星级|好评|人次|参与者|人参加|排名第|热门第/);
    }
  });

  it("标注对象里不存在数值型事实字段", () => {
    for (const annotation of Object.values(PACK_ANNOTATIONS)) {
      for (const forbidden of ["minutes", "sceneCount", "difficulty", "areaMeters", "rating"]) {
        expect(Object.keys(annotation)).not.toContain(forbidden);
      }
    }
  });
});
