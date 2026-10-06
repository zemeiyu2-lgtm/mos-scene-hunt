/**
 * lib/content - content pack loading, validation and offline fallback.
 */

import { validateGame, type Game, type ValidationIssue } from "../game/types";
import { readSharedGameFromUrl } from "./share";
import {
  cacheGameContent,
  clearCurrentAuthoredGameId,
  getCurrentAuthoredGameId,
  readCachedGameContent,
  setCurrentAuthoredGameId,
} from "../storage";

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

/* ------------------------------------------------------------------ */
/* Current authored pack                                              */
/* ------------------------------------------------------------------ */

/**
 * Mark an authored pack as the one to play.
 *
 * This is what makes 「保存我的游戏 → 立即试玩」 show the game the author just
 * built instead of the bundled demo: the root provider reads this pointer at
 * boot and loads that pack everywhere (/select, /map, /scene, /challenge,
 * /reward). Purely browser-local - no backend, no account.
 */
export function markCurrentAuthoredGame(gameId: string): void {
  if (typeof window === "undefined") return;
  setCurrentAuthoredGameId(gameId);
}

/** The authored pack currently selected for play, or null for the bundled default. */
export function getActiveAuthoredGameId(): string | null {
  if (typeof window === "undefined") return null;
  return getCurrentAuthoredGameId();
}

/** Drop the pointer so the app falls back to the bundled pack (demo-hunt). */
export function clearActiveAuthoredGame(): void {
  if (typeof window === "undefined") return;
  clearCurrentAuthoredGameId();
}

/** Read an authored pack directly from browser storage, if one exists and is valid. */
export function readAuthoredGame(gameId: string): Game | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(authoringKey(gameId));
    if (!raw) return null;
    const { game } = validateGame(JSON.parse(raw));
    return game;
  } catch {
    return null;
  }
}

export interface LoadedGame {
  game: Game;
  /** Non-fatal authoring problems worth surfacing in the dev panel. */
  issues: ValidationIssue[];
  /** Where the pack actually came from - drives the offline badge in the UI. */
  source: "network" | "cache" | "local" | "shared";
  cachedAt?: number;
}

/** Default pack shipped with V0.1. */
export const DEFAULT_GAME_ID = "demo-hunt";

function packUrl(gameId: string): string {
  return `${CONTENT_BASE}/${gameId}.json`;
}

/**
 * Resolve which pack the app should actually load.
 *
 * Precedence:
 *  1. An explicit id (a caller that already knows what it wants).
 *  2. The authored pack the designer last saved, if it is still readable.
 *  3. The bundled default.
 *
 * The pointer is only honoured when the authored pack actually parses, so a
 * cleared or corrupt entry degrades to the demo instead of an empty screen.
 */
export function resolveActiveGameId(explicit?: string | null): string {
  if (explicit) return explicit;
  const authored = getActiveAuthoredGameId();
  if (authored && readAuthoredGame(authored)) return authored;
  return DEFAULT_GAME_ID;
}

/**
 * Load a content pack.
 *
 * Order of preference:
 *  1. Browser-local authored content (the designer's own pack), so
 *     「保存我的游戏 → 立即试玩」 plays what the author just built.
 *  2. The network, so authors see edits immediately.
 *  3. The IndexedDB / localStorage cache, so the hunt is playable offline.
 *
 * A pack that fails validation is never cached and never played - a broken
 * content pack should fail loudly at build/authoring time, not silently at
 * scene 3 in a park.
 */
export async function loadGame(
  gameId: string = resolveActiveGameId(),
  options: { forceNetwork?: boolean } = {},
): Promise<LoadedGame> {
  let networkError: unknown = null;

  // A shared URL carries the complete validated game in its hash. Check it first so the recipient needs no local storage.\n  if (typeof window !== "undefined") {\n    const shared = await readSharedGameFromUrl();\n    if (shared) return { game: shared, issues: [], source: "shared" };\n  }\n\n  // Browser-local authored content takes precedence. This makes the designer
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
    if (!res.ok) {
      // Surface the server's contract payload (error/message/detail) instead of
      // a bare status code, so a broken pack is diagnosable from the UI.
      const bodyText = await res.text().catch(() => "");
      let serverDetail = "";
      try {
        const body = JSON.parse(bodyText) as {
          error?: string;
          message?: string;
          detail?: string;
        };
        serverDetail = [body.error, body.message, body.detail]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .join(" - ");
      } catch {
        serverDetail = bodyText.slice(0, 200).trim();
      }
      throw new Error(
        serverDetail ? `HTTP ${res.status}（${serverDetail}）` : `HTTP ${res.status}`,
      );
    }
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
    id: "bsop-eight-secrets",
    title: "神学院的八个秘密",
    description:
      "BSOP Reference Game 01：在真实校园中体验呼召、真理、实践、敬拜、群体、生命与忠心，并以一个具体行动结束。示范图片、PDF/网页资料、声音反馈与多种任务类型。",
    language: "zh-CN",
    estimatedMinutes: 35,
    difficulty: "easy",
    sceneCount: 8,
    accent: "signal",
    featured: true,
  },
  {
    id: DEFAULT_GAME_ID,
    title: "Luneta · 看见这座城市",
    description:
      "一条真实地点驱动的五站城市寻宝。你将在 Rizal Park（Luneta）约 1.5 公里的探索区域内，走到真实的纪念碑、花园与公共空间，在现场观察、历史记忆与信仰反思之间移动。每一站都必须先到现场，再解锁任务。",
    language: "zh-CN",
    estimatedMinutes: 55,
    difficulty: "easy",
    sceneCount: 5,
    accent: "signal",
    featured: true,
  },
];

export function findManifestEntry(gameId: string): HuntManifestEntry | undefined {
  return HUNT_MANIFEST.find((h) => h.id === gameId);
}
