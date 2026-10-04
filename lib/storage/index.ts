/**
 * Persistence layer.
 *
 * Two-tier strategy:
 *  - localStorage: small, synchronous, always available. Holds the active save
 *    and the schema version. This is what guarantees "refresh and progress is
 *    still there" with zero async race conditions.
 *  - IndexedDB (via idb-keyval): holds larger payloads - cached content packs and
 *    a rolling save journal for crash recovery.
 *
 * Both are wrapped in a defensive adapter so a browser with storage disabled
 * degrades to in-memory rather than throwing mid-game.
 */

import { get as idbGet, set as idbSet, del as idbDel, createStore } from "idb-keyval";
import type { GameState } from "../game/state";
import type { Game } from "../game/types";

export const SAVE_SCHEMA_VERSION = 1;

const ACTIVE_SAVE_KEY = "mos-scene-hunt:active-save";
const SAVE_INDEX_KEY = "mos-scene-hunt:save-index";
const SETTINGS_KEY = "mos-scene-hunt:settings";
const CONTENT_CACHE_PREFIX = "mos-scene-hunt:content:";

export interface SaveEnvelope {
  schemaVersion: number;
  savedAt: number;
  gameId: string;
  gameVersion: string;
  state: GameState;
  /** Present only on files produced by exportSave(). */
  exportedAt?: number;
}

export interface HuntIndexEntry {
  gameId: string;
  title: string;
  completedScenes: number;
  totalScenes: number;
  lastPlayedAt: number;
}

export interface PlayerSettings {
  /** Whether the DEV simulator panel is expanded. Dev-only, but persisted. */
  simulatorEnabled: boolean;
  /** Last simulated coordinate, so a reload during testing resumes in place. */
  simulatorCoordinate: { lat: number; lng: number } | null;
  /** Preferred map tile provider id. */
  tileProvider: "osm" | "osm-hot" | "carto-voyager";
  /** Reduce motion for accessibility. */
  reduceMotion: boolean;
  /** Whether to allow the accuracy slack when testing radius entry. */
  allowAccuracySlack: boolean;
  /** Avoid re-showing the intro. */
  hasSeenIntro: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  simulatorEnabled: false,
  simulatorCoordinate: null,
  tileProvider: "osm-hot",
  reduceMotion: false,
  allowAccuracySlack: true,
  hasSeenIntro: false,
};

/* ------------------------------------------------------------------ */
/* Safe storage adapter                                               */
/* ------------------------------------------------------------------ */

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const probe = "__mos_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    // Private browsing, disabled storage, or an iframe without allow-same-origin.
    return null;
  }
}

/** In-memory fallback so the game still runs when storage is unavailable. */
const memoryStore = new Map<string, string>();

function readRaw(key: string): string | null {
  const ls = safeLocalStorage();
  if (ls) {
    try {
      return ls.getItem(key);
    } catch {
      /* fall through */
    }
  }
  return memoryStore.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  const ls = safeLocalStorage();
  if (ls) {
    try {
      ls.setItem(key, value);
      return;
    } catch {
      /* quota exceeded or blocked - fall through to memory */
    }
  }
  memoryStore.set(key, value);
}

