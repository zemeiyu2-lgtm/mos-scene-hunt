import { NextResponse } from "next/server";
import { publishedCatalogEntries } from "@/lib/registry/service";

/**
 * Cloud game catalogue.
 *
 * Historically this was a hardcoded constant, which meant an admin-published
 * pack never appeared in `/games` — the publish flow and the player-facing
 * catalogue were never connected. It now merges:
 *
 *  1. the curated, repo-shipped packs (always available, needs no credentials);
 *  2. every registry work whose state is exactly `published`.
 *
 * Part 2 is best-effort on purpose: if the registry is unreachable or has no
 * credentials, part 1 must still serve. A catalogue read failure degrades to a
 * smaller catalogue instead of a 500, because `/games` is the first screen a
 * new player opens.
 *
 * `unlisted` works are excluded here by design — they are reachable by direct
 * link but must not be advertised.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shape both catalogue sources must satisfy. Optional fields stay optional. */
interface CatalogGame {
  id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  estimatedMinutes?: number;
  difficulty?: string;
  sceneCount: number;
  status: string;
  packFile: string;
  source: string;
}

const repoCatalog = {
  version: "1.2",
  updatedAt: "2026-10-29",
  games: [
    {
      id: "rizal-park-discovery",
      title: "黎刹公园：寻找最后的宝藏",
      author: "MOS Scene Hunt · 官方母版",
      description: "观察、图片线索、团队挑战与最终宝藏兑现的轻量户外寻宝示范。坐标需由设计者现场确认。",
      language: "zh-CN",
      estimatedMinutes: 25,
      difficulty: "easy",
      sceneCount: 5,
      status: "published",
      packFile: "rizal-park-discovery.json",
      source: "repo",
    },
  ],
};

export async function GET(): Promise<NextResponse> {
  const games: CatalogGame[] = [...repoCatalog.games];
  let updatedAt = repoCatalog.updatedAt;

  try {
    const published = await publishedCatalogEntries();
    const known = new Set(games.map((g) => g.id));
    for (const entry of published) {
      if (known.has(entry.id)) continue;
      games.push({
        id: entry.id,
        title: entry.title,
        author: entry.author,
        description: entry.description,
        language: entry.language,
        sceneCount: entry.sceneCount,
        status: entry.status,
        // Empty on purpose: the bytes are not read from disk but served by the
        // review-aware read endpoint (see `packUrl` for source === "registry").
        packFile: "",
        source: "registry",
      });
      if (entry.updatedAt > updatedAt) updatedAt = entry.updatedAt;
    }
  } catch (error) {
    // See file header: a broken registry must not take the catalogue down.
    console.error("[catalog] 已发布作品读取失败，仅返回内置目录", error);
  }

  return NextResponse.json(
    { version: repoCatalog.version, updatedAt, games },
    {
      headers: {
        // Registry-driven now, so it must not be cached for as long as before.
        "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      },
    },
  );
}
