/**
 * Filesystem published-game store tests (serverization batch 1).
 *
 * The immutability contract is the core guarantee under test: an existing
 * version object is never replaced by different content, identical content is
 * an idempotent no-op, and reads of absent ids return null (mapped to 404 by
 * the API layer).
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFilesystemStore,
  VersionConflictError,
  type PublishedGameStore,
} from "@/lib/publish/storage";

let root: string;
let store: PublishedGameStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mos-publish-"));
  store = createFilesystemStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const input = (versionId: string, packJson = '{"id":"demo"}') => ({
  gameId: "demo",
  versionId,
  title: "Demo",
  sceneCount: 3,
  packJson,
});

describe("filesystem store", () => {
  it("publishes, then reads the exact pack text back", async () => {
    const result = await store.publish(input("0123456789abcdef", '{"id":"demo","v":1}'));
    expect(result.created).toBe(true);
    expect(result.meta.latestVersionId).toBe("0123456789abcdef");
    await expect(store.readVersion("demo", "0123456789abcdef")).resolves.toBe(
      '{"id":"demo","v":1}',
    );
  });

  it("is idempotent for identical content and tracks the version once", async () => {
    await store.publish(input("0123456789abcdef", "same"));
    const second = await store.publish(input("0123456789abcdef", "same"));
    expect(second.created).toBe(false);
    expect(second.meta.versions).toHaveLength(1);
  });

  it("refuses to overwrite an existing version with different content", async () => {
    await store.publish(input("0123456789abcdef", "original"));
    await expect(store.publish(input("0123456789abcdef", "tampered"))).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    // The original content is untouched.
    await expect(store.readVersion("demo", "0123456789abcdef")).resolves.toBe("original");
  });

  it("moves latest forward but keeps earlier versions readable", async () => {
    await store.publish(input("1111111111111111", "v1"));
    await store.publish(input("2222222222222222", "v2"));
    const meta = await store.readMeta("demo");
    expect(meta?.latestVersionId).toBe("2222222222222222");
    await expect(store.readVersion("demo", "1111111111111111")).resolves.toBe("v1");
  });

  it("returns null for absent games and versions", async () => {
    await expect(store.readVersion("demo", "0123456789abcdef")).resolves.toBeNull();
    await expect(store.readMeta("demo")).resolves.toBeNull();
    await store.publish(input("0123456789abcdef"));
    await expect(store.readVersion("demo", "ffffffffffffffff")).resolves.toBeNull();
  });

  it("rejects unsafe ids before they reach the filesystem", async () => {
    await expect(store.publish(input("../../evil"))).rejects.toThrow(/versionId/);
    await expect(store.readVersion("../escape", "0123456789abcdef")).rejects.toThrow(/gameId/);
    await expect(store.readVersion("demo", "../escape")).rejects.toThrow(/versionId/);
  });

  it("recovers when a meta file is corrupt or foreign", async () => {
    await store.publish(input("0123456789abcdef"));
    // Corrupt meta must not crash reads or later publishes.
    await writeFile(path.join(root, "demo", "meta.json"), "not json", "utf8");
    await expect(store.readMeta("demo")).resolves.toBeNull();
    const republished = await store.publish(input("0123456789abcdef"));
    expect(republished.created).toBe(false);
    expect(republished.meta.versions.map((v) => v.versionId)).toContain("0123456789abcdef");
  });
});