function removeRaw(key: string): void {
  const ls = safeLocalStorage();
  if (ls) {
    try {
      ls.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  memoryStore.delete(key);
}

/** True when durable storage is actually available, for the UI to warn about. */
export function isPersistentStorageAvailable(): boolean {
  return safeLocalStorage() !== null;
}

/* ------------------------------------------------------------------ */
/* Save data                                                          */
/* ------------------------------------------------------------------ */

export function saveGameState(state: GameState): boolean {
  const envelope: SaveEnvelope = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: Date.now(),
    gameId: state.gameId,
    gameVersion: state.gameVersion,
    state,
  };
  try {
    writeRaw(ACTIVE_SAVE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function loadGameState(gameId: string): GameState | null {
  const raw = readRaw(ACTIVE_SAVE_KEY);
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as SaveEnvelope;
    if (!envelope || envelope.schemaVersion !== SAVE_SCHEMA_VERSION) {
      // Unknown schema: refuse rather than half-migrate and corrupt the save.
      return null;
    }
    if (envelope.gameId !== gameId) return null;
    if (!envelope.state || typeof envelope.state !== "object") return null;
    return envelope.state;
  } catch {
    return null;
  }
}

export function clearGameState(): void {
  removeRaw(ACTIVE_SAVE_KEY);
}

/* ------------------------------------------------------------------ */
/* Multi-hunt index                                                   */
/* ------------------------------------------------------------------ */

export function readHuntIndex(): HuntIndexEntry[] {
  const raw = readRaw(SAVE_INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HuntIndexEntry[]) : [];
  } catch {
    return [];
  }
}

export function upsertHuntIndex(entry: HuntIndexEntry): void {
  const index = readHuntIndex().filter((e) => e.gameId !== entry.gameId);
  index.push(entry);
  index.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  writeRaw(SAVE_INDEX_KEY, JSON.stringify(index.slice(0, 50)));
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

export function loadSettings(): PlayerSettings {
  const raw = readRaw(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    // Merge, so a new setting added in a later build gets its default.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: PlayerSettings): void {
  writeRaw(SETTINGS_KEY, JSON.stringify(settings));
}

/* ------------------------------------------------------------------ */
/* Offline content cache (IndexedDB)                                  */
/* ------------------------------------------------------------------ */

const contentStore =
  typeof indexedDB !== "undefined" ? createStore("mos-scene-hunt", "content") : null;

/**
 * Cache a validated content pack so the hunt is playable with no network.
 * Called after every successful load, and re-read on startup when the fetch
 * fails - this is the mechanism behind spec section 13.
 */
export async function cacheGameContent(game: Game): Promise<void> {
  const payload = { cachedAt: Date.now(), game };
  try {
    if (contentStore) {
      await idbSet(`${CONTENT_CACHE_PREFIX}${game.id}`, payload, contentStore);
    }
  } catch {
    /* IndexedDB unavailable - localStorage is the fallback below */
  }
  try {
    // Mirrored into localStorage as well: small enough for a demo pack, and it
    // survives environments where IndexedDB is blocked (some private modes).
    writeRaw(`${CONTENT_CACHE_PREFIX}${game.id}`, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export async function readCachedGameContent(
  gameId: string,
): Promise<{ cachedAt: number; game: Game } | null> {
  try {
    if (contentStore) {
      const hit = await idbGet<{ cachedAt: number; game: Game }>(
        `${CONTENT_CACHE_PREFIX}${gameId}`,
        contentStore,
      );
      if (hit?.game) return hit;
    }
  } catch {
    /* fall through */
  }
  const raw = readRaw(`${CONTENT_CACHE_PREFIX}${gameId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearCachedGameContent(gameId: string): Promise<void> {
  try {
    if (contentStore) await idbDel(`${CONTENT_CACHE_PREFIX}${gameId}`, contentStore);
  } catch {
    /* ignore */
  }
  removeRaw(`${CONTENT_CACHE_PREFIX}${gameId}`);
}

/* ------------------------------------------------------------------ */
/* Export / import (a save is a file, not a trap)                      */
/* ------------------------------------------------------------------ */

export function exportSave(state: GameState): string {
  return JSON.stringify(
    {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      exportedAt: Date.now(),
      gameId: state.gameId,
      gameVersion: state.gameVersion,
      state,
    } satisfies SaveEnvelope,
    null,
    2,
  );
}

export function importSave(text: string): GameState | null {
  try {
    const envelope = JSON.parse(text) as SaveEnvelope;
    if (envelope?.schemaVersion !== SAVE_SCHEMA_VERSION) return null;
    if (!envelope.state || typeof envelope.state !== "object") return null;
    return envelope.state;
  } catch {
    return null;
  }
}

/** Rough byte size of the active save, shown in the debug panel. */
export function saveSizeBytes(): number {
  const raw = readRaw(ACTIVE_SAVE_KEY);
  return raw ? new Blob([raw]).size : 0;
}
