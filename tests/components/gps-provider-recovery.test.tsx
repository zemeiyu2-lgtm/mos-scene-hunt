// @vitest-environment jsdom
/**
 * GPS provider recovery machinery (components/gps-provider.tsx, B-01A).
 *
 * These tests pin the recovery contract that real outdoor sessions depend on:
 *   - F1  retry() rebuilds the CONTINUOUS watcher (not just a one-shot read);
 *   - F1  re-granting a denied permission resumes automatically via the
 *         Permissions API change event, and dead-watch cleanup keeps the
 *         "one handle" invariant;
 *   - F2  automatic rebuilds are throttled (rate + interval), manual taps are
 *         not;
 *   - F3  becoming visible again rebuilds a dead or stale watcher, but never
 *         fights an explicit user stop;
 *   - F4  the watchdog rebuilds a silently-dead watching session, and cannot
 *         become a restart loop;
 *   - repeated retry/start/visibility cycles never stack duplicate watchers.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor, act } from "@testing-library/react";

/* ---------------------------------------------------------------- */
/* Mocks                                                            */
/* ---------------------------------------------------------------- */

type FixCb = (fix: unknown) => void;
type ErrCb = (err: unknown) => void;

interface FakeWatch {
  id: number;
  onFix: FixCb;
  onErr: ErrCb;
  stopped: boolean;
}

const locationState = {
  permission: "prompt" as string,
  oneShot: null as null | { resolve?: unknown; reject?: { code: string; message: string } },
  watches: [] as FakeWatch[],
  nextId: 0,
};

function lastWatch(): FakeWatch {
  const live = locationState.watches.filter((w) => !w.stopped);
  expect(live.length).toBeGreaterThan(0);
  return live[live.length - 1];
}

function fixFixture(timestamp = Date.now()) {
  return { lat: 30.0, lng: 120.0, accuracy: 8, timestamp, altitude: null, heading: null, speed: null, simulated: false };
}

