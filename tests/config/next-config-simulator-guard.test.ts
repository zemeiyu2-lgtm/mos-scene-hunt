/**
 * Build-time production gate for the DEV GPS simulator (next.config.ts, B-01 P1).
 *
 * These tests pin the mechanism, not just the intent: the decision has to be
 * baked into the config at build time, because `VERCEL_ENV` is not inlined into
 * the client bundle and therefore cannot be inspected by the browser. Each case
 * loads the config module fresh with the environment a given deployment would
 * actually have.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextConfig } from "next";

const GUARD_KEY = "NEXT_PUBLIC_ENABLE_GPS_SIMULATOR";

const original: Record<string, string | undefined> = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL: process.env.VERCEL,
  [GUARD_KEY]: process.env[GUARD_KEY],
};

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv(): void {
  setEnv({
    VERCEL_ENV: undefined,
    VERCEL: undefined,
    [GUARD_KEY]: undefined,
  });
}

/** Load next.config.ts with the current process environment. */
async function loadConfig(): Promise<NextConfig> {
  vi.resetModules();
  const mod = await import("../../next.config");
  return mod.default as NextConfig;
}

beforeEach(() => {
  clearEnv();
});

afterEach(() => {
  setEnv(original);
  vi.resetModules();
});

describe("next.config.ts simulator build gate", () => {
  it("Vercel production + SIMULATOR=1: forces the client flag to 0", async () => {
    // The exact failing scenario from 2026-11-03: the variable is set on the
    // Production environment, so the runtime check alone was defeated.
    setEnv({ VERCEL_ENV: "production", VERCEL: "1", [GUARD_KEY]: "1" });
    const config = await loadConfig();
    expect(config.env?.[GUARD_KEY]).toBe("0");
  });

  it("Vercel production without any SIMULATOR variable: still 0 (explicit close)", async () => {
    setEnv({ VERCEL_ENV: "production", VERCEL: "1" });
    const config = await loadConfig();
    expect(config.env?.[GUARD_KEY]).toBe("0");
  });

  it("Vercel with a missing/unexpected environment marker: fails safe to 0", async () => {
    setEnv({ VERCEL: "1", [GUARD_KEY]: "1" });
    const config = await loadConfig();
    expect(config.env?.[GUARD_KEY]).toBe("0");
  });

  it("Vercel preview keeps the operator's opt-in untouched", async () => {
    setEnv({ VERCEL_ENV: "preview", VERCEL: "1", [GUARD_KEY]: "1" });
    const config = await loadConfig();
    // No override at all: the NEXT_PUBLIC_* value is inlined as configured.
    expect(config.env?.[GUARD_KEY]).toBeUndefined();
  });

  it("Vercel preview without opt-in stays closed, without inventing a value", async () => {
    setEnv({ VERCEL_ENV: "preview", VERCEL: "1" });
    const config = await loadConfig();
    expect(config.env?.[GUARD_KEY]).toBeUndefined();
  });

  it("local build / dev server: no override, previous behaviour preserved", async () => {
    setEnv({ [GUARD_KEY]: "1" });
    const config = await loadConfig();
    expect(config.env?.[GUARD_KEY]).toBeUndefined();
  });

  it("never publishes anything except the one public, non-secret key", async () => {
    setEnv({
      VERCEL_ENV: "production",
      VERCEL: "1",
      [GUARD_KEY]: "1",
      BLOB_READ_WRITE_TOKEN: "secret-token",
      MOS_ADMIN_PASSWORD: "secret-password",
      NEXT_PUBLIC_ENABLE_AUTO_DEMO: "1",
    });
    const config = await loadConfig();
    expect(Object.keys(config.env ?? {})).toEqual([GUARD_KEY]);
    expect(Object.values(config.env ?? {})).not.toContain("secret-token");
    expect(Object.values(config.env ?? {})).not.toContain("secret-password");
  });

  it("leaves the rest of the config intact", async () => {
    setEnv({ VERCEL_ENV: "production", VERCEL: "1" });
    const config = await loadConfig();
    expect(config.reactStrictMode).toBe(true);
    expect(config.transpilePackages).toContain("leaflet");
    expect(config.images?.unoptimized).toBe(true);
    const headers = await config.headers?.();
    expect(headers?.map((h) => h.source)).toEqual(["/sw.js", "/manifest.webmanifest", "/content/:path*"]);
  });
});
