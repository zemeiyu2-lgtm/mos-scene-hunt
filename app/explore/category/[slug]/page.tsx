"use client";

/**
 * 分类发现页 — one component, three skins.
 *
 * `/explore/category/<slug>` renders the shared discovery surface with the
 * category applied. An unknown slug is a calm "no such category" page with a way
 * back, not a 404: stale links to a category that once existed are a normal thing
 * on the web.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, Screen } from "@/components/ui";
import { ExploreDiscovery } from "@/components/explore/discovery";
import { categoryBySlug } from "@/lib/explore/taxonomy";

export default function ExploreCategoryPage() {
  const params = useParams<{ slug: string }>();
  const category = categoryBySlug(typeof params?.slug === "string" ? params.slug : "");

  if (!category) {
    return (
      <Screen title="分类" headerRight={<Link href="/explore" className="btn btn-ghost min-h-9 px-2 text-sm">返回</Link>}>
        <EmptyState
          title="没有这个分类"
          hint="探索内容只有三个分类：文化与历史、自然与户外、地点与活动。"
          actions={
            <Link href="/explore" className="btn btn-secondary min-h-11 px-4 text-center text-sm">
              浏览全部探索
            </Link>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={category.label}
      subtitle={`${category.glyph} ${category.blurb}`}
      headerRight={
        <Link href="/explore" className="btn btn-ghost min-h-9 px-2 text-sm">
          返回
        </Link>
      }
    >
      <p className="text-[13px] leading-relaxed text-[var(--muted)]">{category.intro}</p>
      <div className="mt-4">
        <ExploreDiscovery category={category} />
      </div>
      <div className="mt-5 grid gap-2">
        <Link href="/explore" className="btn btn-ghost btn-block">
          看看其他分类
        </Link>
      </div>
    </Screen>
  );
}