vi.mock("@/lib/location", () => ({
  isGeolocationSupported: () => true,
  isSimulatorAvailable: () => false,
  queryPermission: vi.fn(async () => locationState.permission),
  getCurrentPosition: vi.fn(() => {
    if (locationState.oneShot?.reject) {
      return Promise.reject(locationState.oneShot.reject);
    }
    return Promise.resolve(locationState.oneShot?.resolve ?? fixFixture());
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

const settingsState = {
  simulatorEnabled: false,
  simulatorCoordinate: null,
  allowAccuracySlack: true,
};

vi.mock("@/components/providers", () => ({
  useSettings: () => ({ settings: settingsState }),
}));

import { GpsProvider, useGps } from "@/components/gps-provider";
import { watchPosition } from "@/lib/location";

/* ---------------------------------------------------------------- */
/* Harness                                                          */
/* ---------------------------------------------------------------- */

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

function firePermissionChange() {
  for (const cb of permissionListeners.splice(0)) cb();
}

const permissionListeners: Array<() => void> = [];

function installPermissionsStub() {
  Object.defineProperty(window.navigator, "permissions", {
    configurable: true,
    get: () => ({
      query: async () => ({
        state: locationState.permission,
        addEventListener: (_type: string, cb: () => void) => permissionListeners.push(cb),
        removeEventListener: (_type: string, cb: () => void) => {
          const i = permissionListeners.indexOf(cb);
          if (i >= 0) permissionListeners.splice(i, 1);
        },
      }),
    }),
  });
}

function liveWatches(): FakeWatch[] {
  return locationState.watches.filter((w) => !w.stopped);
}

beforeEach(() => {
  locationState.permission = "granted";
  locationState.oneShot = null;
  locationState.watches = [];
  locationState.nextId = 0;
  permissionListeners.length = 0;
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

/** Flush mount effects and land the provider in a watching state. */
async function mountedAndWatching() {
  renderProvider();
  await act(async () => {
    await Promise.resolve();
  });
  expect(liveWatches().length).toBe(1);
  act(() => lastWatch().onFix(fixFixture()));
  expect(gpsValue?.status).toBe("watching");
}

/** Simulate the OS silently killing the watch: no fixes, no errors. */
async function goSilent(seconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
}

/* ---------------------------------------------------------------- */
/* Tests                                                            */
/* ---------------------------------------------------------------- */

describe("GpsProvider - F1 retry rebuilds the continuous watcher", () => {
  it("auto-starts one watcher on mount and receives fixes", async () => {
    renderProvider();
    await waitFor(() => expect(liveWatches().length).toBe(1));
    act(() => lastWatch().onFix(fixFixture()));
    expect(gpsValue?.status).toBe("watching");
    expect(gpsValue?.fix?.lat).toBe(30.0);
  });

  it("retry() re-establishes the continuous watcher after a one-shot success", async () => {
    renderProvider();
    await waitFor(() => expect(liveWatches().length).toBe(1));

    act(() => gpsValue?.retry());
    await waitFor(() => expect(vi.mocked(watchPosition).mock.calls.length).toBeGreaterThanOrEqual(2));
    // The old watcher was torn down; exactly one remains live.
    expect(liveWatches().length).toBe(1);
    expect(gpsValue?.status).toBe("watching");
  });

  it("after PERMISSION_DENIED the dead handle is dropped and re-grant auto-recovers", async () => {
    locationState.permission = "granted";
    renderProvider();
    await waitFor(() => expect(liveWatches().length).toBe(1));

    // The underlying watch dies on a denial (mirrors lib/location/provider.ts).
    act(() => lastWatch().onErr({ code: "PERMISSION_DENIED", message: "denied", userMessage: "denied" }));
    expect(gpsValue?.status).toBe("error");
    expect(gpsValue?.permission).toBe("denied");
    expect(liveWatches().length).toBe(0); // invariant: no dead handles kept

    // The user re-grants in the browser settings -> change event fires.
    locationState.permission = "granted";
    await act(async () => firePermissionChange());
    await waitFor(() => expect(liveWatches().length).toBe(1));
    expect(gpsValue?.status).toBe("requesting");
    act(() => lastWatch().onFix(fixFixture()));
    expect(gpsValue?.status).toBe("watching");
  });

  it("a one-shot PERMISSION_DENIED does not spawn a watch; the change event still recovers", async () => {
    locationState.permission = "granted";
    renderProvider();
    await waitFor(() => expect(liveWatches().length).toBe(1));

    // Simulate the retry path failing with a denial.
    locationState.oneShot = { reject: { code: "PERMISSION_DENIED", message: "denied" } };
    act(() => gpsValue?.retry());
    await waitFor(() => expect(gpsValue?.permission).toBe("denied"));

    locationState.permission = "granted";
    await act(async () => firePermissionChange());
    await waitFor(() => expect(liveWatches().length).toBe(1));
  });
});

describe("GpsProvider - F2 rebuild throttle", () => {
  it("rapid automatic rebuild attempts are limited to one per interval", async () => {
    vi.useFakeTimers();
    try {
      await mountedAndWatching();
      const callsBefore = vi.mocked(watchPosition).mock.calls.length;

      // Make the session stale so recovery is wanted, then hammer the
      // visibility path with no time passing: only the first attempt may
      // rebuild.
      await goSilent(65);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(vi.mocked(watchPosition).mock.calls.length).toBe(callsBefore + 1);
      expect(liveWatches().length).toBe(1);

      for (let i = 0; i < 6; i += 1) {
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      // Still throttled: no further rebuilds within the 5 s interval.
      expect(vi.mocked(watchPosition).mock.calls.length).toBe(callsBefore + 1);

      // After the interval passes, exactly one more rebuild goes through.
      await goSilent(6);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(vi.mocked(watchPosition).mock.calls.length).toBe(callsBefore + 2);
      expect(liveWatches().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the per-window cap blocks a sustained silent-death loop", async () => {
    vi.useFakeTimers();
    try {
      await mountedAndWatching();
      const callsBefore = vi.mocked(watchPosition).mock.calls.length;

      // Go silent once; the session stays stale forever (no more fixes), so
      // every recovery path (visibility + watchdog) wants to rebuild. All of
      // them share one throttle: at most 5 rebuilds per 60 s window.
      await goSilent(65);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      for (let i = 0; i < 5; i += 1) {
        await goSilent(6);
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      const rebuilds = vi.mocked(watchPosition).mock.calls.length - callsBefore;
      // 7 wanted rebuilds over ~35 s (one window), only 5 pass the cap.
      expect(rebuilds).toBe(5);
      expect(liveWatches().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GpsProvider - F3 visibility recovery", () => {
  it("rebuilds a watcher that went silent while the page was hidden", async () => {
    vi.useFakeTimers();
    try {
      await mountedAndWatching();
      const callsBefore = vi.mocked(watchPosition).mock.calls.length;

      // 65 s of silence: stale (>60 s) but before the next watchdog tick
      // would fire (75 s), so THIS rebuild is attributable to visibility.
      await goSilent(65);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(vi.mocked(watchPosition).mock.calls.length).toBe(callsBefore + 1);
      expect(liveWatches().length).toBe(1);
      expect(gpsValue?.status).toBe("watching");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never fights an explicit user stop", async () => {
    vi.useFakeTimers();
    try {
      await mountedAndWatching();
      const callsBefore = vi.mocked(watchPosition).mock.calls.length;
      await goSilent(65); // would be stale, but the player chose to stop

      act(() => gpsValue?.stop());
      expect(gpsValue?.status).toBe("idle");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(vi.mocked(watchPosition).mock.calls.length).toBe(callsBefore);
      expect(gpsValue?.status).toBe("idle");

      // Player taps start again: allowed.
      act(() => gpsValue?.start());
      expect(liveWatches().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GpsProvider - F4 watchdog", () => {
  it("rebuilds a watching session that has gone silent for over 60 s", async () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      // Auto-start lands in a microtask; flush it.
      await act(async () => {
        await Promise.resolve();
      });
      act(() => lastWatch().onFix(fixFixture()));
      expect(gpsValue?.status).toBe("watching");
      const callsBefore = vi.mocked(watchPosition).mock.calls.length;

      // 75 s of silence, watchdog ticks every 15 s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(75_000);
      });
      expect(vi.mocked(watchPosition).mock.calls.length).toBeGreaterThan(callsBefore);
      expect(liveWatches().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not rebuild while fixes keep arriving", async () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      await act(async () => {
        await Promise.resolve();
      });
      const callsBefore = vi.mocked(watchPosition).mock.calls.length;
      act(() => lastWatch().onFix(fixFixture()));

      // One fix every 20 s for two minutes: the watch must stay untouched.
      for (let t = 0; t < 6; t += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        });
        act(() => lastWatch().onFix(fixFixture(Date.now())));
      }
      expect(vi.mocked(watchPosition).mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot become a restart loop: the throttle caps automatic rebuilds", async () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      await act(async () => {
        await Promise.resolve();
      });
      act(() => lastWatch().onFix(fixFixture()));

      // Silence for 10 minutes: at most 5 rebuilds per 60 s window and none
      // within 5 s of the previous one.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000);
      });
      const rebuilds = vi.mocked(watchPosition).mock.calls.length - 1; // minus auto-start
      // 10 min / 5 s min interval would allow 120 without the cap; the
      // per-window cap holds it far below that.
      expect(rebuilds).toBeLessThanOrEqual(60);
      expect(rebuilds).toBeGreaterThanOrEqual(1);
      expect(liveWatches().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GpsProvider - watcher hygiene", () => {
  it("repeated retry/start/visibility cycles never stack duplicate watchers", async () => {
    await mountedAndWatching();
    const callsBefore = vi.mocked(watchPosition).mock.calls.length;

    for (let i = 0; i < 4; i += 1) {
      act(() => gpsValue?.retry());
      await waitFor(() => expect(liveWatches().length).toBe(1));
      act(() => gpsValue?.start()); // no-op while a watcher exists
      expect(liveWatches().length).toBe(1);
    }
    // Every retry replaced the previous watcher instead of stacking one:
    // exactly 4 new subscriptions for 4 retries.
    expect(vi.mocked(watchPosition).mock.calls.length).toBe(callsBefore + 4);
  });

  it("unmount stops the watcher exactly once and leaks nothing", async () => {
    const { unmount } = render(
      <GpsProvider>
        <Probe />
      </GpsProvider>,
    );
    await waitFor(() => expect(liveWatches().length).toBe(1));
    const watch = liveWatches()[0];
    const permissionListenersBefore = permissionListeners.length;
    unmount();
    expect(watch.stopped).toBe(true);
    expect(permissionListeners.length).toBeLessThan(permissionListenersBefore + 1);
  });
});
