/**
 * Preview namespace guard.
 *
 * Production and Preview share one Blob store and one set of default prefixes.
 * These tests pin the rule that makes that safe: in Preview, Blob storage only
 * runs when an explicit, non-production prefix is configured — otherwise it
 * throws instead of silently reading/writing production data.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRegistry, resetRegistryForTests } from "@/lib/registry/store";
import { getStore } from "@/lib/publish/storage";
import { resolveBlobPrefix } from "@/lib/storage/namespace-guard";

const saved: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRegistryForTests();
}

beforeEach(() => {
  resetRegistryForTests();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(saved)) delete saved[key];
  resetRegistryForTests();
});

describe("resolveBlobPrefix", () => {
  it("uses the production default outside Preview", () => {
    setEnv({ VERCEL_ENV: "production", REGISTRY_BLOB_PREFIX: undefined });
    expect(resolveBlobPrefix({ store: "registry", prefix: undefined })).toBe("registry");
    expect(resolveBlobPrefix({ store: "published-games", prefix: undefined })).toBe(
      "published-games",
    );
  });

  it("is inert on a non-Vercel host (local dev, tests, self-hosted)", () => {
    setEnv({ VERCEL_ENV: undefined });
    expect(resolveBlobPrefix({ store: "registry", prefix: undefined })).toBe("registry");
  });

  it("rejects a Preview deployment with no explicit prefix", () => {
    setEnv({ VERCEL_ENV: "preview", REGISTRY_BLOB_PREFIX: undefined });
    expect(() => resolveBlobPrefix({ store: "registry", prefix: undefined })).toThrow(
      /REGISTRY_BLOB_PREFIX/,
    );
  });

  it("rejects a Preview deployment that reuses the production prefix", () => {
    setEnv({ VERCEL_ENV: "preview" });
    expect(() => resolveBlobPrefix({ store: "registry", prefix: "registry" })).toThrow(
      /不是隔离命名空间/,
    );
    expect(() => resolveBlobPrefix({ store: "published-games", prefix: "published-games" })).toThrow(
      /不是隔离命名空间/,
    );
  });

  it("accepts an explicit Preview prefix", () => {
    setEnv({ VERCEL_ENV: "preview" });
    expect(resolveBlobPrefix({ store: "registry", prefix: "registry-preview" })).toBe(
      "registry-preview",
    );
  });
});

describe("store selection under Preview", () => {
  it("refuses to build a Blob registry without a Preview prefix", () => {
    setEnv({
      VERCEL_ENV: "preview",
      REGISTRY_STORE: "blob",
      REGISTRY_BLOB_PREFIX: undefined,
    });
    expect(() => getRegistry()).toThrow(/REGISTRY_BLOB_PREFIX/);
  });

  it("builds a Blob registry once an isolated prefix is set", () => {
    setEnv({
      VERCEL_ENV: "preview",
      REGISTRY_STORE: "blob",
      REGISTRY_BLOB_PREFIX: "registry-preview",
    });
    expect(() => getRegistry()).not.toThrow();
  });

  it("refuses to build a Blob published-games store without a Preview prefix", () => {
    setEnv({
      VERCEL_ENV: "preview",
      PUBLISHED_GAMES_STORE: "blob",
      PUBLISHED_GAMES_BLOB_PREFIX: undefined,
    });
    expect(() => getStore()).toThrow(/PUBLISHED_GAMES_BLOB_PREFIX/);
  });

  it("builds the published-games store once an isolated prefix is set", () => {
    setEnv({
      VERCEL_ENV: "preview",
      PUBLISHED_GAMES_STORE: "blob",
      PUBLISHED_GAMES_BLOB_PREFIX: "published-games-preview",
    });
    expect(() => getStore()).not.toThrow();
  });

  it("leaves the filesystem fallback alone (no shared namespace to protect)", () => {
    setEnv({
      VERCEL_ENV: "preview",
      REGISTRY_STORE: undefined,
      PUBLISHED_GAMES_STORE: undefined,
      REGISTRY_DIR: undefined,
    });
    expect(() => getRegistry()).not.toThrow();
    expect(() => getStore()).not.toThrow();
  });
});
