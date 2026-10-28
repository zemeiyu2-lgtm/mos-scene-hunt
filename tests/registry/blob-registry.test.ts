/**
 * Registry storage adapter parity tests: file store vs Vercel Blob store.
 *
 * The Blob adapter is exercised against an in-memory fake of `@vercel/blob`
 * implementing the same contract the SDK documents: `put` refuses to overwrite
 * unless `allowOverwrite`, `get` throws `BlobNotFoundError` for missing keys,
 * and `list` pages with `cursor`/`hasMore`. The fake also caps every page at 2
 * entries so the adapter's explicit-pagination loop is actually exercised.
 *
 * These are SYNTHETIC tests: they verify that both adapters behave the same,
 * not that a real Blob container behaves the same. Real-cloud acceptance
 * remains a separate, credential-gated step.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord, UserRecord, WorkRecord } from "@/lib/registry/types";
import { createBlobRegistry, createFileRegistry } from "@/lib/registry/store";
import type { RegistryStore } from "@/lib/registry/store";
import { fakeBlobModule } from "../helpers/vercel-blob-fake";

/* ------------------------------------------------------------------ */
/* In-memory fake of @vercel/blob (shared helper)                      */
/* ------------------------------------------------------------------ */

const blobState = vi.hoisted(() => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    reset: () => blobs.clear(),
    keys: () => [...blobs.keys()].sort(),
  };
});

vi.mock("@vercel/blob", async () => {
  const { fakeBlobModule } = await import("../helpers/vercel-blob-fake");
  return fakeBlobModule(blobState);
});

/* ------------------------------------------------------------------ */
/* Shared fixtures                                                     */
/* ------------------------------------------------------------------ */

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  const now = "2026-10-29T00:00:00.000Z";
  return {
    id: overrides.id ?? "11111111-2222-4333-8444-555555555555",
    email: overrides.email ?? "creator@example.com",
    passwordHash: "hash",
    passwordSalt: "salt",
    displayName: "Creator",
    role: "creator",
    status: "active",
    createdAt: now,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    ...overrides,
  };
}

