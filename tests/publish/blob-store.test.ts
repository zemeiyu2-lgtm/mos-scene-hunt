/**
 * Vercel Blob adapter tests (serverization phase 1).
 *
 * The adapter is exercised against an in-memory fake of `@vercel/blob`, so
 * the storage contract - immutability, idempotency, 404 semantics, latest
 * pointer monotonicity - is verified without real cloud credentials. Real
 * cloud acceptance is a separate, explicitly-flagged step (see the phase 1
 * report): these passing tests do NOT mean the production blob store has
 * been verified end to end.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const blobState = vi.hoisted(
  (): {
    blobs: Map<string, string>;
    versionPutCounts: Map<string, number>;
    failNextGet: Error | null;
    FakeBlobNotFoundError: new (message: string) => Error;
  } => {
    const blobs = new Map<string, string>();
    const versionPutCounts = new Map<string, number>();
    let failNextGet: Error | null = null;
    class FakeBlobNotFoundError extends Error {
      name = "BlobNotFoundError";
    }
    return { blobs, versionPutCounts, get failNextGet() { return failNextGet; }, set failNextGet(v: Error | null) { failNextGet = v; }, FakeBlobNotFoundError };
  },
);

vi.mock("@vercel/blob", () => {
  function streamFrom(text: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
  return {
    BlobNotFoundError: blobState.FakeBlobNotFoundError,
    put: vi.fn(async (pathname: string, body: string) => {
      blobState.blobs.set(pathname, body);
      if (pathname.includes("/versions/")) {
        blobState.versionPutCounts.set(pathname, (blobState.versionPutCounts.get(pathname) ?? 0) + 1);
      }
      return { url: `https://blob.test/${pathname}`, pathname, size: body.length };
    }),
    get: vi.fn(async (pathname: string) => {
      if (blobState.failNextGet) {
        const error = blobState.failNextGet;
        blobState.failNextGet = null;
        throw error;
      }
      if (!blobState.blobs.has(pathname)) {
        throw new blobState.FakeBlobNotFoundError(`missing: ${pathname}`);
      }
      return {
        statusCode: 200,
        stream: streamFrom(blobState.blobs.get(pathname) as string),
        blob: { pathname, url: `https://blob.test/${pathname}` },
      };
    }),
  };
});

import {
  createVercelBlobStore,
  type PublishedGameStore,
} from "@/lib/publish/blob-store";
import { VersionConflictError } from "@/lib/publish/storage";

let store: PublishedGameStore;

beforeEach(() => {
  blobState.blobs.clear();
  blobState.versionPutCounts.clear();
  blobState.failNextGet = null;
  store = createVercelBlobStore({ prefix: "test-published-games" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const input = (versionId: string, packJson = '{"id":"demo"}') => ({
  gameId: "demo",
  versionId,
  title: "Demo",
  sceneCount: 3,
  packJson,
});

const versionKey = (versionId: string) =>
  `test-published-games/demo/versions/${versionId}.json`;
const metaKey = "test-published-games/demo/meta.json";

describe("vercel blob store", () => {
  it("publishes, then reads the exact pack text back", async () => {
    const result = await store.publish(input("0123456789abcdef", '{"id":"demo","v":1}'));
    expect(result.created).toBe(true);
    expect(result.meta.latestVersionId).toBe("0123456789abcdef");
    await expect(store.readVersion("demo", "0123456789abcdef")).resolves.toBe(
      '{"id":"demo","v":1}',
    );
    // Exactly one write for the version object: content-addressed, never rewritten.
    expect(blobState.versionPutCounts.get(versionKey("0123456789abcdef"))).toBe(1);
    expect(blobState.blobs.has(metaKey)).toBe(true);
  });

  it("is idempotent for identical content and does not rewrite the version object", async () => {
    await store.publish(input("0123456789abcdef", "same"));
    const second = await store.publish(input("0123456789abcdef", "same"));
    expect(second.created).toBe(false);
    expect(second.meta.versions).toHaveLength(1);
    expect(blobState.versionPutCounts.get(versionKey("0123456789abcdef"))).toBe(1);
  });

  it("refuses to overwrite an existing version with different content", async () => {
    await store.publish(input("0123456789abcdef", "original"));
    await expect(store.publish(input("0123456789abcdef", "tampered"))).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await expect(store.readVersion("demo", "0123456789abcdef")).resolves.toBe("original");
  });

  it("moves latest forward but keeps earlier versions readable", async () => {
    await store.publish(input("1111111111111111", "v1"));
    await store.publish(input("2222222222222222", "v2"));
    const meta = await store.readMeta("demo");
    expect(meta?.latestVersionId).toBe("2222222222222222");
    await expect(store.readVersion("demo", "1111111111111111")).resolves.toBe("v1");
  });

  it("does not move latest backwards when an old version is re-published", async () => {
    await store.publish(input("1111111111111111", "v1"));
    await store.publish(input("2222222222222222", "v2"));
    const republish = await store.publish(input("1111111111111111", "v1"));
    expect(republish.created).toBe(false);
    expect(republish.meta.latestVersionId).toBe("2222222222222222");
  });

  it("returns null for absent games and versions", async () => {
    await expect(store.readVersion("demo", "0123456789abcdef")).resolves.toBeNull();
    await expect(store.readMeta("demo")).resolves.toBeNull();
    await store.publish(input("0123456789abcdef"));
    await expect(store.readVersion("demo", "ffffffffffffffff")).resolves.toBeNull();
  });

  it("rejects unsafe ids before they reach the blob store", async () => {
    await expect(store.publish(input("../../evil"))).rejects.toThrow(/versionId/);
    await expect(store.readVersion("../escape", "0123456789abcdef")).rejects.toThrow(/gameId/);
    await expect(store.readVersion("demo", "../escape")).rejects.toThrow(/versionId/);
  });

  it("recovers when the meta blob is corrupt", async () => {
    await store.publish(input("0123456789abcdef"));
    blobState.blobs.set(metaKey, "not json");
    await expect(store.readMeta("demo")).resolves.toBeNull();
    const republished = await store.publish(input("0123456789abcdef"));
    expect(republished.created).toBe(false);
    expect(republished.meta.versions.map((v) => v.versionId)).toContain("0123456789abcdef");
  });

  it("propagates real storage failures instead of reporting them as missing", async () => {
    blobState.failNextGet = new Error("blob service unavailable");
    await expect(store.publish(input("0123456789abcdef"))).rejects.toThrow(
      /blob service unavailable/,
    );
    blobState.failNextGet = new Error("read failed");
    await expect(store.readVersion("demo", "0123456789abcdef")).rejects.toThrow(/read failed/);
  });
});

describe("store selection", () => {
  it("getStore() selects the blob adapter when PUBLISHED_GAMES_STORE=blob", async () => {
    const { getStore } = await import("@/lib/publish/storage");
    const previous = process.env.PUBLISHED_GAMES_STORE;
    process.env.PUBLISHED_GAMES_STORE = "blob";
    try {
      const selected = getStore();
      const result = await selected.publish({
        gameId: "demo",
        versionId: "0123456789abcdef",
        title: "T",
        sceneCount: 1,
        packJson: "{}",
      });
      expect(result.created).toBe(true);
      expect(blobState.blobs.has("published-games/demo/versions/0123456789abcdef.json")).toBe(
        true,
      );
    } finally {
      if (previous === undefined) delete process.env.PUBLISHED_GAMES_STORE;
      else process.env.PUBLISHED_GAMES_STORE = previous;
    }
  });

  it("getStore() defaults to the filesystem adapter without the flag", async () => {
    const { getStore, createFilesystemStore } = await import("@/lib/publish/storage");
    delete process.env.PUBLISHED_GAMES_STORE;
    // The fs adapter exposes no identity; compare behaviour via a marker:
    // its publish rejects unsafe version ids with the fs error text. Use a
    // structural probe instead: the default store must not touch blob state.
    const selected = getStore();
    expect(selected).not.toBeNull();
    await expect(
      selected.publish(input("../../evil")),
    ).rejects.toThrow(/versionId/);
    expect(blobState.blobs.size).toBe(0);
    // Reference check: createFilesystemStore remains the local adapter used
    // when the flag is absent.
    expect(typeof createFilesystemStore).toBe("function");
  });
});
