/**
 * Server-side read model for the exploration pages.
 *
 * The public read path is exactly the one already used by `/api/games/<id>`:
 * a work must be `state === "published"` and carry a `publishedVersionId`.
 * This module adds nothing to that gate — it only turns the bytes into the view
 * model the pages need, and it never reads a version that the public endpoint
 * would refuse.
 *
 * Failure policy: listing is best-effort per pack (a broken pack is skipped, the
 * rest still list); detail is strict (`null` -> 404). That matches the existing
 * catalogue route, where an unreachable registry degrades to a smaller catalogue
 * instead of taking the first screen down.
 */

import { getRegistry } from "@/lib/registry/store";
import { getStore } from "@/lib/publish/storage";
import { getCityStore } from "@/lib/cities/store";
import { annotationFor } from "./annotations";
import { summarizePack, type ExplorePack } from "./summary";
import type { ExploreCategorySlug } from "./taxonomy";

async function resolveCityName(cityId: string): Promise<string | null> {
  try {
    const profile = await getCityStore().getCity(cityId);
    return profile?.cityName ?? null;
  } catch {
    // A city read failure must not hide the pack: the city is a label here,
    // not a permission.
    return null;
  }
}

function parsePack(bytes: string | null): unknown | null {
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes);
  } catch {
    return null;
  }
}

/**
 * Every publicly readable pack, newest first.
 *
 * `unlisted` is excluded on purpose: those works stay reachable by direct link
 * (the `?v=` route) but are not advertised — the same rule the catalogue uses.
 */
export async function listPublicExplorePacks(): Promise<ExplorePack[]> {
  const works = await getRegistry().listWorks();
  const published = works.filter((work) => work.state === "published" && work.publishedVersionId);

  const results = await Promise.all(
    published.map(async (work): Promise<ExplorePack | null> => {
      try {
        const bytes = await getStore().readVersion(work.gameId, work.publishedVersionId as string);
        const raw = parsePack(bytes);
        if (raw === null) return null;
        const cityName = work.cityId ? await resolveCityName(work.cityId) : null;
        return summarizePack(
          raw,
          {
            gameId: work.gameId,
            updatedAt: work.updatedAt,
            cityId: work.cityId ?? null,
            cityName,
          },
          annotationFor(work.gameId),
        );
      } catch (error) {
        console.error(`[explore] 读取已发布探索包失败 ${work.gameId}`, error);
        return null;
      }
    }),
  );

  return results.filter((pack): pack is ExplorePack => pack !== null);
}

/** One publicly readable pack, or `null` (which the route turns into a 404). */
export async function getPublicExplorePack(gameId: string): Promise<ExplorePack | null> {
  const work = await getRegistry().getWork(gameId);
  if (!work || work.state !== "published" || !work.publishedVersionId) return null;

  const bytes = await getStore().readVersion(gameId, work.publishedVersionId);
  const raw = parsePack(bytes);
  if (raw === null) return null;

  const cityName = work.cityId ? await resolveCityName(work.cityId) : null;
  return summarizePack(
    raw,
    { gameId: work.gameId, updatedAt: work.updatedAt, cityId: work.cityId ?? null, cityName },
    annotationFor(work.gameId),
  );
}

/** Real per-category counts, computed from the packs that are actually public. */
export function categoryCounts(
  packs: ExplorePack[],
): Array<{ slug: ExploreCategorySlug; count: number }> {
  const counts = new Map<ExploreCategorySlug, number>();
  for (const pack of packs) {
    if (!pack.category) continue;
    counts.set(pack.category, (counts.get(pack.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([slug, count]) => ({ slug, count }));
}
