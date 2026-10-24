/**
 * Explicit save path for games received through a share link.
 *
 * A shared pack arrives inside the URL hash and plays entirely from memory
 * (`source: "shared"`); closing the tab loses it. This module is the one and
 * only bridge from that transient state into the local library
 * (`mos-scene-hunt:authoring:<id>`), and it is deliberately strict:
 *
 *  - Saving never happens implicitly. The /select screen calls
 *    `saveSharedGameToLibrary` only from the player's button click.
 *  - Success is declared only when the write returned `ok` AND the stored
 *    bytes read back identical. "ID exists" is never treated as "saved".
 *  - A same-id pack already in the library is checked by canonical content:
 *    identical content reports `already-saved` (no duplicate record), while
 *    differing content reports `conflict` and the stored pack is left
 *    untouched - overwriting an existing game or its player progress silently
 *    is out of scope until the batch-2 conflict UI lands.
 */

import type { Game } from "../game/types";
import {
  hasAuthoredGame,
  readAuthoredGame,
  readAuthoredGameRaw,
  saveAuthoredGameChecked,
} from "./index";

/** The key prefix lib/content uses for the local library. */
const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";

/**
 * Recursively key-sorted JSON, so a stored pack and a received pack compare
 * equal regardless of property order or formatting differences.
 */
export function canonicalGameJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalGameJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalGameJson(v)}`).join(",")}}`;
}

export type SharedGameLibraryState = "not-saved" | "saved" | "conflict";

/**
 * Current library status of a shared pack, read from actual storage - never
 * from a memory flag - so a page refresh re-derives the truth.
 */
export function getSharedGameLibraryState(game: Game): SharedGameLibraryState {
  if (typeof window === "undefined") return "not-saved";
  if (!hasAuthoredGame(game.id)) return "not-saved";
  const stored = readAuthoredGame(game.id);
  if (!stored) {
    // Key exists but the content no longer parses/validates. Treat as
    // conflicting: saving would replace a (broken) record the player still
    // owns, and batch-2 owns that decision.
    return "conflict";
  }
  return canonicalGameJson(stored) === canonicalGameJson(game) ? "saved" : "conflict";
}

export type SharedGameSaveOutcome =
  | { status: "saved"; warnings: number }
  | { status: "already-saved" }
  | { status: "conflict" }
  | { status: "error"; message: string };

/**
 * Save a received pack to the local library.
 *
 * Returns `saved` only when the write succeeded AND the exact bytes were read
 * back; every other path reports honestly (`already-saved`, `conflict`,
 * `error`) and never mutates an existing record it did not write itself.
 */
export function saveSharedGameToLibrary(game: Game): SharedGameSaveOutcome {
  const current = getSharedGameLibraryState(game);
  if (current === "saved") return { status: "already-saved" };
  if (current === "conflict") return { status: "conflict" };

  const result = saveAuthoredGameChecked(game);
  if (!result.ok) {
    return {
      status: "error",
      message: result.errors[0]?.message ?? "保存失败，请重试",
    };
  }

  // Read back the exact bytes we intended to store. `hasAuthoredGame` only
  // proves the key exists; this proves the content actually round-tripped.
  const expected = JSON.stringify(game);
  let storedRaw: string | null = null;
  try {
    storedRaw = window.localStorage.getItem(`${AUTHORING_PREFIX}${game.id}`);
  } catch {
    storedRaw = null;
  }
  if (storedRaw !== expected) {
    return {
      status: "error",
      message: "保存后读回校验未通过，不能确认已保存。请重试；若反复失败，请检查浏览器存储空间。",
    };
  }
  return { status: "saved", warnings: result.warnings.length };
}
