"use client";

/**
 * GPS provider.
 *
 * Owns exactly one watchPosition subscription for the whole app, plus the
 * simulator override. Components read the latest fix; they never call the
 * Geolocation API themselves.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getCurrentPosition,
  isGeolocationSupported,
  isSimulatorAvailable,
  queryPermission,
  simulateFix,
  watchPosition,
  type GeoError,
  type PermissionState,
  type PositionFix,
} from "@/lib/location";
import { useSettings } from "./providers";

export type GpsStatus =
  | "idle"          // nothing requested yet
  | "requesting"    // waiting for the first fix
  | "watching"      // receiving updates
  | "error"         // fatal error, the player must act
  | "unsupported";  // no Geolocation API

interface GpsContextValue {
  fix: PositionFix | null;
  status: GpsStatus;
  error: GeoError | null;
  permission: PermissionState;
  /** True when the last fix came from the simulator. */
  isSimulated: boolean;
  simulatorAvailable: boolean;
  /** Request the first fix and begin watching. Safe to call repeatedly. */
  start: () => void;
  /** Stop watching and clear the error (keeps the last fix). */
  stop: () => void;
  /** Re-run the one-shot request, for the "retry" button. */
  retry: () => void;
  /** Force a specific fix (used by the simulator). */
  injectFix: (fix: PositionFix) => void;
}

const GpsContext = createContext<GpsContextValue | null>(null);

export function GpsProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [fix, setFix] = useState<PositionFix | null>(null);
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [error, setError] = useState<GeoError | null>(null);
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [simulatorAvailable, setSimulatorAvailable] = useState(false);

  const watcherRef = useRef<{ stop: () => void } | null>(null);
  const mountedRef = useRef(true);
  /**
   * True while the DEV simulator is enabled and therefore authoritative.
   * Mirrored into a ref because the watchPosition callback closes over its
   * initial value and cannot see later state.
   */
  const simulatorActiveRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setSimulatorAvailable(isSimulatorAvailable());
    void queryPermission().then((p) => mountedRef.current && setPermission(p));
    return () => {
      mountedRef.current = false;
      watcherRef.current?.stop();
      watcherRef.current = null;
    };
  }, []);

  const injectFix = useCallback((next: PositionFix) => {
    simulatorActiveRef.current = Boolean(next.simulated) || simulatorActiveRef.current;
    setFix(next);
    setStatus("watching");
    setError(null);
  }, []);

  const stop = useCallback(() => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setStatus((s) => (s === "watching" ? "idle" : s));
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setStatus("requesting");
    getCurrentPosition()
      .then((first) => {
        if (!mountedRef.current) return;
        setFix(first);
        setPermission("granted");
        setStatus("watching");
      })
      .catch((err: GeoError) => {
        if (!mountedRef.current) return;
        setError(err);
        setStatus(err.code === "UNSUPPORTED" ? "unsupported" : "error");
        if (err.code === "PERMISSION_DENIED") setPermission("denied");
      });
  }, []);

  const start = useCallback(() => {
    if (watcherRef.current) return;
    setStatus((s) => (s === "idle" || s === "error" ? "requesting" : s));
    setError(null);

    watcherRef.current = watchPosition(
      (next) => {
        if (!mountedRef.current) return;
        // While the simulator is enabled it is the single source of truth. A
        // real fix arriving a moment later must not yank the developer's
        // simulated position back to their desk mid-test.
        if (simulatorActiveRef.current) return;
        setFix(next);
        setStatus("watching");
        setError(null);
      },
      (err) => {
        if (!mountedRef.current) return;
        // Recoverable errors keep the previous fix on screen; only surface the
        // fatal ones as a blocking state.
        setError(err);
        if (err.code === "PERMISSION_DENIED" || err.code === "UNSUPPORTED") {
          setStatus(err.code === "UNSUPPORTED" ? "unsupported" : "error");
          if (err.code === "PERMISSION_DENIED") setPermission("denied");
        }
      },
      { maximumAgeMs: 2000 },
    );
  }, []);

  /**
   * Auto-start positioning on first mount.
   *
   * The spec's core flow is "进入游戏 -> 请求 GPS 权限 -> 取得玩家位置 -> 显示地图",
   * so waiting for a manual button tap would break the intended sequence. We also
   * probe the permission synchronously first: when it is already granted the
   * browser shows no prompt at all, and when it is denied we skip straight to the
   * actionable error instead of silently doing nothing.
   */
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (typeof navigator === "undefined" || !isGeolocationSupported()) {
      autoStartedRef.current = true;
      setStatus("unsupported");
      return;
    }
    autoStartedRef.current = true;
    start();
  }, [start]);

  /**
   * Push simulator fixes into the same channel as real ones.
   * The tick is deliberately slow (1 Hz): a jittering marker at 60 fps is
   * unreadable and would thrash the game reducer.
   */
  const simEnabled = settings.simulatorEnabled && settings.simulatorCoordinate !== null;
  useEffect(() => {
    if (!simEnabled || !simulatorAvailable) {
      simulatorActiveRef.current = false;
      return;
    }
    // Claim authority *before* the first tick so a real fix racing in during
    // the same frame cannot win.
    simulatorActiveRef.current = true;
    const push = () => {
      const next = simulateFix({
        enabled: true,
        coordinate: settings.simulatorCoordinate,
        jitter: false,
        jitterMetres: 0,
        accuracy: 8,
        speedMps: 1.4,
      });
      if (next) injectFix(next);
    };
    push();
    const id = window.setInterval(push, 1000);
    return () => window.clearInterval(id);
  }, [
    simEnabled,
    simulatorAvailable,
    settings.simulatorCoordinate?.lat,
    settings.simulatorCoordinate?.lng,
    injectFix,
  ]);

  const value = useMemo<GpsContextValue>(
    () => ({
      fix,
      status,
      error,
      permission,
      isSimulated: Boolean(fix?.simulated),
      simulatorAvailable,
      start,
      stop,
      retry,
      injectFix,
    }),
    [fix, status, error, permission, simulatorAvailable, start, stop, retry, injectFix],
  );

  return <GpsContext.Provider value={value}>{children}</GpsContext.Provider>;
}

export function useGps(): GpsContextValue {
  const ctx = useContext(GpsContext);
  if (!ctx) throw new Error("useGps must be used inside <GpsProvider>");
  return ctx;
}
