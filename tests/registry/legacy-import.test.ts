/**
 * Legacy import tests.
 *
 * The import is the one operation that can put historical content back in
 * front of players, so every test here is really about a refusal:
 *   - dry run must write nothing,
 *   - a non-admin must be refused,
 *   - a second run must not overwrite or duplicate,
 *   - a pack that no longer matches its version id must stay quarantined,
 *   - the legacy objects themselves must be byte-identical afterwards.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as importPost } from "@/app/api/admin/import-legacy/route";
import { GET as gamesGet } from "@/app/api/games/[gameId]/route";
import { validateGame } from "@/lib/game/types";
import type { Game, Scene } from "@/lib/game/types";
import { canonicalJson, deriveVersionId } from "@/lib/publish/version";
import { createFilesystemStore } from "@/lib/publish/storage";
import { getRegistry } from "@/lib/registry/store";
import {
  createUser,
  rawRequest,
  sessionCookieFor,
  setupRegistryEnv,
  type TestEnv,
} from "../helpers/registry";

let env: TestEnv;

beforeEach(async () => {
  env = await setupRegistryEnv();
});

afterEach(async () => {
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

function game(id: string, title = "Legacy Hunt"): Game {
  return {
    id,
    language: "zh-CN",
    title,
    description: "legacy fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "a",
    scenes: [scene("a")],
  };
}

/** Write a game the way the pre-registry publish endpoint did. */
async function seedLegacy(id: string, title = "Legacy Hunt"): Promise<string> {
  const dir = process.env.PUBLISHED_GAMES_DIR!;
  const store = createFilesystemStore(dir);
  const { game: valid } = validateGame(game(id, title));
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

function importRequest(cookie: string | undefined, body: unknown): Promise<Response> {
  return importPost(
    rawRequest("https://host.test/api/admin/import-legacy", {
      body: JSON.stringify(body),
      cookie,
    }),
  );
}

const getLatest = (gameId: string) =>
  gamesGet(new Request(`https://host.test/api/games/${gameId}`), {
    params: Promise.resolve({ gameId }),
  });

async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await snapshotTree(full));
    } else {
      result[path.relative(dir, full)] = await readFile(full, "utf8");
    }
  }
  return result;
}

