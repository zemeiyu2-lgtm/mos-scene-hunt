/**
 * Local game pack inventory: how much space the browser-local library uses,
 * what the browser will tell us about its own quota, and how to remove ONE
 * pack without touching anything published.
 *
 * Why this module exists
 * ----------------------
 * Authored packs are stored as a single `localStorage` entry per game
 * (`mos-scene-hunt:authoring:<id>`, see `lib/content`) containing the whole
 * game as JSON - including every image/PDF dropped into a scene, inlined as a
 * base64 `data:` URL by `components/media-gallery.tsx`. One phone photo is
 * several megabytes once base64-encoded, while iOS Safari gives the whole
 * origin a localStorage budget of roughly 5 MB that it never raises. Four
 * packs are therefore enough to exhaust it, and the only way out was
 * "clear website data" - which would also throw away every pack.
 *
 * Everything here is READ-ONLY unless you call `deleteLocalPack`, and nothing
 * here performs a network request. Deleting a local copy must never be able to
 * delete, unpublish or mutate a published game; the published copy lives in
 * server storage (`lib/publish`), which this module never imports.
 */

import {
  clearCachedGameContent,
  clearCurrentAuthoredGameId,
  clearGameState,
  pruneDuplicatedContentCache,
  removeHuntIndexEntry,
} from "./index";
import { utf8ByteLength } from "./bytes";

/**
 * Must stay byte-identical to the prefix `lib/content` writes.
 * `tests/storage/local-pack.test.ts` pins the two together by round-tripping a
 * real save through `saveAuthoredGameChecked`, so a drift here fails a test
 * instead of silently hiding every pack from the panel.
 */
export const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";

export function authoringKey(gameId: string): string {
  return `${AUTHORING_PREFIX}${gameId}`;
}

/**
 * Must stay byte-identical to `CURRENT_AUTHORED_KEY` in `lib/storage/index.ts`.
 *
 * Read directly here instead of through `getCurrentAuthoredGameId()`, because
 * that path goes through the defensive storage adapter, which probes with a
 * write. When the quota is already full the probe fails, the adapter falls back
 * to its in-memory map, and the pointer would look absent - exactly in the
 * situation this panel exists for. "当前" is decoration; getting it wrong here
 * would also skip resetting a pointer that really does point at the pack.
 */
const CURRENT_AUTHORED_KEY = "mos-scene-hunt:current-authored-game";

function peekCurrentAuthoredGameId(ls: Storage): string | null {
  try {
    const raw = ls.getItem(CURRENT_AUTHORED_KEY);
    if (typeof raw !== "string") return null;
    const id = raw.trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export interface LocalPackInfo {
  id: string;
  title: string;
  /** UTF-8 bytes of the stored JSON, as the browser will charge them. */
  bytes: number;
  sceneCount: number;
  /**
   * False when the entry exists but no longer parses as a game. It still
   * occupies its bytes, so it must stay visible and deletable.
   */
  valid: boolean;
  /** True when the app is currently pointed at this pack. */
  isCurrent: boolean;
  /** Number of inlined media items (base64 `data:` URLs) in this pack. */
  mediaCount: number;
  /** Bytes attributable to inlined media, i.e. the reclaimable bulk. */
  embeddedMediaBytes: number;
}

export interface LocalPackInventory {
  packs: LocalPackInfo[];
  totalBytes: number;
  unreadableCount: number;
  /** False when localStorage is blocked (private mode / storage disabled). */
  storageAvailable: boolean;
}

interface RawMediaLike {
  url?: unknown;
}

interface RawSceneLike {
  media?: unknown;
  challenge?: { media?: unknown } | null;
}

/**
 * Count inlined `data:` media in a parsed pack.
 *
 * Only scene media and challenge media are inspected - the two places
 * `MediaEditor` writes to. Scanning every string for `data:` would also count
 * legitimate text and overstate the reclaimable bytes.
 */
function measureEmbeddedMedia(value: unknown): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  const visit = (media: unknown) => {
    if (!Array.isArray(media)) return;
    for (const item of media as RawMediaLike[]) {
      const url = item?.url;
      if (typeof url !== "string" || !url.startsWith("data:")) continue;
      count += 1;
      // A data URL is ASCII by construction, so its length equals its bytes.
      bytes += url.length;
    }
  };
  const scenes = (value as { scenes?: unknown })?.scenes;
  if (Array.isArray(scenes)) {
    for (const scene of scenes as RawSceneLike[]) {
      visit(scene?.media);
      visit(scene?.challenge?.media);
    }
  }
  return { count, bytes };
}

function readPackEntry(gameId: string, raw: string, currentId: string | null): LocalPackInfo {
  const bytes = utf8ByteLength(raw);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const title =
    parsed && typeof (parsed as { title?: unknown }).title === "string"
      ? ((parsed as { title: string }).title.trim() || gameId)
      : gameId;
  const scenes = (parsed as { scenes?: unknown })?.scenes;
  const sceneCount = Array.isArray(scenes) ? scenes.length : 0;
  const media = parsed ? measureEmbeddedMedia(parsed) : { count: 0, bytes: 0 };
  return {
    id: gameId,
    title,
    bytes,
    sceneCount,
    valid: parsed !== null && typeof parsed === "object",
    isCurrent: currentId === gameId,
    mediaCount: media.count,
    embeddedMediaBytes: media.bytes,
  };
}

/**
 * Inventory of every stored pack, read directly from storage.
 *
 * Never throws: a blocked or partially unreadable localStorage degrades to an
 * empty list marked `storageAvailable: false`, which the panel renders as an
 * explanation instead of an error.
 */
export function measureLocalPacks(): LocalPackInventory {
  const empty: LocalPackInventory = {
    packs: [],
    totalBytes: 0,
    unreadableCount: 0,
    storageAvailable: false,
  };
  if (typeof window === "undefined") return empty;

  let ls: Storage;
  try {
    ls = window.localStorage;
    // A read proves availability; a successful probe write is what
    // `isPersistentStorageAvailable` uses, but a full quota would fail that
    // write and wrongly report "unavailable" - reading is the safer probe.
    void ls.length;
  } catch {
    return empty;
  }

  const currentId = peekCurrentAuthoredGameId(ls);
  const packs: LocalPackInfo[] = [];
  try {
    const ids: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key?.startsWith(AUTHORING_PREFIX)) ids.push(key.slice(AUTHORING_PREFIX.length));
    }
    for (const id of ids) {
      const raw = ls.getItem(authoringKey(id));
      if (raw === null) continue;
      packs.push(readPackEntry(id, raw, currentId));
    }
  } catch {
    return { ...empty, storageAvailable: true };
  }

  packs.sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title, "zh-CN"));
  return {
    packs,
    totalBytes: packs.reduce((sum, pack) => sum + pack.bytes, 0),
    unreadableCount: packs.filter((pack) => !pack.valid).length,
    storageAvailable: true,
  };
}

