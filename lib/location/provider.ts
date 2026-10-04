/**
 * Geolocation provider layer.
 *
 * Everything that touches `navigator.geolocation` lives here and nowhere else.
 * React components consume positions through `GeoProvider`, so a future WebXR or
 * native build can swap the provider without touching game logic.
 */

import {
  isValidCoordinate,
  hasZeroCoordinate,
} from "./geodesy";
import type { PositionFix } from "./types";

export type PermissionState = "unknown" | "granted" | "denied" | "prompt" | "unsupported";

export type GeoErrorCode =
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "INVALID_FIX"
  | "UNKNOWN";

export class GeoError extends Error {
  code: GeoErrorCode;
  /** Player-facing, actionable wording. */
  readonly userMessage: string;

  constructor(code: GeoErrorCode, message: string, userMessage: string) {
    super(message);
    this.name = "GeoError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

const ERROR_COPY: Record<GeoErrorCode, string> = {
  PERMISSION_DENIED: "定位权限被拒绝。请在浏览器地址栏的站点设置中允许定位后重试。",
  POSITION_UNAVAILABLE: "暂时无法获取卫星定位，请到室外或开阔处再试。",
  TIMEOUT: "定位超时。请确认已开启系统定位服务后重试。",
  UNSUPPORTED: "当前浏览器不支持定位功能，无法开始寻宝。",
  INVALID_FIX: "收到无效的定位数据，正在重试。",
  UNKNOWN: "定位出现未知错误，请重试。",
};

function toGeoError(err: unknown): GeoError {
  const e = err as { code?: number; message?: string };
  switch (e?.code) {
    case 1:
      return new GeoError("PERMISSION_DENIED", e.message ?? "denied", ERROR_COPY.PERMISSION_DENIED);
    case 2:
      return new GeoError(
        "POSITION_UNAVAILABLE",
        e.message ?? "unavailable",
        ERROR_COPY.POSITION_UNAVAILABLE,
      );
    case 3:
      return new GeoError("TIMEOUT", e.message ?? "timeout", ERROR_COPY.TIMEOUT);
    default:
      return new GeoError("UNKNOWN", e?.message ?? "unknown", ERROR_COPY.UNKNOWN);
  }
}

function toFix(position: GeolocationPosition): PositionFix {
  const c = position.coords;
  if (!isValidCoordinate({ lat: c.latitude, lng: c.longitude })) {
    throw new GeoError("INVALID_FIX", "non-finite coords", ERROR_COPY.INVALID_FIX);
  }
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: typeof c.accuracy === "number" && Number.isFinite(c.accuracy) ? c.accuracy : 9999,
    timestamp: position.timestamp || Date.now(),
    altitude: typeof c.altitude === "number" ? c.altitude : null,
    heading: typeof c.heading === "number" && !Number.isNaN(c.heading) ? c.heading : null,
    speed: typeof c.speed === "number" && !Number.isNaN(c.speed) ? c.speed : null,
    simulated: false,
  };
}

/** Options mirroring the W3C API but with game-friendly defaults. */
export interface WatchOptions {
  /** Accept a cached fix up to this age. Default 0 = force a fresh read. */
  maximumAgeMs?: number;
  /** Give up after this long. Default 15s - outdoor first fix can be slow. */
  timeoutMs?: number;
  /** Do not accept fixes worse than this. Default 150 m. */
  minAccuracyM?: number;
}

const DEFAULTS: Required<WatchOptions> = {
  maximumAgeMs: 0,
  timeoutMs: 15_000,
  minAccuracyM: 150,
};

export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * One-shot position read.
 * Automatically retries once with relaxed constraints when the first attempt
 * times out, which is the single most common failure on real phones.
 */
export function getCurrentPosition(options: WatchOptions = {}): Promise<PositionFix> {
  const opts = { ...DEFAULTS, ...options };

  if (!isGeolocationSupported()) {
    return Promise.reject(new GeoError("UNSUPPORTED", "no geolocation", ERROR_COPY.UNSUPPORTED));
  }

  const attempt = (attemptOpts: Required<WatchOptions>) =>
    new Promise<PositionFix>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          try {
            const fix = toFix(pos);
            if (fix.accuracy > attemptOpts.minAccuracyM) {
              // Accuracy gate: reject so the caller can show retry UI rather
              // than trigger a scene on a 2 km cellular-tower fix.
              reject(
                new GeoError(
                  "INVALID_FIX",
                  `accuracy ${fix.accuracy}m > ${attemptOpts.minAccuracyM}m`,
                  `当前定位精度不足（±${Math.round(fix.accuracy)} m），请稍候重试。`,
                ),
              );
              return;
            }
            resolve(fix);
          } catch (err) {
            reject(toGeoError(err));
          }
        },
        (err) => reject(toGeoError(err)),
        {
          enableHighAccuracy: true,
          maximumAge: attemptOpts.maximumAgeMs,
          timeout: attemptOpts.timeoutMs,
        },
      );
    });

  return attempt(opts).catch((err: GeoError) => {
    if (err.code === "TIMEOUT" || err.code === "INVALID_FIX") {
      // Second chance: accept a slightly stale, less precise fix.
      return attempt({
        maximumAgeMs: 30_000,
        timeoutMs: 30_000,
        minAccuracyM: Math.max(opts.minAccuracyM, 500),
      });
    }
    throw err;
  });
}

