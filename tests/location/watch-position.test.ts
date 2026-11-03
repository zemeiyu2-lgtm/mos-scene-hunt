/**
 * watchPosition lifecycle guards (lib/location/provider.ts).
 *
 * B-01 acceptance follow-up: a browser may still deliver callbacks it queued
 * before clearWatch(). The success path already ignored post-stop fixes; the
 * error path gained the same guard after the independent review found a late
 * PERMISSION_DENIED from a replaced watcher could kill the new one. These
 * tests pin both guards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchPosition } from "@/lib/location";

type OkCb = (pos: GeolocationPosition) => void;
type ErrCb = (err: GeolocationPositionError) => void;

const geo = {
  handlers: new Map<number, { ok: OkCb; err: ErrCb }>(),
  cleared: new Set<number>(),
  nextId: 0,
};

function fakePosition(timestamp = Date.now()): GeolocationPosition {
  return {
    coords: {
      latitude: 30,
      longitude: 120,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({
        latitude: 30,
        longitude: 120,
        accuracy: 8,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      }),
    },
    timestamp,
    toJSON: () => ({}),
  } as GeolocationPosition;
}

function fakeError(code: number): GeolocationPositionError {
  return { code, message: "fake", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

beforeEach(() => {
  geo.handlers.clear();
  geo.cleared.clear();
  geo.nextId = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn((ok: OkCb, _err: ErrCb) => {
          const id = ++geo.nextId;
          geo.handlers.set(id, { ok, err: _err });
          return id;
        }),
        clearWatch: vi.fn((id: number) => {
          geo.cleared.add(id);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("watchPosition - lifecycle guards", () => {
  it("delivers fixes and recoverable errors while running", () => {
    const onFix = vi.fn();
    const onError = vi.fn();
    watchPosition(onFix as never, onError as never);

    const h = geo.handlers.get(1)!;
    h.ok(fakePosition(1000));
    h.err(fakeError(3)); // TIMEOUT: recoverable
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(geo.cleared.has(1)).toBe(false); // still watching
  });

  it("a queued fix delivered AFTER stop() never reaches the consumer", () => {
    const onFix = vi.fn();
    const onError = vi.fn();
    const w = watchPosition(onFix as never, onError as never);
    w.stop();
    expect(geo.cleared.has(1)).toBe(true);

    // The browser had already queued this callback before clearWatch ran.
    geo.handlers.get(1)!.ok(fakePosition(2000));
    expect(onFix).not.toHaveBeenCalled();
  });

  it("a queued error delivered AFTER stop() never reaches the consumer (P2 fix)", () => {
    const onFix = vi.fn();
    const onError = vi.fn();
    const w = watchPosition(onFix as never, onError as never);
    w.stop();

    // The dangerous case from the review: a late PERMISSION_DENIED from the
    // OLD watcher arriving after the replacement was created.
    geo.handlers.get(1)!.err(fakeError(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("PERMISSION_DENIED stops the watch and is surfaced exactly once", () => {
    const onFix = vi.fn();
    const onError = vi.fn();
    watchPosition(onFix as never, onError as never);

    const h = geo.handlers.get(1)!;
    h.err(fakeError(1));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(geo.cleared.has(1)).toBe(true);

    // A duplicate queued denial is also swallowed by the stopped guard.
    h.err(fakeError(1));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("still fixes: a regressed timestamp is ignored without touching the consumer", () => {
    const onFix = vi.fn();
    watchPosition(onFix as never, undefined as never);
    const h = geo.handlers.get(1)!;
    h.ok(fakePosition(5000));
    h.ok(fakePosition(4000)); // older than the last accepted fix
    expect(onFix).toHaveBeenCalledTimes(1);
  });
});

/**
 * B-01 P2: `watchPosition()` can throw synchronously instead of reporting
 * through the error callback - an insecure context, a Permissions-Policy that
 * blocks geolocation (sandboxed iframe / embedded webview), or an exotic
 * platform implementation. Before the fix the exception escaped to the caller,
 * which had no way to learn that the subscription was never created.
 */
describe("watchPosition - synchronous failures", () => {
  function throwOnWatch(reason: unknown) {
    (navigator.geolocation as unknown as { watchPosition: unknown }).watchPosition = vi.fn(() => {
      throw reason;
    });
  }

  it("a synchronous throw is surfaced once, classified like any other error", () => {
    throwOnWatch(new TypeError("Illegal invocation"));
    const onFix = vi.fn();
    const onError = vi.fn();

    expect(() => watchPosition(onFix as never, onError as never)).not.toThrow();
    expect(onFix).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as { code: string; userMessage: string };
    expect(err.code).toBe("UNKNOWN");
    expect(err.userMessage).toContain("未知错误");
  });

  it("the inert watcher it returns can be stopped safely (no clearWatch of an unknown id)", () => {
    throwOnWatch(new Error("blocked by permissions policy"));
    const onError = vi.fn();
    const w = watchPosition(vi.fn() as never, onError as never);

    expect(() => w.stop()).not.toThrow();
    expect(geo.cleared.size).toBe(0);
    // stop() is idempotent and does not re-emit the error.
    expect(() => w.stop()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("a throwing geolocation getter is contained too", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        get geolocation(): never {
          throw new Error("geolocation is not available in this context");
        },
      },
    });
    const onError = vi.fn();

    expect(() => watchPosition(vi.fn() as never, onError as never)).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as { code: string }).code).toBe("UNKNOWN");
  });

  it("a synchronous throw without an error handler still does not crash the caller", () => {
    throwOnWatch(new TypeError("boom"));
    expect(() => watchPosition(vi.fn() as never)).not.toThrow();
  });
});
