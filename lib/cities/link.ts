/**
 * Work ↔ city index maintenance.
 *
 * Ordering rule, and the whole consistency model in one sentence: the WORK
 * document is the authority, the LINK document is derived and is written only
 * AFTER the work write has committed. Therefore:
 *
 *  - registry committed, link write failed  → link is stale (missing/mis-flagged),
 *    the game is simply not listed yet; a retry, the next state change, or
 *    `rebuildCityLinks` fixes it — nothing is lost or leaked twice;
 *  - link written, registry write failed    → impossible by construction,
 *    because nothing is written before the work commit succeeds.
 *
 * Readers must still re-check the work state (`listCityPackages` does): a link
 * can claim `visible: true` for a work that has since been withdrawn, and the
 * read path must never list that. Links make discovery fast; works make it
 * TRUE.
 */

import { getRegistry, type RegistryStore } from "../registry/store";
import type { WorkRecord } from "../registry/types";
import { resolveCityRef } from "./resolve";
import { getCityStore, type CityStore } from "./store";
import { CITY_SCHEMA_VERSION, type CityLink } from "./types";

export interface LinkDeps {
  cityStore?: CityStore;
  registry?: RegistryStore;
  now?: string;
}

export type SyncOutcome = "linked" | "hidden" | "cleared" | "no_city" | "failed";

function desiredLink(work: WorkRecord, cityId: string, now: string): CityLink {
  return {
    schemaVersion: CITY_SCHEMA_VERSION,
    gameId: work.gameId,
    cityId,
    title: work.title,
    state: work.state,
    visible: work.state === "published",
    updatedAt: now,
  };
}

/**
 * Write (or clear) the link for one work. Never throws: a failure here must
 * not turn a successful publish into an error for the author. Returns the
 * outcome so callers can audit/retry.
 */
export async function syncWorkCityLink(
  work: WorkRecord,
  deps: LinkDeps = {},
  retries = 2,
): Promise<SyncOutcome> {
  const cityStore = deps.cityStore ?? getCityStore();
  const now = deps.now ?? new Date().toISOString();

  if (!work.cityId) {
    const existing = await cityStore.getLink(work.gameId).catch(() => null);
    if (!existing) return "no_city";
    try {
      await cityStore.deleteLink(work.gameId);
      return "cleared";
    } catch {
      return "failed";
    }
  }

  // Follow a merge pointer so a link never points at a retired profile.
  const resolved = await resolveCityRef(cityStore, work.cityId).catch(() => null);
  if (!resolved) {
    // The profile is missing: do not invent one, do not silently drop the
    // association. Leave the work untouched and let rebuild report it.
    return "failed";
  }

  const entry = desiredLink(work, resolved.city.cityId, now);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await cityStore.putLink(entry);
      if (result.ok) return entry.visible ? "linked" : "hidden";
    } catch {
      /* retry below */
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  return "failed";
}

/* ------------------------------------------------------------------ */
/* Public read path                                                   */
/* ------------------------------------------------------------------ */

export interface CityPackageSummary {
  gameId: string;
  title: string;
  sceneCount: number;
  updatedAt: string;
}

/**
 * Packs publicly listed under one city.
 *
 * Every candidate link is re-validated against the work document, so `unlisted`
 * (link-playable but not discoverable) and `withdrawn` never appear here even
 * if the link document is stale.
 */