describe("legacy import", () => {
  it("refuses a reviewer: importing is a publish-class action", async () => {
    const reviewer = await createUser({ email: "rev@test.local", role: "reviewer" });
    const cookie = await sessionCookieFor(reviewer);
    const res = await importRequest(cookie, {});
    expect(res.status).toBe(403);
  });

  it("refuses anonymous callers", async () => {
    const res = await importRequest(undefined, {});
    expect(res.status).toBe(401);
  });

  it("dry run reports the plan and writes nothing at all", async () => {
    await seedLegacy("legacy-one", "历史作品一");
    const before = await snapshotTree(process.env.PUBLISHED_GAMES_DIR!);
    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    const res = await importRequest(cookie, {});
    expect(res.status).toBe(200);
    const report = (await res.json()) as {
      applied: boolean;
      totals: { games: number; importPublished: number };
      games: { gameId: string; action: string }[];
    };
    expect(report.applied).toBe(false);
    expect(report.totals.games).toBe(1);
    expect(report.totals.importPublished).toBe(1);
    expect(report.games[0].action).toBe("import_published");

    // No registry work was created…
    expect(await getRegistry().getWork("legacy-one")).toBeNull();
    // …and the legacy objects are byte-identical.
    expect(await snapshotTree(process.env.PUBLISHED_GAMES_DIR!)).toEqual(before);
  });

  it("apply publishes the historical version and leaves the objects untouched", async () => {
    const versionId = await seedLegacy("legacy-two", "历史作品二");
    const before = await snapshotTree(process.env.PUBLISHED_GAMES_DIR!);
    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    const res = await importRequest(cookie, { apply: true });
    expect(res.status).toBe(200);

    const work = await getRegistry().getWork("legacy-two");
    expect(work?.state).toBe("published");
    expect(work?.publishedVersionId).toBe(versionId);
    // Ownership goes to the non-loginable holder, never to the admin who ran it.
    expect(work?.ownerUserId).not.toBe(admin.id);

    const publicRead = await getLatest("legacy-two");
    expect(publicRead.status).toBe(200);
    expect(await snapshotTree(process.env.PUBLISHED_GAMES_DIR!)).toEqual(before);
  });

  it("a second apply is a no-op, not an overwrite", async () => {
    await seedLegacy("legacy-three");
    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);

    await importRequest(cookie, { apply: true });
    const first = await getRegistry().getWork("legacy-three");
    const second = await importRequest(cookie, { apply: true });
    const report = (await second.json()) as {
      totals: { skipExisting: number; importPublished: number };
    };
    const after = await getRegistry().getWork("legacy-three");
    expect(report.totals.skipExisting).toBe(1);
    expect(report.totals.importPublished).toBe(0);
    expect(after?.revision).toBe(first?.revision);
    expect(after?.createdAt).toBe(first?.createdAt);
  });

  it("quarantines a pack whose bytes no longer match its version id", async () => {
    const versionId = await seedLegacy("legacy-four", "历史作品四");
    // Corrupt the stored bytes without touching meta.json: the directory now
    // claims a version id that the content no longer hashes to.
    const target = path.join(process.env.PUBLISHED_GAMES_DIR!, "legacy-four", "versions", `${versionId}.json`);
    const tampered = JSON.parse(await readFile(target, "utf8")) as Game;
    tampered.title = "被改过的标题";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(target, JSON.stringify(tampered), "utf8");

    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);
    await importRequest(cookie, { apply: true });

    const work = await getRegistry().getWork("legacy-four");
    // History is kept — but nothing unverified becomes publicly readable.
    expect(work).not.toBeNull();
    expect(work?.state).toBe("draft");
    expect(work?.publishedVersionId).toBeNull();
    expect(work?.versions[0]?.versionId).toBe(versionId);
    expect((await getLatest("legacy-four")).status).toBe(404);
  });

  it("keeps a work quarantined when meta.json exists but no version does", async () => {
    const dir = path.join(process.env.PUBLISHED_GAMES_DIR!, "legacy-five");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(dir, "versions"), { recursive: true });
    await writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify({
        gameId: "legacy-five",
        latestVersionId: "0123456789abcdef",
        versions: [{ versionId: "0123456789abcdef", title: "x", sceneCount: 1, publishedAt: "2026-01-01T00:00:00.000Z" }],
      }),
      "utf8",
    );

    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    const cookie = await sessionCookieFor(admin);
    const res = await importRequest(cookie, { apply: true });
    const report = (await res.json()) as { totals: { importQuarantined: number } };
    expect(report.totals.importQuarantined).toBe(1);

    const work = await getRegistry().getWork("legacy-five");
    expect(work?.state).toBe("draft");
    expect(work?.publishedVersionId).toBeNull();
  });
});

/**
 * `only` whitelist tests: the whitelist must take effect BEFORE any
 * processing/writing, must fail closed on any malformed input, and must never
 * change the default (no `only`) behavior. All runs use the isolated local
 * file registry + local published dir from `setupRegistryEnv` — nothing here
 * can touch production data.
 */
