// @vitest-environment jsdom

/**
 * GPS simulator / demo capability gates (decisions D-003/D-012).
 *
 * The DEV simulator must never be reachable from a production build unless the
 * operator explicitly opted in at build time - and the auto-demo must be able
 * to run WITHOUT the DEV simulator (its own injection channel instead), so a
 * kiosk deployment never has to expose the fake-position panel to players.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isSimulatorAvailable } from "@/lib/location";
import { isDemoSupported } from "@/lib/demo/autopilot";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("simulator capability gates", () => {
  it("production build without opt-in: no DEV simulator", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_GPS_SIMULATOR", "");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTO_DEMO", "");
    expect(isSimulatorAvailable()).toBe(false);
    expect(isDemoSupported()).toBe(false);
  });

  it("production build with SIMULATOR=1: DEV simulator compiled in (operator's choice)", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_GPS_SIMULATOR", "1");
    expect(isSimulatorAvailable()).toBe(true);
  });

  it("demo runs on AUTO_DEMO=1 WITHOUT the DEV simulator (D-003 decoupling)", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_GPS_SIMULATOR", "");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTO_DEMO", "1");
    expect(isSimulatorAvailable()).toBe(false);
    expect(isDemoSupported()).toBe(true);
  });

  it("dev builds keep both capabilities by default", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_GPS_SIMULATOR", "");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTO_DEMO", "");
    expect(isSimulatorAvailable()).toBe(true);
    expect(isDemoSupported()).toBe(true);
  });
});
