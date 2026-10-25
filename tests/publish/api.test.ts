/**
 * Publish / read API route tests (serverization batch 1).
 *
 * Route handlers are invoked directly with standard Request objects against a
 * temporary store directory (PUBLISHED_GAMES_DIR), so the HTTP contract -
 * status codes, immutability, 404s, size and format guards - is tested for
 * real without a running server.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/publish/route";
import { GET } from "@/app/api/games/[gameId]/route";
import { validateGame } from "@/lib/game/types";
import { deriveVersionId } from "@/lib/publish/version";
import type { Game, Scene } from "@/lib/game/types";

let storeDir: string;

beforeEach(async () => {
  storeDir = await mkdtemp(path.join(tmpdir(), "mos-publish-api-"));
  process.env.PUBLISHED_GAMES_DIR = storeDir;
});

afterEach(async () => {
  delete process.env.PUBLISHED_GAMES_DIR;
  await rm(storeDir, { recursive: true, force: true });
});

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: id.toUpperCase(),
    story: `story ${id}`,
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "text", question: "q", answer: ["go"] },
    reward: { type: "keyword", title: `kw-${id}`, value: `kw-${id}` },
    ...overrides,
  };
}

function game(id: string, overrides: Partial<Game> = {}): Game {
  return {
    id,
    language: "zh-CN",
    title: "Published Hunt",
    description: "api fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "a",
    scenes: [scene("a")],
    ...overrides,
  };
}

const post = (body: string, contentType = "application/json") =>
  new Request("https://host.test/api/publish", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

const getLatest = (gameId: string) =>
  GET(new Request(`https://host.test/api/games/${gameId}`), {
    params: Promise.resolve({ gameId }),
  });

const getVersion = (gameId: string, v: string) =>
  GET(new Request(`https://host.test/api/games/${gameId}?v=${v}`), {
    params: Promise.resolve({ gameId }),
  });

describe("POST /api/publish", () => {
  it("publishes a valid pack and returns the identity triple", async () => {
    const response = await POST(post(JSON.stringify(game("demo-hunt"))));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { gameId: string; versionId: string; created: boolean; playPath: string };
    expect(body.gameId).toBe("demo-hunt");
    expect(body.created).toBe(true);
    expect(body.versionId).toBe(await deriveVersionId(game("demo-hunt")));
    expect(body.playPath).toBe(`/select#cloud=demo-hunt.${body.versionId}`);
  });

  it("is idempotent for identical content and mints a new version for changed content", async () => {
    const first = await POST(post(JSON.stringify(game("demo-hunt"))));
    expect(first.status).toBe(201);
    const repeat = await POST(post(JSON.stringify(game("demo-hunt"))));
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as { created: boolean }).created).toBe(false);

    const changed = await POST(post(JSON.stringify(game("demo-hunt", { title: "Changed" }))));
    expect(changed.status).toBe(201);
    const changedBody = (await changed.json()) as { versionId: string };
    const firstBody = (await first.json()) as { versionId: string };
    expect(changedBody.versionId).not.toBe(firstBody.versionId);
  });

  it("returns 400 with a reason for packs that fail validation", async () => {
    const broken = game("demo-hunt", { title: "" } as Partial<Game>);
    const response = await POST(post(JSON.stringify(broken)));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; detail: string };
    expect(body.error).toBe("invalid_pack");
    expect(body.detail).toContain("$.title");
  });

  it("guards the input contract", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post("[1,2]"))).status).toBe(400);
    expect((await POST(post(JSON.stringify(game("Bad Id"))))).status).toBe(400);
    expect((await POST(post('{"id":"demo-hunt"}', "text/plain"))).status).toBe(415);
    expect((await POST(post("x".repeat(256 * 1024 + 1)))).status).toBe(413);
  });
});

describe("GET /api/games/[gameId]", () => {
  it("serves the published pack and the body passes validateGame", async () => {
    await POST(post(JSON.stringify(game("demo-hunt"))));
    const response = await getLatest("demo-hunt");
    expect(response.status).toBe(200);
    const parsed = await response.json();
    expect(() => validateGame(parsed)).not.toThrow();
    expect((parsed as Game).title).toBe("Published Hunt");
  });

  it("serves a specific version immutably with the version header", async () => {
    const published = (await (await POST(post(JSON.stringify(game("demo-hunt"))))).json()) as {
      versionId: string;
    };
    const response = await getVersion("demo-hunt", published.versionId);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-game-version")).toBe(published.versionId);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("returns clean 404s for unknown games and versions", async () => {
    expect((await getLatest("never-published")).status).toBe(404);
    await POST(post(JSON.stringify(game("demo-hunt"))));
    expect((await getVersion("demo-hunt", "ffffffffffffffff")).status).toBe(404);
  });

  it("rejects malformed ids with 400", async () => {
    expect((await getLatest("../escape")).status).toBe(400);
    expect((await getVersion("demo-hunt", "nothex")).status).toBe(400);
  });
});

describe("POST /api/publish - phase 1 hardening", () => {
  it("is idempotent when the same content arrives with a different key order", async () => {
    const source = game("demo-hunt");
    const first = await POST(post(JSON.stringify(source)));
    expect(first.status).toBe(201);
    // Same content, top-level keys reversed: the old JSON.stringify-based
    // pack made this collide with its own version object (false 409).
    const reordered = Object.fromEntries(Object.entries(source).reverse());
    const repeat = await POST(post(JSON.stringify(reordered)));
    expect(repeat.status).toBe(200);
    const repeatBody = (await repeat.json()) as { created: boolean; versionId: string };
    expect(repeatBody.created).toBe(false);
    expect(repeatBody.versionId).toBe(((await first.json()) as { versionId: string }).versionId);
  });

  it("enforces the size cap by byte length, even with a forged Content-Length", async () => {
    // ~90k CJK characters are ~270 KB of UTF-8 but well under the 256 KiB
    // UTF-16 code-unit count that the old char-length check measured.
    const oversized = JSON.stringify(game("demo-hunt", { description: "包".repeat(90 * 1024) }));
    const forged = new Request("https://host.test/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "1" },
      body: oversized,
    });
    const response = await POST(forged);
    expect(response.status).toBe(413);
  });

  it("refuses to overwrite a tampered version object with 409", async () => {
    const published = (await (await POST(post(JSON.stringify(game("demo-hunt"))))).json()) as {
      versionId: string;
    };
    const versionFile = path.join(storeDir, "demo-hunt", "versions", `${published.versionId}.json`);
    await writeFile(versionFile, '{"id":"demo-hunt","tampered":true}', "utf8");
    const republish = await POST(post(JSON.stringify(game("demo-hunt"))));
    expect(republish.status).toBe(409);
    const body = (await republish.json()) as { error: string };
    expect(body.error).toBe("version_conflict");
    // The tampered object is still what the read API serves - never silently
    // replaced by the new upload.
    const read = await getVersion("demo-hunt", published.versionId);
    expect(((await read.json()) as { tampered: boolean }).tampered).toBe(true);
  });

  it("returns a generic 500 without internal details when storage fails", async () => {
    // Point the store root at a regular file: mkdir/write must fail there.
    const blocker = path.join(storeDir, "storage-root-is-a-file");
    await writeFile(blocker, "not a directory", "utf8");
    const previous = process.env.PUBLISHED_GAMES_DIR;
    process.env.PUBLISHED_GAMES_DIR = blocker;
    try {
      const response = await POST(post(JSON.stringify(game("demo-hunt"))));
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string; detail?: string };
      expect(body.error).toBe("publish_failed");
      expect(body.detail).toBeUndefined();
      // No local path may leak into the response body.
      expect(JSON.stringify(body)).not.toContain(storeDir);
    } finally {
      process.env.PUBLISHED_GAMES_DIR = previous;
    }
  });
});

describe("GET /api/games/[gameId] - phase 1 hardening", () => {
  it("caches latest briefly and serves history immutably across new publishes", async () => {
    const first = (await (await POST(post(JSON.stringify(game("demo-hunt"))))).json()) as {
      versionId: string;
    };

    const latest = await getLatest("demo-hunt");
    expect(latest.headers.get("cache-control")).toContain("max-age=10");
    expect(latest.headers.get("cache-control")).toContain("stale-while-revalidate=30");

    // A second publish must not change what the first version serves.
    await POST(post(JSON.stringify(game("demo-hunt", { title: "Second Edition" }))));
    const history = await getVersion("demo-hunt", first.versionId);
    expect(history.status).toBe(200);
    expect(((await history.json()) as Game).title).toBe("Published Hunt");
    expect(history.headers.get("cache-control")).toContain("immutable");

    // ...while "latest" now resolves to the new version.
    const latestAfter = await getLatest("demo-hunt");
    expect(((await latestAfter.json()) as Game).title).toBe("Second Edition");
  });
});
