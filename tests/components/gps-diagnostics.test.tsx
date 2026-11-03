// @vitest-environment jsdom
/**
 * GPS diagnostics chip (components/gps-diagnostics.tsx, B-01D).
 *
 * Pins the read-only contract: the chip reflects provider state accurately,
 * never renders coordinates, and never drives the engine (no start/retry).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act, fireEvent } from "@testing-library/react";

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
  oneShot: null as null | { resolve?: unknown; reject?: { code: string; message: string } },
  watches: [] as FakeWatch[],
  nextId: 0,
};

function fixFixture(accuracy = 8) {
  return {
    lat: 30.0,
    lng: 120.0,
    accuracy,
    timestamp: Date.now(),
    altitude: null,
    heading: null,
    speed: null,
    simulated: false,
  };
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

import { GpsProvider } from "@/components/gps-provider";
import { GpsDiagnosticsChip } from "@/components/gps-diagnostics";

beforeEach(() => {
  locationState.permission = "granted";
  locationState.oneShot = null;
  locationState.watches = [];
  locationState.nextId = 0;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderChip() {
  return render(
    <GpsProvider>
      <GpsDiagnosticsChip />
    </GpsProvider>,
  );
}

describe("GpsDiagnosticsChip", () => {
  it("is collapsed by default and shows no technical detail", () => {
    renderChip();
    expect(screen.getByTestId("gps-diagnostics-toggle")).toBeTruthy();
    expect(screen.queryByTestId("gps-diagnostics-panel")).toBeNull();
  });

  it("expands to read-only rows reflecting live state, without coordinates", async () => {
    renderChip();
    await waitFor(() => expect(locationState.watches.some((w) => !w.stopped)).toBe(true));

    // A real fix arrives: status flips to watching, accuracy becomes visible.
    act(() => {
      locationState.watches.filter((w) => !w.stopped)[0].onFix(fixFixture(8));
    });
    fireEvent.click(screen.getByTestId("gps-diagnostics-toggle"));
    const panel = screen.getByTestId("gps-diagnostics-panel");
    expect(panel.textContent).toContain("监听中");
    expect(panel.textContent).toContain("已允许");
    expect(panel.textContent).toContain("运行中");
    expect(panel.textContent).toContain("优 (≤10m)");
    expect(panel.textContent).toContain("刚刚");
    // No coordinate figures ever.
    expect(panel.textContent).not.toContain("30.0");
    expect(panel.textContent).not.toContain("120.0");
  });

  it("counts an automatic recovery when visibility rebuilds a stale watcher", async () => {
    vi.useFakeTimers();
    try {
      renderChip();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(locationState.watches.some((w) => !w.stopped)).toBe(true);
      act(() => {
        locationState.watches.filter((w) => !w.stopped)[0].onFix(fixFixture());
      });

      // The OS silently killed the watch; fixes stop for over a minute, so
      // the fix is stale when the page becomes visible again.
      for (const w of locationState.watches) w.stopped = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      fireEvent.click(screen.getByTestId("gps-diagnostics-toggle"));
      const panel = screen.getByTestId("gps-diagnostics-panel");
      expect(panel.textContent).toContain("1 次");
      expect(panel.textContent).toContain("运行中");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never drives the engine: the chip renders no start/retry controls", () => {
    renderChip();
    expect(screen.queryByText("获取我的位置")).toBeNull();
    expect(screen.queryByText("重新请求定位")).toBeNull();
  });
});
