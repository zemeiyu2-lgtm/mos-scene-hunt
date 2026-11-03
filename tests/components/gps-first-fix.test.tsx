// @vitest-environment jsdom
/**
 * First-fix state machine (components/gps-provider.tsx, B-03 / B-02 UX-01).
 *
 * The bug this catches: a first-fix TIMEOUT or POSITION_UNAVAILABLE only set
 * `error`. Because the map screen rendered its error banner for status "error"
 * alone, the player stayed on "正在获取定位…" forever - no message, no retry,
 * no way out of the game's entry point. These tests pin:
 *
 *   - every first-fix failure ends in an actionable status, not "requesting";
 *   - a late fix still promotes the session to "watching";
 *   - a completely silent watch is caught by the UI deadline;
 *   - retry restarts continuous positioning *immediately* (it no longer waits
 *     for the slow one-shot read) and never stacks watchers;
 *   - a recoverable error after a good fix never downgrades the session.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act, waitFor } from "@testing-library/react";

type FixCb = (fix: unknown) => void;
type ErrCb = (err: unknown) => void;

interface FakeWatch {
  id: number;
  onFix: FixCb;
  onErr: ErrCb;
  stopped: boolean;
}

const locationState = {
  permission: "granted" as string,
  oneShot: "resolve" as "resolve" | "pending" | "reject-denied",
  watches: [] as FakeWatch[],
  nextId: 0,
};

function fixFixture(timestamp = Date.now()) {
  return { lat: 30, lng: 120, accuracy: 8, timestamp, altitude: null, heading: null, speed: null, simulated: false };
}

vi.mock("@/lib/location", () => ({
  isGeolocationSupported: () => true,
  isSimulatorAvailable: () => false,
  queryPermission: vi.fn(async () => locationState.permission),
  getCurrentPosition: vi.fn(() => {
    if (locationState.oneShot === "pending") return new Promise(() => {});
    if (locationState.oneShot === "reject-denied") {
      return Promise.reject({ code: "PERMISSION_DENIED", message: "denied", userMessage: "denied" });
    }
    return Promise.resolve(fixFixture());
  }),
  watchPosition: vi.fn((onFix: FixCb, onErr: ErrCb) => {
    const watch: FakeWatch = { id: ++locationState.nextId, onFix, onErr, stopped: false };
    locationState.watches.push(watch);
    return {
      stop: () => {
        watch.stopped = true;
      },
    };
  }),
  simulateFix: () => null,
}));

vi.mock("@/components/providers", () => ({
  useSettings: () => ({
    settings: { simulatorEnabled: false, simulatorCoordinate: null, allowAccuracySlack: true },
  }),
}));

import { GpsProvider, useGps } from "@/components/gps-provider";
import { watchPosition } from "@/lib/location";

let gpsValue: ReturnType<typeof useGps> | null = null;

function Probe(): null {
  gpsValue = useGps();
  return null;
}

function renderProvider() {
  gpsValue = null;
  render(
    <GpsProvider>
      <Probe />
    </GpsProvider>,
  );
}

function liveWatches(): FakeWatch[] {
  return locationState.watches.filter((w) => !w.stopped);
}

function lastWatch(): FakeWatch {
  const live = liveWatches();
  expect(live.length).toBeGreaterThan(0);
  return live[live.length - 1];
}

function installPermissionsStub() {
  Object.defineProperty(window.navigator, "permissions", {
    configurable: true,
    get: () => ({
      query: async () => ({
        state: locationState.permission,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    }),
  });
}

async function mount() {
  renderProvider();
  await act(async () => {
    await Promise.resolve();
  });
  expect(liveWatches().length).toBe(1);
}

function failWatch(code: string) {
  act(() => lastWatch().onErr({ code, message: code, userMessage: `user:${code}` }));
}

beforeEach(() => {
  locationState.permission = "granted";
  locationState.oneShot = "resolve";
  locationState.watches = [];
  locationState.nextId = 0;
  installPermissionsStub();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  vi.mocked(watchPosition).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // @ts-expect-error test cleanup
  delete window.navigator.permissions;
});

describe("first-fix failures leave the waiting state", () => {
  it("a TIMEOUT before any fix becomes 'stalled', with the error kept", async () => {
    await mount();
    expect(gpsValue?.status).toBe("requesting");
    failWatch("TIMEOUT");
    expect(gpsValue?.status).toBe("stalled");
    expect(gpsValue?.error?.code).toBe("TIMEOUT");
    // The watch is still alive: a later fix must be able to rescue the session.
    expect(liveWatches().length).toBe(1);
  });

  it("POSITION_UNAVAILABLE before any fix also becomes 'stalled'", async () => {
    await mount();
    failWatch("POSITION_UNAVAILABLE");
    expect(gpsValue?.status).toBe("stalled");
    expect(gpsValue?.error?.code).toBe("POSITION_UNAVAILABLE");
  });

  it("a fix arriving after the failure promotes the session to 'watching'", async () => {
    await mount();
    failWatch("TIMEOUT");
    expect(gpsValue?.status).toBe("stalled");
    act(() => lastWatch().onFix(fixFixture()));
    expect(gpsValue?.status).toBe("watching");
    expect(gpsValue?.error).toBeNull();
    expect(gpsValue?.fix?.lat).toBe(30);
  });

  it("PERMISSION_DENIED stays the blocking 'error' state and drops the dead handle", async () => {
    await mount();
    failWatch("PERMISSION_DENIED");
    expect(gpsValue?.status).toBe("error");
    expect(gpsValue?.permission).toBe("denied");
    expect(liveWatches().length).toBe(0);
  });

  it("a recoverable error after a good fix never downgrades a healthy session", async () => {
    await mount();
    act(() => lastWatch().onFix(fixFixture()));
    expect(gpsValue?.status).toBe("watching");
    failWatch("TIMEOUT");
    expect(gpsValue?.status).toBe("watching");
  });
});

describe("silent watch deadline", () => {
  it("a watch that never reports anything becomes 'stalled' after the deadline", async () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      await act(async () => {
        await Promise.resolve();
      });
      expect(gpsValue?.status).toBe("requesting");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(26_000);
      });
      expect(gpsValue?.status).toBe("stalled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire once a fix has arrived", async () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      await act(async () => {
        await Promise.resolve();
      });
      act(() => lastWatch().onFix(fixFixture()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(gpsValue?.status).toBe("watching");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("retry() restarts the flow", () => {
  it("establishes the continuous watcher before the one-shot read settles", async () => {
    await mount();
    failWatch("TIMEOUT");
    expect(gpsValue?.status).toBe("stalled");

    locationState.oneShot = "pending";
    act(() => gpsValue?.retry());

    // The watch exists immediately - no 45 s wait for a slow one-shot read.
    expect(liveWatches().length).toBe(1);
    expect(gpsValue?.status).toBe("requesting");
    expect(gpsValue?.error).toBeNull();
  });

  it("recovers to 'watching' when the rebuilt watcher delivers a fix", async () => {
    await mount();
    failWatch("POSITION_UNAVAILABLE");
    act(() => gpsValue?.retry());
    await waitFor(() => expect(gpsValue?.status).toBe("watching"));
    expect(liveWatches().length).toBe(1);
  });

  it("never stacks watchers across repeated retries", async () => {
    await mount();
    for (let i = 0; i < 4; i += 1) {
      failWatch("TIMEOUT");
      act(() => gpsValue?.retry());
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(liveWatches().length).toBe(1);
  });

  it("a denied retry tears the watcher down and surfaces the blocking state", async () => {
    await mount();
    locationState.oneShot = "reject-denied";
    act(() => gpsValue?.retry());
    await waitFor(() => expect(gpsValue?.status).toBe("error"));
    expect(gpsValue?.permission).toBe("denied");
    expect(liveWatches().length).toBe(0);
  });
});