export type DeleteLocalPackResult =
  | {
      ok: true;
      id: string;
      title: string;
      /** Bytes of the pack entry that were released. */
      freedBytes: number;
      /** True when the play pointer had to be reset to the bundled pack. */
      wasCurrent: boolean;
    }
  | { ok: false; id: string; message: string; /** Entry still present after the attempt. */ stillStored: boolean };

/**
 * Delete ONE pack from this browser.
 *
 * Scope, deliberately narrow:
 *   - `mos-scene-hunt:authoring:<id>`      the pack itself (the bulk)
 *   - `mos-scene-hunt:content:<id>`        its offline cache, if any
 *     (+ the IndexedDB copy of that cache)
 *   - `mos-scene-hunt:save:<id>`           its local player progress
 *   - `mos-scene-hunt:save-index`          its progress index row
 *   - `mos-scene-hunt:current-authored-game` only when it pointed at this pack
 *
 * Never touched: any other pack, settings, the cloud catalog, and - crucially -
 * anything on the server. There is no fetch in this function or in anything it
 * calls, so a local delete cannot unpublish or delete a published game.
 *
 * Only the pack entry is treated as irreplaceable. The cache and progress rows
 * are reclaimed too: leaving them behind would keep charging the quota for a
 * game the author just chose to remove, and orphaned progress can never be
 * reached again. The confirmation dialog states this before anything happens.
 */
export async function deleteLocalPack(gameId: string): Promise<DeleteLocalPackResult> {
  if (!gameId) {
    return { ok: false, id: gameId, message: "没有指定要删除的本机游戏。", stillStored: false };
  }
  if (typeof window === "undefined") {
    return { ok: false, id: gameId, message: "当前环境不支持本机存储。", stillStored: false };
  }

  const inventory = measureLocalPacks();
  const target = inventory.packs.find((pack) => pack.id === gameId);
  if (!target) {
    return {
      ok: false,
      id: gameId,
      message: "本机没有找到这个游戏包（可能已经被删除）。",
      stillStored: false,
    };
  }
  const wasCurrent = target.isCurrent;

  try {
    window.localStorage.removeItem(authoringKey(gameId));
  } catch (error) {
    return {
      ok: false,
      id: gameId,
      message: `无法删除本机副本：${
        error instanceof Error && error.message ? error.message : "浏览器拒绝写入存储"
      }`,
      stillStored: true,
    };
  }

  // Verify against storage, not against the click: a silent no-op must not be
  // reported as "deleted".
  let stillStored = false;
  try {
    stillStored = window.localStorage.getItem(authoringKey(gameId)) !== null;
  } catch {
    stillStored = true;
  }
  if (stillStored) {
    return {
      ok: false,
      id: gameId,
      message: "删除没有生效，本机副本仍在。请刷新页面后重试。",
      stillStored: true,
    };
  }

  // Secondary rows. A failure here must not turn a successful pack deletion
  // into an error - the pack is gone, which is what the author asked for.
  await clearCachedGameContent(gameId).catch(() => undefined);
  clearGameState(gameId);
  removeHuntIndexEntry(gameId);
  if (wasCurrent) clearCurrentAuthoredGameId();

  return {
    ok: true,
    id: gameId,
    title: target.title,
    freedBytes: target.bytes,
    wasCurrent,
  };
}

