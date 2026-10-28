/**
 * Legacy import against the BLOB registry (synthetic Blob fake).
 *
 * Covers the B3 questions that the file-store import tests cannot:
 *   - import writes land in Blob-backed registry records,
 *   - a repeated apply against the blob registry stays a no-op (idempotent),
 *   - an interrupted import converges on the next run (skip_existing),
 *   - the legacy objects stay byte-identical (they are read from the file
 *     publish store and never written back).
 *
 * The Blob side is an in-memory fake of `@vercel/blob`; this verifies adapter
 * behaviour, not a real Blob container.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as importPost } from "@/app/api/admin/import-legacy/route";
import { GET as gamesGet } from "@/app/api/games/[gameId]/route";
import { validateGame } from "@/lib/game/types";
import type { Game, Scene } from "@/lib/game/types";
import { canonicalJson, deriveVersionId } from "@/lib/publish/version";
import { createFilesystemStore } from "@/lib/publish/storage";
import { getRegistry, resetRegistryForTests } from "@/lib/registry/store";
import {
  createUser,
  rawRequest,
  sessionCookieFor,
  setupRegistryEnv,
  type TestEnv,
} from "../helpers/registry";

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

let env: TestEnv;

beforeEach(async () => {
  blobState.reset();
  env = await setupRegistryEnv();
  // Route the registry to the (fake) Blob store; legacy objects stay on disk.
  process.env.REGISTRY_STORE = "blob";
  process.env.REGISTRY_BLOB_PREFIX = "import-blob-test";
  resetRegistryForTests();
});

afterEach(async () => {
  delete process.env.REGISTRY_STORE;
  delete process.env.REGISTRY_BLOB_PREFIX;
  resetRegistryForTests();
  await env.cleanup();
});

function scene(id: string): Scene {
  return {
    id,
    title: id.toUpperCase(),
    story: `story ${id}`,
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "text", question: "q", answer: ["go"] },
    reward: { type: "keyword", title: `kw-${id}`, value: `kw-${id}` },
  };
}

function game(id: string): Game {
  return {
    id,
    language: "zh-CN",
    title: "Blob 导入历史作品",
    description: "legacy fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "a",
    scenes: [scene("a")],
  };
}

async function seedLegacy(id: string): Promise<string> {
  const store = createFilesystemStore(process.env.PUBLISHED_GAMES_DIR!);
  const { game: valid } = validateGame(game(id));
  const versionId = await deriveVersionId(valid);
  await store.publish({
    gameId: id,
    versionId,
    title: valid.title,
    sceneCount: valid.scenes.length,
    packJson: canonicalJson(valid),
  });
  return versionId;
}

/** Byte snapshot of every legacy object on disk. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.set(path.relative(root, full), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return out;
}

async function importRequest(cookie: string, body: Record<string, unknown>) {
  return importPost(
    rawRequest("http://localhost/api/admin/import-legacy", {
      method: "POST",
      body: JSON.stringify(body),
      cookie,
    }),
  );
}

describe("legacy import against the blob registry (synthetic)", () => {
  it("lands records in blob storage and stays byte-identical on the objects", async () => {
    const versionId = await seedLegacy("blob-legacy-one");
    const before = await snapshotTree(process.env.PUBLISHED_GAMES_DIR!);

    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);
    const res = await importRequest(cookie, { apply: true });
    expect(res.status).toBe(200);
    const report = (await res.json()) as {
      applied: boolean;
      totals: { games: number; importPublished: number };
    };
    expect(report.applied).toBe(true);
    expect(report.totals.importPublished).toBe(1);

    // The record really is in the (fake) Blob store, not on the file registry.
    expect(env.root).toBeDefined();
    const workKeys = blobState.keys().filter((k) => k.includes("/works/"));
    expect(workKeys.some((k) => k.endsWith("/works/blob-legacy-one.json"))).toBe(true);
    expect(await getRegistry().getWork("blob-legacy-one")).toMatchObject({
      state: "published",
      publishedVersionId: versionId,
    });

    // Legacy objects untouched.
    expect(await snapshotTree(process.env.PUBLISHED_GAMES_DIR!)).toEqual(before);
  });

  it("a repeated apply is a no-op and an interrupted import converges", async () => {
    await seedLegacy("blob-legacy-two");
    await seedLegacy("blob-legacy-three");
    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    // Simulate an interrupted first run: only the first game is imported.
    await importRequest(cookie, { apply: true, limit: 1 });

    // The follow-up full run skips what exists and imports the rest.
    const res = await importRequest(cookie, { apply: true });
    const report = (await res.json()) as {
      totals: { games: number; importPublished: number; skipExisting: number };
    };
    expect(report.totals.skipExisting).toBe(1);
    expect(report.totals.importPublished).toBe(1);

    // A third full run changes nothing at all.
    const again = await importRequest(cookie, { apply: true });
    const final = (await again.json()) as {
      totals: { importPublished: number; skipExisting: number };
    };
    expect(final.totals.importPublished).toBe(0);
    expect(final.totals.skipExisting).toBe(2);
  });

  it("dry-run enumerates every action class, writes nothing, and public read follows state", async () => {
    // alpha: valid, imported by the limited first apply → skip_existing later.
    // beta:  valid, still waiting → import_published in the dry-run plan.
    // gamma: meta exists but the version object is missing → import_quarantined.
    await seedLegacy("blob-legacy-alpha");
    await seedLegacy("blob-legacy-beta");
    const gammaDir = path.join(process.env.PUBLISHED_GAMES_DIR!, "blob-legacy-gamma");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(gammaDir, "versions"), { recursive: true });
    await writeFile(
      path.join(gammaDir, "meta.json"),
      JSON.stringify({
        gameId: "blob-legacy-gamma",
        latestVersionId: "0123456789abcdef",
        versions: [
          { versionId: "0123456789abcdef", title: "x", sceneCount: 1, publishedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
      "utf8",
    );

    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    // Simulated interrupted first migration: only alpha lands.
    await importRequest(cookie, { apply: true, limit: 1 });
    const worksAfterFirst = blobState.keys().filter((k) => k.includes("/works/")).length;
    expect(worksAfterFirst).toBe(1);

    // Dry-run must enumerate ALL THREE classes and remain side-effect free.
    const dry = await importRequest(cookie, { apply: false });
    expect(dry.status).toBe(200);
    const dryReport = (await dry.json()) as {
      applied: boolean;
      games: { gameId: string; action: string }[];
    };
    expect(dryReport.applied).toBe(false);
    const actions = Object.fromEntries(dryReport.games.map((g) => [g.gameId, g.action]));
    expect(actions["blob-legacy-alpha"]).toBe("skip_existing");
    expect(actions["blob-legacy-beta"]).toBe("import_published");
    expect(actions["blob-legacy-gamma"]).toBe("import_quarantined");
    expect(blobState.keys().filter((k) => k.includes("/works/")).length).toBe(worksAfterFirst);

    // Real migration completes the rest.
    const full = await importRequest(cookie, { apply: true });
    const fullReport = (await full.json()) as {
      totals: { importPublished: number; importQuarantined: number; skipExisting: number };
    };
    expect(fullReport.totals).toMatchObject({
      importPublished: 1,
      importQuarantined: 1,
      skipExisting: 1,
    });

    // Public read rules after migration: published work serves the pack it
    // came from; the quarantined history stays invisible (404, same as absent).
    const getLatest = (gameId: string) =>
      gamesGet(new Request(`https://host.test/api/games/${gameId}`), {
        params: Promise.resolve({ gameId }),
      });
    expect((await getLatest("blob-legacy-beta")).status).toBe(200);
    expect((await getLatest("blob-legacy-gamma")).status).toBe(404);

    // Ownership lands on the suspended, password-less system account — a
    // real author can only take over via an explicit admin transfer_owner.
    const work = await getRegistry().getWork("blob-legacy-beta");
    expect(work).not.toBeNull();
    const owner = work && (await getRegistry().getUser(work.ownerUserId));
    expect(owner).toMatchObject({ status: "suspended", role: "creator" });
  });
});
