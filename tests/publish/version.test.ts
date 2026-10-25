/**
 * Version identity tests (serverization batch 1).
 *
 * versionId is a content hash over the canonical JSON form: deterministic,
 * sensitive to any content change, insensitive to key order and formatting.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  deriveVersionId,
  isValidGameId,
  isValidVersionId,
} from "@/lib/publish/version";

describe("gameId / versionId formats", () => {
  it("accepts content-pack style ids and rejects unsafe ones", () => {
    expect(isValidGameId("demo-hunt")).toBe(true);
    expect(isValidGameId("igsl-eight-transformations")).toBe(true);
    expect(isValidGameId("a")).toBe(true);
    expect(isValidGameId("")).toBe(false);
    expect(isValidGameId("UPPER")).toBe(false);
    expect(isValidGameId("../escape")).toBe(false);
    expect(isValidGameId("-leading")).toBe(false);
    expect(isValidGameId("a".repeat(65))).toBe(false);
    expect(isValidGameId(42)).toBe(false);
  });

  it("only accepts 16 hex characters as version ids", () => {
    expect(isValidVersionId("0123456789abcdef")).toBe(true);
    expect(isValidVersionId("short")).toBe(false);
    expect(isValidVersionId("0123456789ABCDEF")).toBe(false);
    expect(isValidVersionId("0123456789abcde")).toBe(false);
    expect(isValidVersionId("../../etc")).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("is insensitive to key order and formatting", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("keeps array order (arrays are semantic for scene lists)", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("drops undefined properties", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe("deriveVersionId", () => {
  it("is deterministic and content-addressed", async () => {
    const game = { id: "demo", title: "t", scenes: [{ id: "s1" }] };
    expect(await deriveVersionId(game)).toBe(await deriveVersionId(game));
    expect(isValidVersionId(await deriveVersionId(game))).toBe(true);
  });

  it("changes when any content changes", async () => {
    const game = { id: "demo", title: "t" };
    const variants = [
      { id: "demo", title: "t2" },
      { id: "demo2", title: "t" },
      { id: "demo", title: "t", extra: 1 },
    ];
    const base = await deriveVersionId(game);
    for (const variant of variants) {
      expect(await deriveVersionId(variant)).not.toBe(base);
    }
  });

  it("gives the same id to games differing only in key order", async () => {
    expect(await deriveVersionId({ a: 1, b: 2 })).toBe(await deriveVersionId({ b: 2, a: 1 }));
  });
});
