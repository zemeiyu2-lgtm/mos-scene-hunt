/**
 * Vercel Blob adapter for published games (serverization phase 1).
 *
 * Why: the filesystem adapter keeps data inside one instance's ephemeral
 * disk. On Vercel, published games would vanish on redeploy and never be
 * visible across serverless instances. This adapter stores the same layout
 * (`<prefix>/<gameId>/meta.json` + `<prefix>/<gameId>/versions/<vId>.json`)
 * in a Blob store, which is persistent and shared.
 *
 * Immutability: version objects are content-addressed. Before writing, the
 * existing object (if any) is downloaded and compared; identical content is
 * an idempotent no-op, different content throws {@link VersionConflictError}
 * - the version object is never overwritten.
 *
 * Known limitation (documented, not hidden): Blob has no compare-and-swap,
 * so the meta update is a read-merge-write cycle. Concurrent publishes from
 * *different* serverless instances can in a rare race drop a metadata entry
 * (the version object itself is always written first and stays readable via
 * its `?v=` link); within one process publishes are serialised by the lock
 * in `storage.ts`. Latest-pointer selection picks the entry with the newest
 * `publishedAt`, so an idempotent re-publish of an older version never drags
 * "latest" backwards.
 *
 * Credentials: the client resolves `BLOB_READ_WRITE_TOKEN` from the
 * environment itself. This module never reads, logs, or stores token values.
 * Select the adapter with `PUBLISHED_GAMES_STORE=blob` (see `getStore`).
 */

import { BlobNotFoundError, get, put } from "@vercel/blob";
import { resolveBlobPrefix } from "../storage/namespace-guard";
import { GAME_ID_PATTERN, VERSION_ID_PATTERN } from "./version";
import {
  VersionConflictError,
  type PublishInput,
  type PublishResult,
  type PublishedGameMeta,
  type PublishedGameStore,
} from "./storage";

export type { PublishedGameStore } from "./storage";

export interface VercelBlobStoreOptions {
  /** Root prefix for all keys inside the blob store. */
  prefix?: string;
}

export function createVercelBlobStore(options: VercelBlobStoreOptions = {}): PublishedGameStore {
  // Preview deployments share the production store, so the namespace must be
  // explicit there (see `lib/storage/namespace-guard.ts`). An injected prefix
  // (tests) bypasses the environment lookup entirely.
  const resolved =
    options.prefix ??
    resolveBlobPrefix({
      store: "published-games",
      prefix: process.env.PUBLISHED_GAMES_BLOB_PREFIX,
    });
  const prefix = resolved.replace(/^\/+|\/+$/g, "");

  const versionPath = (gameId: string, versionId: string) =>
    `${prefix}/${gameId}/versions/${versionId}.json`;
  const metaPath = (gameId: string) => `${prefix}/${gameId}/meta.json`;

  /** Downloads one blob as text; null when it does not exist. */
  const readText = async (pathname: string, fresh = false): Promise<string | null> => {
    try {
      const result = fresh
        ? await get(pathname, { access: "private", useCache: false })
        : await get(pathname, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      return await new Response(result.stream).text();
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  };

  const readMeta = async (gameId: string): Promise<PublishedGameMeta | null> => {
    if (!GAME_ID_PATTERN.test(gameId)) {
      throw new Error(`gameId 不合法：${gameId}`);
    }
    try {
      // Origin read: the latest pointer must not be served stale by the CDN.
      const result = await get(metaPath(gameId), { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return null;
      let parsed: PublishedGameMeta;
      try {
        parsed = JSON.parse(await new Response(result.stream).text()) as PublishedGameMeta;
      } catch {
        // A corrupt meta must degrade to "never published", like the
        // filesystem adapter, and must be repairable by the next publish.
        return null;
      }
      if (parsed?.gameId !== gameId || !VERSION_ID_PATTERN.test(parsed?.latestVersionId ?? "")) {
        return null;
      }
      if (!Array.isArray(parsed.versions)) return null;
      return parsed;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  };

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      if (!GAME_ID_PATTERN.test(input.gameId)) {
        throw new Error(`gameId 不合法：${input.gameId}`);
      }
      if (!VERSION_ID_PATTERN.test(input.versionId)) {
        throw new Error(`versionId 不合法：${input.versionId}`);
      }

      const versionKey = versionPath(input.gameId, input.versionId);
      let existedBefore = (await readText(versionKey)) !== null;
      if (existedBefore) {
        const stored = await readText(versionKey, true);
        if (stored !== null && stored !== input.packJson) {
          throw new VersionConflictError(input.gameId, input.versionId);
        }
      }
      if (!existedBefore) {
        // Content-addressed: once written, never rewritten. Vercel Blob itself
        // refuses overwrites of an existing pathname, which gives the
        // immutability contract platform-level enforcement; a raced identical
        // write is folded into the idempotent path below.
        try {
          await put(versionKey, input.packJson, {
            access: "private",
            addRandomSuffix: false,
            contentType: "application/json; charset=utf-8",
            cacheControlMaxAge: 31536000,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/already exists/i.test(message)) throw error;
          // Another instance wrote this content-addressed object first.
          // Compare against fresh origin content: identical means the raced
          // publish was the same version (idempotent), anything else is a
          // genuine immutability conflict.
          const stored = await readText(versionKey, true);
          if (stored === input.packJson) {
            existedBefore = true;
          } else {
            throw new VersionConflictError(input.gameId, input.versionId);
          }
        }
      }

      const meta = (await readMeta(input.gameId)) ?? {
        gameId: input.gameId,
        latestVersionId: input.versionId,
        versions: [],
      };
      if (!meta.versions.some((v) => v.versionId === input.versionId)) {
        meta.versions.push({
          versionId: input.versionId,
          title: input.title,
          sceneCount: input.sceneCount,
          publishedAt: new Date().toISOString(),
        });
      }
      // Newest publish wins the latest pointer; re-publishing an older
      // version keeps its original timestamp and cannot drag latest back.
      // `>=` breaks same-millisecond ties in favour of the later publish
      // (entries are appended in publish order).
      const newest = meta.versions.reduce((a, b) => (b.publishedAt >= a.publishedAt ? b : a));
      meta.latestVersionId = newest.versionId;
      // The meta object is a mergeable pointer, not an immutable version
      // object: it is rewritten on every publish, so it must allow overwrite.
      // Last-write-wins applies across instances (see the module note).
      await put(metaPath(input.gameId), JSON.stringify(meta, null, 2), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json; charset=utf-8",
        cacheControlMaxAge: 0,
        allowOverwrite: true,
      });
      return { created: !existedBefore, meta };
    },

    async readVersion(gameId: string, versionId: string): Promise<string | null> {
      if (!GAME_ID_PATTERN.test(gameId)) {
        throw new Error(`gameId 不合法：${gameId}`);
      }
      if (!VERSION_ID_PATTERN.test(versionId)) {
        throw new Error(`versionId 不合法：${versionId}`);
      }
      return readText(versionPath(gameId, versionId));
    },

    readMeta,
  };
}
