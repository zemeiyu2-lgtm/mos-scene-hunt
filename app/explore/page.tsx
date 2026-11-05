"use client";

/**
 * 全部探索 — the "发现探索" destination.
 *
 * Same list component as a category page, without the category filter, plus the
 * three category tiles so a visitor who arrived from the centre can still see
 * the whole map of the catalogue.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Screen } from "@/components/ui";
import { CategoryTiles, ExploreDiscovery } from "@/components/explore/discovery";
import { loadExplorePacks } from "@/lib/explore/client";
import { EXPLORE_CATEGORIES, type ExploreCategorySlug } from "@/lib/explore/taxonomy";

export default function ExplorePage() {
  const [counts, setCounts] = useState<Partial<Record<ExploreCategorySlug, number>>>({});

  useEffect(() => {
    void loadExplorePacks().then((result) => {
      if (!result.ok) return;
      const next: Partial<Record<ExploreCategorySlug, number>> = {};
      for (const entry of result.categories) next[entry.slug] = entry.count;
      setCounts(next);
    });
  }, []);

  return (
    <Screen
      title="探索"
      subtitle="按兴趣分类，或从城市开始"
      headerRight={
        <Link href="/games" className="btn btn-ghost min-h-9 px-2 text-sm">
          返回
        </Link>
      }
    >
      <section aria-labelledby="cat-title">
        <h2 id="cat-title" className="text-[15px] font-bold">
          三个方向
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
          分类描述的是内容，不限制玩法。一个探索包只属于一个主要分类。
        </p>
        <div className="mt-3">
          <CategoryTiles counts={counts} categories={EXPLORE_CATEGORIES} />
        </div>
      </section>

      <section className="mt-5" aria-labelledby="all-title">
        <h2 id="all-title" className="text-[15px] font-bold">
          全部公开探索
        </h2>
        <div className="mt-2">
          <ExploreDiscovery />
        </div>
      </section>
    </Screen>
  );
}