export interface Watcher {
  stop(): void;
}

/**
 * Continuous position updates.
 *
 * `onFix` fires for every accepted reading. `onError` fires for recoverable
 * errors and the watch keeps running; permanently fatal errors (permission
 * denied) stop the watch and are surfaced once.
 */
export function watchPosition(
  onFix: (fix: PositionFix) => void,
  onError?: (err: GeoError) => void,
  options: WatchOptions = {},
): Watcher {
  const opts = { ...DEFAULTS, ...options };

  if (!isGeolocationSupported()) {
    onError?.(new GeoError("UNSUPPORTED", "no geolocation", ERROR_COPY.UNSUPPORTED));
    return { stop: () => {} };
  }

  let stopped = false;
  let lastFixAt = 0;

  const id = navigator.geolocation.watchPosition(
    (pos) => {
      if (stopped) return;
      let fix: PositionFix;
      try {
        fix = toFix(pos);
      } catch (err) {
        onError?.(toGeoError(err));
        return;
      }
      // Guard against the classic duplicate/regressed fix: ignore readings that
      // are older than the last one we accepted.
      if (fix.timestamp < lastFixAt) return;
      lastFixAt = fix.timestamp;

      if (hasZeroCoordinate(fix) && fix.accuracy > 1000) {
        onError?.(new GeoError("INVALID_FIX", "null island", ERROR_COPY.INVALID_FIX));
        return;
      }
      onFix(fix);
    },
    (err) => {
      const geoErr = toGeoError(err);
      onError?.(geoErr);
      if (geoErr.code === "PERMISSION_DENIED") {
        stopped = true;
        try {
          navigator.geolocation.clearWatch(id);
        } catch {
          /* ignore */
        }
      }
    },
    { enableHighAccuracy: true, maximumAge: opts.maximumAgeMs, timeout: opts.timeoutMs },
  );

  return {
    stop() {
      stopped = true;
      try {
        navigator.geolocation.clearWatch(id);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Query the Permissions API when available, falling back to "unknown". */
export async function queryPermission(): Promise<PermissionState> {
  if (typeof navigator === "undefined") return "unknown";
  if (!isGeolocationSupported()) return "unsupported";
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return "unknown";
    const status = await perms.query({ name: "geolocation" as PermissionName });
    return status.state as PermissionState;
  } catch {
    return "unknown";
  }
}

/** Convert a raw lat/lng pair typed by a human into a validated Coordinate. */
export function parseCoordinateInput(latText: string, lngText: string) {
  const lat = Number.parseFloat(String(latText).trim());
  const lng = Number.parseFloat(String(lngText).trim());
  const coord = { lat, lng };
  return { coord, valid: isValidCoordinate(coord) };
}

export { ERROR_COPY as geoErrorCopy };
