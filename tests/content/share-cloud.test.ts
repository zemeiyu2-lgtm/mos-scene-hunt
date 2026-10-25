/**
 * Cloud game link tests (serverization batch 1).
 *
 * `#cloud=<gameId>.<versionId>` fragments are fetched from the read API and
 * validated with the same validator as every other content path. Every
 * failure mode must surface a readable "broken" reason - never a silent
 * fallback to another game.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublishedGameUrl,
  hasCloudGamePayload,
  readSharedGameOutcome,
} from "@/lib/content/share";
import type { Game, Scene } from "@/lib/game/types";

const GAME_ID = "demo-hunt";
const VERSION = "0123456789abcdef";

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

const game: Game = {
  id: GAME_ID,
  language: "zh-CN",
  title: "Cloud Hunt",
  description: "cloud link fixture",
  version: "1.0.0",
  startLocation: { lat: 0, lng: 0 },
  entrySceneId: "a",
  scenes: [scene("a")],
};

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { origin: "https://mos-scene-hunt.test", hash: "" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setHash(hash: string) {
  (window.location as { hash: string }).hash = hash;
}

function fetchJson(status: number, body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("published game links", () => {
  it("creates a short link carrying only ids", () => {
    const url = createPublishedGameUrl(GAME_ID, VERSION);
    expect(url).toBe(`https://mos-scene-hunt.test/select#cloud=${GAME_ID}.${VERSION}`);
    setHash(new URL(url).hash);
    expect(hasCloudGamePayload()).toBe(true);
  });

  it("rejects malformed ids when generating links", () => {
    expect(() => createPublishedGameUrl("../evil", VERSION)).toThrow();
    expect(() => createPublishedGameUrl(GAME_ID, "nothex")).toThrow();
  });

  it("reads and validates a published game from the server", async () => {
    setHash(`#cloud=${GAME_ID}.${VERSION}`);
    const fetchMock = fetchJson(200, game);
    const outcome = await readSharedGameOutcome();
    expect(outcome).toEqual({ status: "ok", game });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/games/${GAME_ID}?v=${VERSION}`,
      expect.objectContaining({ cache: "no-cache" }),
    );
  });

  it("reports a readable reason when the game is missing (404)", async () => {
    setHash(`#cloud=${GAME_ID}.${VERSION}`);
    fetchJson(404, { error: "game_not_found" });
    const outcome = await readSharedGameOutcome();
    expect(outcome.status).toBe("broken");
    expect(outcome.status === "broken" && outcome.reason).toContain("不存在");
  });

  it("reports a readable reason for server errors", async () => {
    setHash(`#cloud=${GAME_ID}.${VERSION}`);
    fetchJson(500, {});
    const outcome = await readSharedGameOutcome();
    expect(outcome.status).toBe("broken");
    expect(outcome.status === "broken" && outcome.reason).toContain("500");
  });

  it("does not trust a tampered store response: invalid packs are broken", async () => {
    setHash(`#cloud=${GAME_ID}.${VERSION}`);
    fetchJson(200, { ...game, title: "" });
    const outcome = await readSharedGameOutcome();
    expect(outcome.status).toBe("broken");
  });

  it("treats truncated or malformed fragments as broken, not absent", async () => {
    setHash("#cloud=demo-hunt");
    const noVersion = await readSharedGameOutcome();
    expect(noVersion.status).toBe("broken");

    setHash(`#cloud=${GAME_ID}.zzzz`);
    const badVersion = await readSharedGameOutcome();
    expect(badVersion.status).toBe("broken");
  });

  it("network failures surface as a retryable reason", async () => {
    setHash(`#cloud=${GAME_ID}.${VERSION}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const outcome = await readSharedGameOutcome();
    expect(outcome.status).toBe("broken");
    expect(outcome.status === "broken" && outcome.reason).toContain("网络");
  });

  it("leaves plain URLs absent", async () => {
    setHash("");
    await expect(readSharedGameOutcome()).resolves.toEqual({ status: "absent" });
    setHash("#something-else=1");
    await expect(readSharedGameOutcome()).resolves.toEqual({ status: "absent" });
  });
});
