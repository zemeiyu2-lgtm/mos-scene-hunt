/**
 * City persistence — profiles and work↔city links.
 *
 * Deliberately a SEPARATE store from the registry:
 *
 *  - profile documents (`cities/<cityId>.json`) are authoritative and are
 *    written exactly once (exclusive create) plus revision-checked updates;
 *  - link documents (`city-links/<gameId>.json`) are DERIVED data, one per
 *    work, so concurrent publishes of different works never contend on a
 *    shared index document, repeated writes are idempotent by key, and the
 *    whole index can be rebuilt from `works/*.json` at any time.
 *
 * Concurrency honesty (same trade-off as the registry store, documented not
 * hidden): the Blob adapter has no compare-and-swap. Creation is safe because
 * `allowOverwrite: false` is an atomic "create if absent" on the platform;
 * updates use the profile `revision` as the optimistic token, and two
 * different serverless instances can still interleave an update. That is
 * acceptable here because a lost profile update only affects display names —
 * never publish state or pack bytes.
 */

import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, put, del, BlobNotFoundError } from "@vercel/blob";
import { resolveBlobPrefix } from "../storage/namespace-guard";
import { CITY_SCHEMA_VERSION, parseCity, parseCityLink, type CityLink, type CityProfile } from "./types";

export interface CityStoreWriteResult {
  ok: boolean;
  /** The write was rejected because the stored document moved on / exists. */
  conflict?: boolean;
}

export interface CityStore {
  readonly kind: "file" | "blob";

  getCity(cityId: string): Promise<CityProfile | null>;
  listCities(): Promise<CityProfile[]>;
  /** Create-if-absent. `conflict` means a profile with this id already exists. */
  createCity(city: CityProfile): Promise<CityStoreWriteResult>;
  /** Update only when the stored revision matches `expectedRevision`. */
  putCity(city: CityProfile, expectedRevision: number): Promise<CityStoreWriteResult>;

