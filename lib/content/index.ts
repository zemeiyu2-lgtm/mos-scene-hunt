/**
 * lib/content - content pack loading, validation and offline fallback.
 */

import { validateGame, type Game, type ValidationIssue } from "../game/types";
import { cacheGameContent, readCachedGameContent } from "../storage";

const CONTENT_BASE = "/content";
const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";

function authoringKey(gameId: string): string {
  return `${AUTHORING_PREFIX}${gameId}`;
}

/** Save a locally authored pack. It is intentionally browser-local until a future backend exists. */
export function saveAuthoredGame(game: Game): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(authoringKey(game.id), JSON.stringify(game));
    return true;
  } catch {
    return false;
  }
}

export function clearAuthoredGame(gameId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(authoringKey(gameId));
}

export function hasAuthoredGame(gameId: string): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(authoringKey(gameId)));
}


export interface LoadedGame {
  game: Game;
  /** Non-fatal authoring problems worth surfacing in the dev panel. */
  issues: ValidationIssue[];
  /** Where the pack actually came from - drives the offline badge in the UI. */
  source: "network" | "cache" | "local";
  cachedAt?: number;
}

/** Default pack shipped with V0.1. */
export const DEFAULT_GAME_ID = "demo-hunt";

function packUrl(gameId: string): string {
  return `${CONTENT_BASE}/${gameId}.json`;
}

/**
 * Load a content pack.
 *
 * Order of preference:
 *  1. The network, so authors see edits immediately.
 *  2. The IndexedDB / localStorage cache, so the hunt is playable offline.
 *
 * A pack that fails validation is never cached and never played - a broken
 * content pack should fail loudly at build/authoring time, not silently at
 * scene 3 in a park.
 */
export async function loadGame(
  gameId: string = DEFAULT_GAME_ID,
  options: { forceNetwork?: boolean } = {},
): Promise<LoadedGame> {
  let networkError: unknown = null;

  // Browser-local authored content takes precedence. This makes the designer
  // immediately playable without requiring an account or backend.
  if (typeof window !== "undefined") {
    try {
      const authored = window.localStorage.getItem(authoringKey(gameId));
      if (authored) {
        const raw = JSON.parse(authored);
        const { game, issues } = validateGame(raw);
        return { game, issues, source: "local" };
      }
    } catch {
      // Ignore a stale/broken local draft and fall back to the packaged content.
    }
  }

  if (!options.forceNetwork) {
    /* fall through to cached-first only if explicitly requested */
  }

  try {
    const res = await fetch(packUrl(gameId), {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const { game, issues } = validateGame(raw);
    // Fire and forget: a cache write failure must not break gameplay.
    void cacheGameContent(game);
    return { game, issues, source: "network" };
  } catch (err) {
    networkError = err;
  }

  const cached = await readCachedGameContent(gameId);
  if (cached?.game) {
    const { game, issues } = validateGame(cached.game);
    return { game, issues, source: "cache", cachedAt: cached.cachedAt };
  }

  throw new Error(
    `无法加载游戏内容"${gameId}"：网络请求失败（${
      networkError instanceof Error ? networkError.message : String(networkError)
    }），且本地没有离线缓存。请联网后重试一次。`,
  );
}

/** Manifest of content packs available to the hunt-select screen. */
export interface HuntManifestEntry {
  id: string;
  title: string;
  description: string;
  language: string;
  estimatedMinutes?: number;
  difficulty?: "easy" | "medium" | "hard";
  sceneCount: number;
  /** Presentation-only gradient key, resolved to CSS by the UI. */
  accent?: string;
  /** Marks the pack that ships with V0.1. */
  featured?: boolean;
}

/**
 * V0.1 ships one pack. The manifest is an in-code list rather than a fetched
 * index so that hunt-select works offline out of the box; V0.2 can swap this for
 * a `/content/index.json` without changing the screen's contract.
 */
export const HUNT_MANIFEST: HuntManifestEntry[] = [
  {
    id: DEFAULT_GAME_ID,
    title: "Demo Hunt · 记忆之路",
    description:
      "一条三站式的城市微寻宝。在三个真实地点之间移动，解开观察题，收集关键词，走完一条被遗忘的记忆之路。",
    language: "zh-CN",
    estimatedMinutes: 25,
    difficulty: "easy",
    sceneCount: 3,
    accent: "signal",
    featured: true,
  },
];

export function findManifestEntry(gameId: string): HuntManifestEntry | undefined {
  return HUNT_MANIFEST.find((h) => h.id === gameId);
}
