"use client";

/**
 * Client access to the exploration catalogue.
 *
 * Mirrors `lib/cities/client.ts`: a discriminated result instead of throwing, so
 * a page can tell "empty" from "broken" without guessing. The cache is
 * deliberately short-lived and keyed by nothing (there is one public catalogue),
 * because the list must reflect a publish within a minute — the same contract the
 * HTTP layer states in its `Cache-Control`.
 */

import type { ExplorePack } from "./summary";
import type { ExploreCategorySlug } from "./taxonomy";

export type ExploreErrorKind = "network" | "server" | "malformed" | "not_found";

export interface ExploreError {
  kind: ExploreErrorKind;
  status: number;
  code: string;
  message: string;
}

export type ExploreListResult =
  | { ok: true; packs: ExplorePack[]; categories: Array<{ slug: ExploreCategorySlug; count: number }> }
  | { ok: false; error: ExploreError };

export type ExplorePackResult = { ok: true; pack: ExplorePack } | { ok: false; error: ExploreError };

const CACHE_TTL_MS = 30_000;

let listCache: { at: number; value: ExploreListResult } | null = null;
let listInFlight: Promise<ExploreListResult> | null = null;

function failure(kind: ExploreErrorKind, status: number, code: string, message: string): ExploreError {
  return { kind, status, code, message };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isPack(value: unknown): value is ExplorePack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  return typeof pack.gameId === "string" && typeof pack.title === "string" && typeof pack.sceneCount === "number";
}

function parseList(body: unknown): ExploreListResult | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as Record<string, unknown>;
  if (!Array.isArray(payload.packs)) return null;
  const packs = payload.packs.filter(isPack);
  const categories = Array.isArray(payload.categories)
    ? payload.categories
        .map((entry) => entry as Record<string, unknown>)
        .filter((entry) => typeof entry.slug === "string" && typeof entry.count === "number")
        .map((entry) => ({ slug: entry.slug as ExploreCategorySlug, count: entry.count as number }))
    : [];
  return { ok: true, packs, categories };
}

export function clearExploreCache(): void {
  listCache = null;
  listInFlight = null;
}

export async function loadExplorePacks(options: { fresh?: boolean } = {}): Promise<ExploreListResult> {
  const now = Date.now();
  if (!options.fresh && listCache && now - listCache.at < CACHE_TTL_MS) return listCache.value;
  if (!options.fresh && listInFlight) return listInFlight;

  const run = (async (): Promise<ExploreListResult> => {
    try {
      const response = await fetch("/api/explore", { cache: "no-cache" });
      const body = await readJson(response);
      if (!response.ok) {
        const record = (body ?? {}) as Record<string, unknown>;
        const result: ExploreListResult = {
          ok: false,
          error: failure(
            response.status === 503 ? "server" : "server",
            response.status,
            typeof record.error === "string" ? record.error : "explore_unavailable",
            typeof record.message === "string" ? record.message : "暂时无法读取探索内容。",
          ),
        };
        return result;
      }
      const parsed = parseList(body);
      if (!parsed) {
        return {
          ok: false,
          error: failure("malformed", response.status, "invalid_payload", "服务返回的数据格式不正确。"),
        };
      }
      listCache = { at: Date.now(), value: parsed };
      return parsed;
    } catch {
      return {
        ok: false,
        error: failure("network", 0, "network_error", "网络连接失败，请检查网络后重试。"),
      };
    } finally {
      listInFlight = null;
    }
  })();

  listInFlight = run;
  return run;
}

export async function loadExplorePack(gameId: string): Promise<ExplorePackResult> {
  try {
    const response = await fetch(`/api/explore/${encodeURIComponent(gameId)}`, { cache: "no-cache" });
    const body = await readJson(response);
    if (!response.ok) {
      const record = (body ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        error: failure(
          response.status === 404 ? "not_found" : "server",
          response.status,
          typeof record.error === "string" ? record.error : "pack_not_found",
          typeof record.message === "string" ? record.message : "暂时无法读取该探索包。",
        ),
      };
    }
    const record = (body ?? {}) as Record<string, unknown>;
    if (!isPack(record.pack)) {
      return {
        ok: false,
        error: failure("malformed", response.status, "invalid_payload", "服务返回的数据格式不正确。"),
      };
    }
    return { ok: true, pack: record.pack };
  } catch {
    return {
      ok: false,
      error: failure("network", 0, "network_error", "网络连接失败，请检查网络后重试。"),
    };
  }
}

/** Canonical public URL of a pack — the one that belongs in a share message. */
export function packHref(gameId: string): string {
  return `/explore/${encodeURIComponent(gameId)}`;
}

export function categoryHref(slug: ExploreCategorySlug): string {
  return `/explore/category/${slug}`;
}