export interface BrowserStorageEstimate {
  /** True when `navigator.storage.estimate()` returned usable numbers. */
  supported: boolean;
  usage: number | null;
  quota: number | null;
  /** `navigator.storage.persisted()`, or null when the API is unavailable. */
  persisted: boolean | null;
  persistedSupported: boolean;
}

/**
 * Ask the browser how much of its origin quota is used.
 *
 * Everything returned here is an ESTIMATE reported by the browser for this
 * origin. It is not the device's free disk space, and the browser is free to
 * evict, shrink or grow it - so the UI must never turn these numbers into a
 * promise ("还能存 N 个游戏").
 */
export async function estimateBrowserStorage(): Promise<BrowserStorageEstimate> {
  const unavailable: BrowserStorageEstimate = {
    supported: false,
    usage: null,
    quota: null,
    persisted: null,
    persistedSupported: false,
  };
  if (typeof navigator === "undefined") return unavailable;
  const storage = navigator.storage as StorageManager | undefined;
  if (!storage || typeof storage.estimate !== "function") return unavailable;

  let usage: number | null = null;
  let quota: number | null = null;
  try {
    const estimate = await storage.estimate();
    if (typeof estimate?.usage === "number") usage = estimate.usage;
    if (typeof estimate?.quota === "number") quota = estimate.quota;
  } catch {
    return unavailable;
  }
  if (usage === null && quota === null) return unavailable;

  let persisted: boolean | null = null;
  let persistedSupported = false;
  if (typeof storage.persisted === "function") {
    try {
      persisted = await storage.persisted();
      persistedSupported = true;
    } catch {
      persistedSupported = false;
    }
  }
  return { supported: true, usage, quota, persisted, persistedSupported };
}

export type StoragePressureLevel = "unknown" | "ok" | "tight" | "critical";

export interface StoragePressure {
  level: StoragePressureLevel;
  /** One sentence the UI can show verbatim. */
  note: string;
  /** 0..1 when both numbers are known, otherwise null. */
  ratio: number | null;
}

/**
 * Turn the browser estimate into an honest sentence.
 *
 * When the API is unavailable the note must still be useful (pack count and
 * measured pack bytes are always known) - it just must not invent a capacity.
 */
export function describeStoragePressure(
  inventory: Pick<LocalPackInventory, "packs" | "totalBytes">,
  estimate: BrowserStorageEstimate,
  format: (bytes: number) => string,
): StoragePressure {
  const count = inventory.packs.length;
  if (!estimate.supported || estimate.usage === null || estimate.quota === null || estimate.quota <= 0) {
    return {
      level: "unknown",
      ratio: null,
      note:
        count > 0
          ? `当前浏览器没有提供容量估算接口，无法显示系统级剩余空间；上表的占用是按实际存储内容计算得出的。`
          : "当前浏览器没有提供容量估算接口，无法显示系统级剩余空间。",
    };
  }

  const ratio = Math.min(1, estimate.usage / estimate.quota);
  const free = Math.max(0, estimate.quota - estimate.usage);
  const base = `浏览器为本网站分配的额度约 ${format(estimate.quota)}，已用约 ${format(
    estimate.usage,
  )}，估算剩余约 ${format(free)}。这是浏览器按本站 origin 计算的估算值，不是手机的可用磁盘空间，也可能随浏览器策略变化。`;

  if (ratio >= 0.9) {
    return {
      level: "critical",
      ratio,
      note: `${base} 空间已接近上限：下一次保存很可能失败，请先删除不再需要的本地副本。`,
    };
  }
  if (ratio >= 0.75) {
    return {
      level: "tight",
      ratio,
      note: `${base} 空间偏紧：建议删除不再需要的本地副本，或减少游戏包里的内嵌图片和文件。`,
    };
  }
  return { level: "ok", ratio, note: base };
}

/**
 * Reclaim bytes that historical builds duplicated into localStorage.
 *
 * Safe by construction: only mirrors whose IndexedDB copy exists are removed,
 * and a cached pack is always re-fetchable. Returns what was actually freed.
 */
export async function reclaimDuplicatedCache(): Promise<{ removedIds: string[]; freedBytes: number }> {
  return pruneDuplicatedContentCache();
}
