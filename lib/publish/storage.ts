/**
 * Storage layer for published games.
 *
 * The game rules engine never touches this module: it speaks only in opaque
 * pack text in and out, so the backing store can be swapped (Vercel Blob,
 * Alibaba OSS, Tencent COS, ...) by implementing {@link PublishedGameStore}
 * and returning it from `getStore`. The default adapter is a filesystem
 * directory - zero new dependencies, works on any Node host, and keeps the
 * first serverization batch honest without cloud credentials.
 *
 * Immutability contract: {@link PublishedGameStore.publish} must never
 * overwrite an existing version object with different content. Identical
 * content is an idempotent no-op; different content under an existing
 * versionId throws {@link VersionConflictError} (the caller maps it to 409).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { GAME_ID_PATTERN, VERSION_ID_PATTERN } from "./version";

export interface PublishedVersionMeta {
  versionId: string;
  title: string;
  sceneCount: number;
  publishedAt: string;
}

export interface PublishedGameMeta {
  gameId: string;
  latestVersionId: string;
  versions: PublishedVersionMeta[];
}

export interface PublishInput {
  gameId: string;
  versionId: string;
  title: string;
  sceneCount: number;
  /** Canonical serialisation of the validated game pack. */
  packJson: string;
}

export interface PublishResult {
  /** False when the identical version already existed (idempotent re-publish). */
  created: boolean;
  meta: PublishedGameMeta;
}

export interface PublishedGameStore {
  publish(input: PublishInput): Promise<PublishResult>;
  /** Raw pack JSON text for one immutable version, or null when absent. */
  readVersion(gameId: string, versionId: string): Promise<string | null>;
  /** Game metadata incl. the latest versionId, or null when never published. */
  readMeta(gameId: string): Promise<PublishedGameMeta | null>;
}

/** Thrown when an existing version object would be replaced by other content. */
export class VersionConflictError extends Error {
  constructor(gameId: string, versionId: string) {
    super(`版本 ${versionId} 已存在且内容不同，已发布版本不可覆盖（game: ${gameId}）`);
    this.name = "VersionConflictError";
  }
}

function assertSafeIds(gameId: string, versionId: string): void {
  if (!GAME_ID_PATTERN.test(gameId)) throw new Error(`gameId 不合法：${gameId}`);
  if (!VERSION_ID_PATTERN.test(versionId)) throw new Error(`versionId 不合法：${versionId}`);
}

/**
 * Filesystem adapter. Layout under `root`:
 *   <gameId>/meta.json            - PublishedGameMeta
 *   <gameId>/versions/<vId>.json  - the pack text
 * gameId/versionId are validated before they ever reach a path, so path
 * traversal cannot escape the store root.
 */
export function createFilesystemStore(root: string): PublishedGameStore {
  const versionPath = (gameId: string, versionId: string) =>
    path.join(root, gameId, "versions", `${versionId}.json`);
  const metaPath = (gameId: string) => path.join(root, gameId, "meta.json");

  const readMeta = async (gameId: string): Promise<PublishedGameMeta | null> => {
    try {
      const raw = await readFile(metaPath(gameId), "utf8");
      const parsed = JSON.parse(raw) as PublishedGameMeta;
      if (parsed?.gameId !== gameId || !VERSION_ID_PATTERN.test(parsed?.latestVersionId ?? "")) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const writeMetaAtomic = async (meta: PublishedGameMeta): Promise<void> => {
    const target = metaPath(meta.gameId);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
    await rename(tmp, target);
  };

  return {
    async publish(input) {
      assertSafeIds(input.gameId, input.versionId);
      const versionFile = versionPath(input.gameId, input.versionId);
      let existing: string | null = null;
      try {
        existing = await readFile(versionFile, "utf8");
      } catch {
        existing = null;
      }
      if (existing !== null && existing !== input.packJson) {
        throw new VersionConflictError(input.gameId, input.versionId);
      }

      const meta = (await readMeta(input.gameId)) ?? {
        gameId: input.gameId,
        latestVersionId: input.versionId,
        versions: [],
      };
      const created = existing === null;
      if (created) {
        // Atomic write: a reader never observes a half-written version file.
        await mkdir(path.dirname(versionFile), { recursive: true });
        const tmp = `${versionFile}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await writeFile(tmp, input.packJson, "utf8");
        await rename(tmp, versionFile);
      }
      if (!meta.versions.some((v) => v.versionId === input.versionId)) {
        meta.versions.push({
          versionId: input.versionId,
          title: input.title,
          sceneCount: input.sceneCount,
          publishedAt: new Date().toISOString(),
        });
      }
      // Latest always moves forward to the just-published version; the
      // version objects themselves stay immutable.
      meta.latestVersionId = input.versionId;
      await writeMetaAtomic(meta);
      return { created, meta };
    },

    async readVersion(gameId, versionId) {
      assertSafeIds(gameId, versionId);
      try {
        return await readFile(versionPath(gameId, versionId), "utf8");
      } catch {
        return null;
      }
    },

    readMeta,
  };
}

/**
 * Store selected for the current host. `PUBLISHED_GAMES_DIR` overrides the
 * location (a path, not a credential); the default lives inside the project
 * and is git-ignored.
 */
export function getStore(): PublishedGameStore {
  const dir = process.env.PUBLISHED_GAMES_DIR?.trim() || path.join(process.cwd(), ".published-games");
  return createFilesystemStore(dir);
}
