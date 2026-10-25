/**
 * Publish / read API route tests (serverization batch 1).
 *
 * Route handlers are invoked directly with standard Request objects against a
 * temporary store directory (PUBLISHED_GAMES_DIR), so the HTTP contract -
 * status codes, immutability, 404s, size and format guards - is tested for
 * real without a running server.
 */

import { mkdtemp, rm } from "node:fs/promises";
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