export async function listCityPackages(
  cityId: string,
  deps: LinkDeps = {},
): Promise<CityPackageSummary[]> {
  const cityStore = deps.cityStore ?? getCityStore();
  const registry = deps.registry ?? getRegistry();

  const resolved = await resolveCityRef(cityStore, cityId);
  if (!resolved) return [];
  const canonical = resolved.city.cityId;

  const links = await cityStore.listLinks();
  const out: CityPackageSummary[] = [];
  for (const entry of links) {
    // A link written before a merge still carries the retired id; resolve it
    // rather than dropping a still-published pack from the survivor's list.
    let linkCityId = entry.cityId;
    if (linkCityId !== canonical) {
      const linkResolved = await resolveCityRef(cityStore, linkCityId).catch(() => null);
      if (!linkResolved) continue;
      linkCityId = linkResolved.city.cityId;
      if (linkCityId !== canonical) continue;
    }
    const work = await registry.getWork(entry.gameId);
    if (!work) continue;
    if (work.state !== "published") continue;
    if (work.cityId && work.cityId !== canonical) {
      // Work was moved to another city after the link was written; the link is
      // stale, the work wins.
      continue;
    }
    const version = work.versions.find((v) => v.versionId === work.publishedVersionId);
    out.push({
      gameId: work.gameId,
      title: work.title,
      sceneCount: version?.sceneCount ?? 0,
      updatedAt: work.updatedAt,
    });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/* ------------------------------------------------------------------ */
/* Rebuild / repair                                                   */
/* ------------------------------------------------------------------ */

export interface RebuildReport {
  scanned: number;
  written: number;
  unchanged: number;
  deleted: number;
  /** Works whose cityId has no profile at all (needs a human decision). */
  missingCity: Array<{ gameId: string; cityId: string }>;
  /** Links that survived the rebuild but could not be written. */
  failed: Array<{ gameId: string; reason: string }>;
  dryRun: boolean;
}

/**
 * Rebuild the derived city index from the authoritative work documents.
 *
 * Safe to run repeatedly (idempotent by key), and the ONLY repair path needed:
 * every inconsistency class above converges here. It is a maintenance tool —
 * not wired to any production route, and not run against production data in
 * this batch.
 */
export async function rebuildCityLinks(deps: LinkDeps & { dryRun?: boolean } = {}): Promise<RebuildReport> {
  const cityStore = deps.cityStore ?? getCityStore();
  const registry = deps.registry ?? getRegistry();
  const now = deps.now ?? new Date().toISOString();
  const dryRun = deps.dryRun ?? false;

  const works = await registry.listWorks();
  const existing = new Map<string, CityLink>();
  for (const entry of await cityStore.listLinks()) existing.set(entry.gameId, entry);

  const report: RebuildReport = {
    scanned: works.length,
    written: 0,
    unchanged: 0,
    deleted: 0,
    missingCity: [],
    failed: [],
    dryRun,
  };

  const knownWorks = new Set<string>();

  for (const work of works) {
    knownWorks.add(work.gameId);
    const current = existing.get(work.gameId);

    if (!work.cityId) {
      if (!current) continue;
      if (!dryRun) {
        try {
          await cityStore.deleteLink(work.gameId);
          report.deleted += 1;
        } catch (error) {
          report.failed.push({ gameId: work.gameId, reason: String(error) });
        }
      } else {
        report.deleted += 1;
      }
      continue;
    }

    const resolved = await resolveCityRef(cityStore, work.cityId);
    if (!resolved) {
      report.missingCity.push({ gameId: work.gameId, cityId: work.cityId });
      continue;
    }

    const wanted = desiredLink(work, resolved.city.cityId, now);
    const same =
      current &&
      current.cityId === wanted.cityId &&
      current.visible === wanted.visible &&
      current.state === wanted.state &&
      current.title === wanted.title;
    if (same) {
      report.unchanged += 1;
      continue;
    }
    if (dryRun) {
      report.written += 1;
      continue;
    }
    try {
      await cityStore.putLink(wanted);
      report.written += 1;
    } catch (error) {
      report.failed.push({ gameId: work.gameId, reason: String(error) });
    }
  }

  // Links whose work no longer exists are orphans: remove them.
  for (const gameId of existing.keys()) {
    if (knownWorks.has(gameId)) continue;
    if (!dryRun) {
      try {
        await cityStore.deleteLink(gameId);
        report.deleted += 1;
      } catch (error) {
        report.failed.push({ gameId, reason: String(error) });
      }
    } else {
      report.deleted += 1;
    }
  }

  return report;
}
