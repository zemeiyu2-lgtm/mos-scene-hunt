// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GpsProvider, useGps } from "@/components/gps-provider";

const mocks = vi.hoisted(() => ({
  getCurrentPosition: vi.fn(),
  isGeolocationSupported: vi.fn(() => true),
  isSimulatorAvailable: vi.fn(() => false),
  queryPermission: vi.fn(() => Promise.resolve("granted")),
  simulateFix: vi.fn(),
  watchPosition: vi.fn(),
  watchCalls: [] as Array<{
    onFix: (fix: any) => void;
    onError: (error: any) => void;
    stop: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@/lib/location", () => ({
  getCurrentPosition: mocks.getCurrentPosition,
  isGeolocationSupported: mocks.isGeolocationSupported,
  isSimulatorAvailable: mocks.isSimulatorAvailable,
  queryPermission: mocks.queryPermission,
  simulateFix: mocks.simulateFix,
  watchPosition: mocks.watchPosition,
}));

vi.mock("@/components/providers", () => ({
  useSettings: () => ({
    settings: { simulatorEnabled: false, simulatorCoordinate: null },
  }),
}));

function Probe() {
  const { status, retry } = useGps();
  return (
    <div>
      <output data-testid="gps-status">{status}</output>
      <button type="button" onClick={retry}>重新定位</button>
    </div>
  );
}

const recoveredFix = {
  lat: 14.5995,
  lng: 120.9842,
  accuracy: 12,
  timestamp: 1_800_000_000_000,
  altitude: null,
  heading: null,
  speed: null,
  simulated: false,
};

describe("GPS retry recovery", () => {
  beforeEach(() => {
    mocks.watchCalls.length = 0;
    mocks.getCurrentPosition.mockReset().mockResolvedValue(recoveredFix);
    mocks.isGeolocationSupported.mockReturnValue(true);
    mocks.isSimulatorAvailable.mockReturnValue(false);
    mocks.queryPermission.mockResolvedValue("granted");
    mocks.simulateFix.mockReset();
    mocks.watchPosition.mockReset().mockImplementation((onFix, onError) => {
      const stop = vi.fn();
      mocks.watchCalls.push({ onFix, onError, stop });
      return { stop };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("replaces a stale watcher and resumes continuous updates after permission is restored", async () => {
    render(
      <GpsProvider>
        <Probe />
      </GpsProvider>,
    );

    await waitFor(() => expect(mocks.watchCalls).toHaveLength(1));
    expect(screen.getByTestId("gps-status").textContent).toBe("requesting");

    act(() => {
      mocks.watchCalls[0].onError({
        code: "PERMISSION_DENIED",
        userMessage: "定位权限被拒绝",
      });
    });
    await waitFor(() => expect(screen.getByTestId("gps-status").textContent).toBe("error"));

    fireEvent.click(screen.getByRole("button", { name: "重新定位" }));

    await waitFor(() => expect(mocks.watchCalls).toHaveLength(2));
    expect(mocks.watchCalls[0].stop).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentPosition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("gps-status").textContent).toBe("watching"));

    // A fresh watcher must be live after retry, not just a one-shot position fix.
    act(() => {
      mocks.watchCalls[1].onFix({ ...recoveredFix, lat: 14.6 });
    });
    expect(screen.getByTestId("gps-status").textContent).toBe("watching");
  });
});