function makeWork(overrides: Partial<WorkRecord> = {}): WorkRecord {
  const now = "2026-10-29T00:00:00.000Z";
  return {
    schemaVersion: 1,
    gameId: overrides.gameId ?? "e2e-parity-hunt",
    ownerUserId: "11111111-2222-4333-8444-555555555555",
    state: "draft",
    title: "Parity Hunt",
    publishedVersionId: null,
    latestVersionId: null,
    versions: [],
    submissions: [],
    reviews: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as WorkRecord;
}

function makeAudit(id: string, createdAt: string): AuditRecord {
  return {
    id,
    actorUserId: "11111111-2222-4333-8444-555555555555",
    actorRole: "admin",
    action: "work.publish",
    targetType: "work",
    targetId: "e2e-parity-hunt",
    before: null,
    after: { state: "published" },
    ipHash: "ip",
    uaHash: "ua",
    createdAt,
  };
}

/** The identical behavioural scenario run against each adapter. */
async function runScenario(store: RegistryStore): Promise<void> {
  // --- users --------------------------------------------------------
  expect(await store.getUser("11111111-2222-4333-8444-555555555555")).toBeNull();

  const put = await store.putUser(makeUser());
  expect(put.ok).toBe(true);
  expect((await store.getUser("11111111-2222-4333-8444-555555555555"))?.email).toBe(
    "creator@example.com",
  );

  // Callers store emails already lowercased; the lookup normalizes the query.
  const second = makeUser({
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    email: "second@example.com",
    createdAt: "2026-10-29T01:00:00.000Z",
  });
  await store.putUser(second);
  expect((await store.getUserByEmail("SECOND@Example.COM"))?.id).toBe(second.id);

  // Malformed ids are rejected before touching storage.
  await expect(store.getUser("../escape")).resolves.toBeNull();
  await expect(store.putUser(makeUser({ id: "../escape" }))).rejects.toThrow();

  // Sorted by creation time.
  const users = await store.listUsers();
  expect(users.map((u) => u.id)).toEqual([
    "11111111-2222-4333-8444-555555555555",
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  ]);

  // --- sessions -----------------------------------------------------
  const session = {
    tokenHash: "a".repeat(64),
    userId: "11111111-2222-4333-8444-555555555555",
    role: "creator" as const,
    ipHash: "ip",
    uaHash: "ua",
    createdAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    revokedAt: null,
  };
  expect((await store.putSession(session)).ok).toBe(true);
  expect((await store.getSession(session.tokenHash))?.userId).toBe(
    "11111111-2222-4333-8444-555555555555",
  );
  // The adapter marks revocation; the session layer treats revokedAt as invalid.
  await store.revokeSession(session.tokenHash, "2026-10-29T02:00:00.000Z");
  const revoked = await store.getSession(session.tokenHash);
  expect(revoked?.revokedAt).toBe("2026-10-29T02:00:00.000Z");
  // Revoking an unknown session is a no-op, not an error.
  await expect(store.revokeSession("b".repeat(64), "2026-10-29T02:00:00.000Z")).resolves.toBeUndefined();

  // --- works: create-only + optimistic concurrency -------------------
  expect(await store.getWork("e2e-parity-hunt")).toBeNull();
  expect((await store.createWork(makeWork())).ok).toBe(true);
  // Second create with the same id must lose.
  expect(await store.createWork(makeWork({ ownerUserId: "other" }))).toEqual({
    ok: false,
    conflict: true,
  });

  const stored = await store.getWork("e2e-parity-hunt");
  expect(stored?.state).toBe("draft");

  // First writer with expectedRevision=0 wins (stored revision is 0).
  const next = { ...makeWork(), state: "in_review" as const, revision: 1 };
  expect((await store.putWork(next, 0)).ok).toBe(true);
  expect((await store.getWork("e2e-parity-hunt"))?.state).toBe("in_review");

  // A second writer still claiming expectedRevision=0 must lose: the stored
  // revision moved to 1. The losing payload must not replace the winner.
  const stale = makeWork({ state: "published", revision: 1 });
  expect(await store.putWork(stale, 0)).toEqual({ ok: false, conflict: true });
  expect((await store.getWork("e2e-parity-hunt"))?.state).toBe("in_review");

  // The winner advances with the matching expected revision.
  const published = { ...makeWork(), state: "published" as const, revision: 2 };
  expect((await store.putWork(published, 1)).ok).toBe(true);
  expect((await store.getWork("e2e-parity-hunt"))?.state).toBe("published");

  // putWork on a missing work is a conflict, not a create.
  expect(await store.putWork(makeWork({ gameId: "e2e-parity-missing" }), 0)).toEqual({
    ok: false,
    conflict: true,
  });

  // Corrupt/mismatched stored payload is treated as absent, not thrown.
  expect(await store.getWork("../escape")).toBeNull();

  const works = await store.listWorks();
  expect(works.map((w) => w.gameId)).toContain("e2e-parity-hunt");

  // --- audit ---------------------------------------------------------
  await store.appendAudit(makeAudit("a1", "2026-10-29T00:00:01.000Z"));
  await store.appendAudit(makeAudit("a2", "2026-10-29T00:00:02.000Z"));
  await store.appendAudit(makeAudit("a3", "2026-10-29T00:00:03.000Z"));
  const audit = await store.listAudit(2);
  expect(audit.map((r) => r.id)).toEqual(["a3", "a2"]);
}

/* ------------------------------------------------------------------ */
/* The same scenario against both adapters                             */
/* ------------------------------------------------------------------ */

describe("registry adapter parity: file vs blob (synthetic blob)", () => {
  let fileRoot: string;

  beforeEach(async () => {
    blobState.reset();
    fileRoot = await mkdtemp(path.join(tmpdir(), "mos-parity-file-"));
  });

  afterEach(async () => {
    await rm(fileRoot, { recursive: true, force: true });
  });

  it("file store passes the shared scenario", async () => {
    await runScenario(createFileRegistry(fileRoot));
  });

  it("blob store passes the identical scenario (incl. forced 2-per-page listing)", async () => {
    await runScenario(createBlobRegistry("parity-test"));
  });
});