  getLink(gameId: string): Promise<CityLink | null>;
  listLinks(): Promise<CityLink[]>;
  /** Idempotent upsert keyed by gameId — safe to replay after a failure. */
  putLink(link: CityLink): Promise<CityStoreWriteResult>;
  /** Remove a derived link (work deleted its city association). No-op if absent. */
  deleteLink(gameId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Filesystem adapter                                                 */
/* ------------------------------------------------------------------ */

/** Serialises work on one key inside this process (same pattern as the registry). */
const locks = new Map<string, Promise<unknown>>();

function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  locks.set(key, settled);
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return run;
}

export function createFileCityStore(root: string): CityStore {
  const citiesDir = path.join(root, "cities");
  const linksDir = path.join(root, "city-links");

  const readJson = async (file: string): Promise<string | null> => {
    try {
      return await readFile(file, "utf8");
    } catch {
      return null;
    }
  };

  const writeJsonAtomic = async (file: string, body: string): Promise<void> => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, file);
    const back = await readFile(file, "utf8");
    if (back !== body) throw new Error(`写入校验失败：${path.basename(file)}`);
  };

  /**
   * Atomic create-if-absent: write a private temp file, then hard-link it into
   * place. `link()` fails with EEXIST when the target exists, which is exactly
   * the "already created by a concurrent request" outcome we need.
   */
  const createExclusive = async (file: string, body: string): Promise<boolean> => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, body, "utf8");
    try {
      await link(tmp, file);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false;
      throw error;
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  };

  const readDirJson = async <T>(dir: string, parse: (raw: string) => T | null): Promise<T[]> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out: T[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readJson(path.join(dir, name));
      if (raw === null) continue;
      const parsed = parse(raw);
      if (parsed) out.push(parsed);
    }
    return out;
  };

  return {
    kind: "file",

    async getCity(cityId) {
      const raw = await readJson(path.join(citiesDir, `${cityId}.json`));
      if (raw === null) return null;
      const city = parseCity(raw);
      return city && city.cityId === cityId ? city : null;
    },

    async listCities() {
      return readDirJson<CityProfile>(citiesDir, parseCity);
    },

    async createCity(city) {
      const body = JSON.stringify(city, null, 2);
      return withKeyLock(`city:${city.cityId}`, async () => {
        const created = await createExclusive(path.join(citiesDir, `${city.cityId}.json`), body);
        return created ? { ok: true } : { ok: false, conflict: true };
      });
    },

    async putCity(city, expectedRevision) {
      const file = path.join(citiesDir, `${city.cityId}.json`);
      return withKeyLock(`city:${city.cityId}`, async () => {
        const raw = await readJson(file);
        if (raw === null) return { ok: false, conflict: true };
        const current = parseCity(raw);
        if (!current || current.revision !== expectedRevision) return { ok: false, conflict: true };
        await writeJsonAtomic(file, JSON.stringify(city, null, 2));
        return { ok: true };
      });
    },

    async getLink(gameId) {
      const raw = await readJson(path.join(linksDir, `${gameId}.json`));
      return raw === null ? null : parseCityLink(raw, gameId);
    },

    async listLinks() {
      let names: string[];
      try {
        names = await readdir(linksDir);
      } catch {
        return [];
      }
      const out: CityLink[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const gameId = name.slice(0, -5);
        const raw = await readJson(path.join(linksDir, name));
        if (raw === null) continue;
        const parsed = parseCityLink(raw, gameId);
        if (parsed) out.push(parsed);
      }
      return out;
    },

    async putLink(entry) {
      await writeJsonAtomic(path.join(linksDir, `${entry.gameId}.json`), JSON.stringify(entry, null, 2));
      return { ok: true };
    },

    async deleteLink(gameId) {
      await unlink(path.join(linksDir, `${gameId}.json`)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vercel Blob adapter                                                */
/* ------------------------------------------------------------------ */

const BLOB_NOT_FOUND_MESSAGE = /not found|does not exist/i;
const BLOB_EXISTS_MESSAGE = /already exists|file exists|exists with the same/i;

export function createBlobCityStore(prefix: string): CityStore {
  const base = prefix.replace(/^\/+|\/+$/g, "");
  const at = (key: string) => `${base}/${key}`;

  const readText = async (key: string, fresh = true): Promise<string | null> => {
    try {
      const result = await get(at(key), { access: "private", useCache: !fresh });
      if (!result || result.statusCode !== 200) return null;
      return await new Response(result.stream).text();
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      const message = error instanceof Error ? error.message : String(error);
      if (BLOB_NOT_FOUND_MESSAGE.test(message)) return null;
      throw error;
    }
  };

  const writeText = async (key: string, body: string, overwrite: boolean): Promise<void> => {
    await put(at(key), body, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 0,
      allowOverwrite: overwrite,
    });
  };

  const listKeys = async (keyPrefix: string): Promise<string[]> => {
    const out: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await list({ prefix: at(keyPrefix), cursor, limit: 1000 });
      for (const blob of page.blobs) out.push(blob.pathname);
      if (!page.hasMore || !page.cursor) break;
      cursor = page.cursor;
    }
    return out;
  };

  return {
    kind: "blob",

    async getCity(cityId) {
      const raw = await readText(`cities/${cityId}.json`);
      if (raw === null) return null;
      const city = parseCity(raw);
      return city && city.cityId === cityId ? city : null;
    },

    async listCities() {
      const keys = await listKeys("cities/");
      const out: CityProfile[] = [];
      for (const key of keys) {
        const name = key.split("/").pop() ?? "";
        if (!name.endsWith(".json")) continue;
        const raw = await readText(`cities/${name}`, false);
        if (!raw) continue;
        const city = parseCity(raw);
        if (city) out.push(city);
      }
      return out;
    },

    async createCity(city) {
      try {
        await writeText(`cities/${city.cityId}.json`, JSON.stringify(city, null, 2), false);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (BLOB_EXISTS_MESSAGE.test(message)) return { ok: false, conflict: true };
        throw error;
      }
    },

    async putCity(city, expectedRevision) {
      const raw = await readText(`cities/${city.cityId}.json`);
      if (raw === null) return { ok: false, conflict: true };
      const current = parseCity(raw);
      if (!current || current.revision !== expectedRevision) return { ok: false, conflict: true };
      await writeText(`cities/${city.cityId}.json`, JSON.stringify(city, null, 2), true);
      return { ok: true };
    },

    async getLink(gameId) {
      const raw = await readText(`city-links/${gameId}.json`);
      return raw === null ? null : parseCityLink(raw, gameId);
    },

    async listLinks() {
      const keys = await listKeys("city-links/");
      const out: CityLink[] = [];
      for (const key of keys) {
        const name = key.split("/").pop() ?? "";
        if (!name.endsWith(".json")) continue;
        const gameId = name.slice(0, -5);
        const raw = await readText(`city-links/${name}`, false);
        if (!raw) continue;
        const parsed = parseCityLink(raw, gameId);
        if (parsed) out.push(parsed);
      }
      return out;
    },

    async putLink(entry) {
      await writeText(`city-links/${entry.gameId}.json`, JSON.stringify(entry, null, 2), true);
      return { ok: true };
    },

    async deleteLink(gameId) {
      try {
        await del(at(`city-links/${gameId}.json`));
      } catch (error) {
        if (error instanceof BlobNotFoundError) return;
        const message = error instanceof Error ? error.message : String(error);
        if (BLOB_NOT_FOUND_MESSAGE.test(message)) return;
        throw error;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Selection                                                          */
/* ------------------------------------------------------------------ */

let cached: CityStore | null = null;

/**
 * `CITIES_STORE=blob` selects Vercel Blob; anything else uses `CITIES_DIR`
 * (default `.cities/`, git-ignored) — the zero-credential local/test mode.
 */
export function getCityStore(): CityStore {
  if (cached) return cached;
  const kind = process.env.CITIES_STORE?.trim().toLowerCase();
  if (kind === "blob") {
    const prefix = resolveBlobPrefix({ store: "cities", prefix: process.env.CITIES_BLOB_PREFIX });
    cached = createBlobCityStore(prefix);
  } else {
    const dir = process.env.CITIES_DIR?.trim() || path.join(process.cwd(), ".cities");
    cached = createFileCityStore(dir);
  }
  return cached;
}

/** Test seam: forget the cached adapter after changing env or temp dirs. */
export function resetCityStoreForTests(): void {
  cached = null;
}

export { CITY_SCHEMA_VERSION };