describe("legacy import — only whitelist", () => {
  // Seeds three games; "zzz-seminary-lab" sorts LAST on purpose so selecting
  // it proves the whitelist is not just a prefix/limit cut.
  async function seedThree(): Promise<void> {
    await seedLegacy("alpha-one", "甲");
    await seedLegacy("mid-two", "乙");
    await seedLegacy("zzz-seminary-lab", "丙");
  }

  async function adminCookie(): Promise<string> {
    const admin = await createUser({ email: "admin@test.local", role: "admin" });
    return sessionCookieFor(admin);
  }

  it("selects exactly one game and writes only it", async () => {
    await seedThree();
    const before = await snapshotTree(process.env.PUBLISHED_GAMES_DIR!);
    const cookie = await adminCookie();

    const res = await importRequest(cookie, { apply: true, only: ["zzz-seminary-lab"] });
    expect(res.status).toBe(200);
    const report = (await res.json()) as {
      applied: boolean;
      only: string[] | null;
      totals: { games: number; importPublished: number };
      games: { gameId: string }[];
    };
    expect(report.applied).toBe(true);
    expect(report.only).toEqual(["zzz-seminary-lab"]);
    expect(report.totals.games).toBe(1);
    expect(report.games.map((g) => g.gameId)).toEqual(["zzz-seminary-lab"]);

    // Only the whitelisted work exists; the excluded two are untouched.
    expect(await getRegistry().getWork("zzz-seminary-lab")).not.toBeNull();
    expect(await getRegistry().getWork("alpha-one")).toBeNull();
    expect(await getRegistry().getWork("mid-two")).toBeNull();
    expect(await snapshotTree(process.env.PUBLISHED_GAMES_DIR!)).toEqual(before);
  });

  it("selects both official candidates in one run, excluding the rest", async () => {
    await seedThree();
    const cookie = await adminCookie();

    const res = await importRequest(cookie, { apply: true, only: ["alpha-one", "zzz-seminary-lab"] });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { totals: { games: number; importPublished: number }; games: { gameId: string }[] };
    expect(report.totals.games).toBe(2);
    expect(report.totals.importPublished).toBe(2);
    expect(report.games.map((g) => g.gameId).sort()).toEqual(["alpha-one", "zzz-seminary-lab"]);

    expect(await getRegistry().getWork("alpha-one")).not.toBeNull();
    expect(await getRegistry().getWork("zzz-seminary-lab")).not.toBeNull();
    expect(await getRegistry().getWork("mid-two")).toBeNull();
  });

  it("dry run with only reports just the selection and writes nothing", async () => {
    await seedThree();
    const before = await snapshotTree(process.env.PUBLISHED_GAMES_DIR!);
    const cookie = await adminCookie();

    const res = await importRequest(cookie, { only: ["mid-two"] });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { applied: boolean; totals: { games: number }; games: { gameId: string }[] };
    expect(report.applied).toBe(false);
    expect(report.totals.games).toBe(1);
    expect(report.games[0]?.gameId).toBe("mid-two");

    for (const id of ["alpha-one", "mid-two", "zzz-seminary-lab"]) {
      expect(await getRegistry().getWork(id)).toBeNull();
    }
    expect(await snapshotTree(process.env.PUBLISHED_GAMES_DIR!)).toEqual(before);
  });

  it.each([
    ["unknown id", ["nope-not-here"]],
    ["invalid id format", ["../escape"]],
    ["duplicated ids", ["alpha-one", "alpha-one"]],
    ["empty array", []],
    ["non-array value", "alpha-one"],
    ["non-string entry", [42]],
  ])("fails closed on %s — never degrades to a full import", async (_label, only) => {
    await seedThree();
    const before = await snapshotTree(process.env.PUBLISHED_GAMES_DIR!);
    const cookie = await adminCookie();

    const res = await importRequest(cookie, { apply: true, only: only as unknown });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_only");

    // Nothing was written: no works, no legacy object touched.
    for (const id of ["alpha-one", "mid-two", "zzz-seminary-lab"]) {
      expect(await getRegistry().getWork(id)).toBeNull();
    }
    expect(await snapshotTree(process.env.PUBLISHED_GAMES_DIR!)).toEqual(before);
  });

  it("keeps the default behavior when only is absent", async () => {
    await seedThree();
    const cookie = await adminCookie();

    const res = await importRequest(cookie, {});
    expect(res.status).toBe(200);
    const report = (await res.json()) as { only: string[] | null; totals: { games: number } };
    expect(report.only).toBeNull();
    expect(report.totals.games).toBe(3);
  });

  it("applies limit to the whitelisted selection, not the raw listing", async () => {
    await seedThree();
    const cookie = await adminCookie();

    const res = await importRequest(cookie, { apply: true, only: ["alpha-one", "mid-two"], limit: 1 });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { totals: { games: number }; games: { gameId: string }[] };
    expect(report.totals.games).toBe(1);
    expect(report.games[0]?.gameId).toBe("alpha-one");
    expect(await getRegistry().getWork("alpha-one")).not.toBeNull();
    expect(await getRegistry().getWork("mid-two")).toBeNull();
  });
});
