"use client";

/**
 * Shared discovery surface for `/explore` and every category page.
 *
 * One component, three configurations — the spec's "统一页面框架" made literal:
 * the category only changes the heading, the blurb and the filter that is
 * applied. Filters are derived from the packs on screen, so a chip can never
 * offer a value that yields zero rows on its own.
 *
 * Sorting: "精选" is an editorial ordering over the same public set (featured
 * first, then newest), never a separate hand-picked list that could drift out of
 * sync with what is actually published.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { PackCard } from "./pack-card";
import { loadExplorePacks, categoryHref, type ExploreError } from "@/lib/explore/client";
import {
  availableCities,
  availableTags,
  packsInCategory,
  sortPacks,
  type ExplorePack,
  type ExploreSort,
} from "@/lib/explore/summary";
import type { ExploreCategory, ExploreCategorySlug } from "@/lib/explore/taxonomy";

export function ExploreDiscovery({ category }: { category?: ExploreCategory }) {
  const [packs, setPacks] = useState<ExplorePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ExploreError | null>(null);
  const [sort, setSort] = useState<ExploreSort>("featured");
  const [tag, setTag] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);

  const load = useCallback(
    (fresh = false) => {
      setLoading(true);
      setError(null);
      void loadExplorePacks({ fresh }).then((result) => {
        if (result.ok) setPacks(result.packs);
        else setError(result.error);
        setLoading(false);
      });
    },
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const scoped = useMemo(
    () => (category ? packsInCategory(packs, category.slug) : packs),
    [packs, category],
  );
  const tags = useMemo(() => availableTags(scoped), [scoped]);
  const cities = useMemo(() => availableCities(scoped), [scoped]);

  const visible = useMemo(() => {
    const filtered = scoped.filter(
      (pack) => (!tag || pack.tags.includes(tag)) && (!cityId || pack.city?.cityId === cityId),
    );
    return sortPacks(filtered, sort);
  }, [scoped, tag, cityId, sort]);

  const hasFilters = Boolean(tag || cityId);
  const clearFilters = () => {
    setTag(null);
    setCityId(null);
  };

  return (
    <div>
      {loading ? <LoadingState label="正在读取探索内容…" /> : null}

      {!loading && error ? (
        <ErrorState
          title="暂时无法读取探索内容"
          detail={error.message}
          onRetry={() => load(true)}
        />
      ) : null}

      {!loading && !error ? (
        <>
          <p className="text-[12px] text-[var(--muted)]">
            {scoped.length > 0
              ? `目前有 ${scoped.length} 个公开探索包${category ? "属于这个分类" : ""}`
              : category
                ? "这个分类目前还没有公开探索包"
                : "目前还没有公开探索包"}
          </p>

          {scoped.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className={`chip ${sort === "featured" ? "border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-deep)]" : "bg-[var(--surface)]"}`}
                onClick={() => setSort("featured")}
                aria-pressed={sort === "featured"}
              >
                精选优先
              </button>
              <button
                type="button"
                className={`chip ${sort === "latest" ? "border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-deep)]" : "bg-[var(--surface)]"}`}
                onClick={() => setSort("latest")}
                aria-pressed={sort === "latest"}
              >
                最新发布
              </button>
            </div>
          ) : null}

          {tags.length > 1 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {tags.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  className={`chip ${tag === item.tag ? "border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-deep)]" : "bg-[var(--surface)] text-[var(--muted)]"}`}
                  onClick={() => setTag(tag === item.tag ? null : item.tag)}
                  aria-pressed={tag === item.tag}
                >
                  {item.tag}
                </button>
              ))}
            </div>
          ) : null}

          {cities.length > 1 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {cities.map((city) => (
                <button
                  key={city.cityId}
                  type="button"
                  className={`chip ${cityId === city.cityId ? "border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-deep)]" : "bg-[var(--surface)] text-[var(--muted)]"}`}
                  onClick={() => setCityId(cityId === city.cityId ? null : city.cityId)}
                  aria-pressed={cityId === city.cityId}
                >
                  {city.name}
                </button>
              ))}
            </div>
          ) : null}

          {visible.length > 0 ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {visible.map((pack) => (
                <li key={pack.gameId}>
                  <PackCard pack={pack} showCategory={!category} />
                </li>
              ))}
            </ul>
          ) : scoped.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title={category ? "这个分类还没有公开内容" : "还没有公开的探索包"}
                hint={
                  category
                    ? "分类不会凭空生成内容：只有在创作者发布并归入这个分类后，这里才会出现探索包。"
                    : "探索包由创作者发布后出现在这里；你也可以先看看其他分类。"
                }
                actions={
                  <>
                    <Link href="/explore" className="btn btn-secondary min-h-11 px-4 text-center text-sm">
                      浏览全部探索
                    </Link>
                    <Link href="/games" className="btn btn-ghost min-h-11 px-4 text-center text-sm">
                      返回探索中心
                    </Link>
                  </>
                }
              />
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                title="没有符合当前筛选的探索"
                hint="换一个标签，或清除筛选看看全部内容。"
                actions={
                  <button type="button" className="btn btn-secondary min-h-11 px-4 text-sm" onClick={clearFilters}>
                    清除筛选
                  </button>
                }
              />
            </div>
          )}

          {hasFilters ? (
            <p className="mt-3 text-center text-[12px] text-[var(--muted)]">
              正在按筛选显示 {visible.length} / {scoped.length} 个探索包
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Category tiles used by the centre and by the all-content page. */
export function CategoryTiles({
  counts,
  categories,
}: {
  counts: Partial<Record<ExploreCategorySlug, number>>;
  categories: ReadonlyArray<ExploreCategory>;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {categories.map((category) => {
        const count = counts[category.slug] ?? 0;
        return (
          <li key={category.slug}>
            <Link
              href={categoryHref(category.slug)}
              className="card flex h-full items-start gap-3 p-4 transition-shadow hover:shadow-card"
            >
              <span className="text-[22px] leading-none" style={{ color: category.accentVar }} aria-hidden>
                {category.glyph}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold">{category.label}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--muted)]">
                  {category.blurb}
                </span>
                <span className="mt-1 block text-[12px] text-[var(--muted)]">
                  {count > 0 ? `${count} 个探索包` : "暂无公开内容"}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
