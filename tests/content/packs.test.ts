import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateGame } from "../../lib/game/types";

/**
 * Regression guard for the HTTP 422 incident.
 *
 * V0.3 shipped `content/demo-hunt.json` with raw newline characters inside
 * string literals. That is invalid JSON ("Bad control character in string
 * literal"), but nothing failed at authoring time: the pack only broke when
 * the server route handler ran JSON.parse, so every /content/demo-hunt.json
 * request returned 422, loadGame never succeeded, and the offline cache was
 * never populated.
 *
 * These tests run every pack in `content/` through strict JSON.parse and the
 * real schema validator, so a malformed pack fails CI before it can deploy.
 */

const CONTENT_DIR = path.join(process.cwd(), "content");
const packs = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"));

describe("content packs on disk", () => {
  it("finds at least one content pack", () => {
    expect(packs.length).toBeGreaterThan(0);
  });

  it.each(packs)("%s parses as strict JSON and passes validateGame", (file) => {
    const raw = readFileSync(path.join(CONTENT_DIR, file), "utf8");

    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(raw);
    }).not.toThrow();

    // Throws GameDataError on error-severity issues, so a schema-invalid
    // pack fails here too.
    const { game } = validateGame(parsed);
    expect(game.id).toBeTruthy();
    expect(game.scenes.length).toBeGreaterThan(0);
  });
});
