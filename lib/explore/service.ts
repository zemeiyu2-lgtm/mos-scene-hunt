/**
 * Server-side read model for the exploration pages.
 *
 * WHAT THIS MODULE READS, AND WHY IT IS THE ONLY SAFE SOURCE
 *
 * The production baseline publishes through two public surfaces:
 *
 *   1. `app/content/cloud/catalog.json/route.ts` — the catalogue, whose entries
 *      carry `status`; `lib/cloud.publishedGames()` is what `/games` lists.
 *   2. `app/content/[file]/route.ts` — one pack file from `content/`, with the
 *      id rule `/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/` and `..` rejected.
 *
 * This module reads only catalogue entries whose status is exactly
 * "published". Static legacy packs come from content/; versioned Philippine
 * packs are read by their exact immutable versionId from the same Blob store
 * as /api/games. Draft, unlisted, archived and unknown ids remain invisible.
 *
 * The ten Philippine entries reference versions that were already published.
 * This release changes discovery metadata only: it does not republish, overwrite
 * or mutate any pack bytes. Future POST /api/publish writes still require an
 * explicit catalogue release before they appear in discovery.
 *
 * Failure policy: listing is best-effort per pack (a broken pack is skipped, the
 * rest still list); detail is strict (`null` -> 404). Same as the catalogue,
 * where an unreadable entry degrades to a smaller catalogue instead of taking
 * the first screen down.
 *
 * NO CITY ARCHIVES. The exploration design requires that a city exists only
 * because a real, publicly readable pack is tied to it. The production pack
 * schema has no city field and production has no city store, so this module
 * derives the city label from the pack and nothing else: no entry here can
 * create, resurrect or persist a city archive, and no browse/search/list action
 * writes anything at all.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@/lib/publish/storage";
import { isValidGameId, isValidVersionId } from "@/lib/publish/version";
import { CLOUD_CATALOG } from "@/lib/cloud/catalog";
import type { CloudCatalog, CloudGameEntry } from "@/lib/cloud";
import { annotationFor } from "./annotations";
import { summarizePack, type ExplorePack } from "./summary";
import type { ExploreCategorySlug } from "./taxonomy";

/**
 * Same rule the public content route enforces. Duplicated on purpose: this
 * module must not become an escape hatch if that route's rule changes, and it
 * runs before a path is ever joined.
 */
const SAFE_PACK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

const CONTENT_DIR = path.join(process.cwd(), "content");

export interface ExploreSource {
  catalog: CloudCatalog;
  /** Raw pack text for a validated file name, or `null` when it is absent. */
  readPackFile(file: string, versionId?: string): Promise<string | null>;
}

async function readFromContentDir(file: string): Promise<string | null> {
  if (!SAFE_PACK_FILE.test(file) || file.includes("..")) return null;
  try {
    return await readFile(path.join(CONTENT_DIR, file), "utf8");
  } catch {
    return null;
  }
}

/** Read an exact immutable published version from the same store as /api/games. */
async function readPublishedVersion(file: string, versionId: string): Promise<string | null> {
  if (!SAFE_PACK_FILE.test(file) || file.includes("..")) return null;
  const gameId = file.slice(0, -5);
  if (!isValidGameId(gameId) || !isValidVersionId(versionId)) return null;
  try {
    return await getStore().readVersion(gameId, versionId);
  } catch {
    return null;
  }
}

/** Production source: the shipping catalogue plus immutable published versions. */
export function productionSource(): ExploreSource {
  return {
    catalog: CLOUD_CATALOG,
    readPackFile: (file, versionId) =>
      versionId && process.env.PUBLISHED_GAMES_STORE?.trim().toLowerCase() === "blob"
        ? readPublishedVersion(file, versionId)
        : readFromContentDir(file),
  };
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
 * The catalogue entries the public is allowed to see.
 *
 * Exported because it is the publication gate itself and deserves a direct test:
 * everything that is not exactly `published` is dropped here, before any file is
 * read.
 */
export function publicEntries(catalog: CloudCatalog): CloudGameEntry[] {
  return catalog.games.filter(
    (entry) => entry.status === "published" && SAFE_PACK_FILE.test(entry.packFile.trim()) &&
      (entry.versionId === undefined || isValidVersionId(entry.versionId)),
  );
}

function sourceFor(entry: CloudGameEntry, updatedAt: string, annotation: ReturnType<typeof annotationFor>) {
  return {
    gameId: entry.id,
    updatedAt,
    packFile: entry.packFile.trim(),
    // City attribution is editorial metadata attached only to a real published pack.
    // availableCities() derives the visible city list from these public packs; no empty archive is created.
    cityId: annotation?.cityId ?? null,
    cityName: annotation?.cityName ?? null,
    versionId: entry.versionId ?? null,
  };
}

/** Every publicly readable pack, newest catalogue revision first by publication. */
export async function listPublicExplorePacks(
  source: ExploreSource = productionSource(),
): Promise<ExplorePack[]> {
  const entries = publicEntries(source.catalog);

  const results = await Promise.all(
    entries.map(async (entry): Promise<ExplorePack | null> => {
      try {
        const annotation = annotationFor(entry.id);
        const raw = parsePack(await source.readPackFile(entry.packFile.trim(), entry.versionId));
        if (raw === null) return null;
        return summarizePack(raw, sourceFor(entry, source.catalog.updatedAt, annotation), annotation);
      } catch (error) {
        console.error(`[explore] 读取已发布探索包失败 ${entry.id}`, error);
        return null;
      }
    }),
  );

  return results.filter((pack): pack is ExplorePack => pack !== null);
}

/** One publicly readable pack, or `null` (which the route turns into a 404). */
export async function getPublicExplorePack(
  gameId: string,
  source: ExploreSource = productionSource(),
): Promise<ExplorePack | null> {
  const entry = publicEntries(source.catalog).find((candidate) => candidate.id === gameId);
  if (!entry) return null;

  try {
    const annotation = annotationFor(entry.id);
    const raw = parsePack(await source.readPackFile(entry.packFile.trim(), entry.versionId));
    if (raw === null) return null;
    return summarizePack(raw, sourceFor(entry, source.catalog.updatedAt, annotation), annotation);
  } catch (error) {
    console.error(`[explore] 读取探索包失败 ${gameId}`, error);
    return null;
  }
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
