"use client";

/**
 * GPS provider.
 *
 * Owns exactly one watchPosition subscription for the whole app, plus the
 * simulator override. Components read the latest fix; they never call the
 * Geolocation API themselves.
 *
 * ## Recovery machinery (B-01A)
 *
 * A real outdoor session kills the watch in ways the simple start/stop model
 * never handled. Four layers now guard the same single watcher:
 *
 *  - F1  `retry()` rebuilds the CONTINUOUS watcher (previously it only fired
 *        a one-shot read, leaving the UI stuck on a dead watch), and a
 *        Permissions API `change` listener resumes automatically when the
 *        user re-grants a denied permission. Browsers without the Permissions
 *        API fall back to the retry button, which is always available.
 *  - F2  Every automatic recovery goes through one throttle: at most
 *        `REBUILD_MAX_PER_WINDOW` rebuilds per `REBUILD_WINDOW_MS`, and at
 *        least `REBUILD_MIN_INTERVAL_MS` apart. Manual taps (`retry`, `start`)
 *        bypass the cap - a player who taps retry must never be ignored.
 *  - F3  `visibilitychange` re-checks the watcher when the page becomes
 *        visible again: mobile browsers may have silently dropped the watch
 *        (or the permission) while backgrounded. There is no guarantee the
 *        OS kept delivering fixes in the background; the promise is only
 *        "the game recovers when you come back".
 *  - F4  A 60 s watchdog detects a "watching" session that has produced no
 *        fix for `WATCHDOG_MAX_SILENCE_MS` and rebuilds the watcher (throttled
 *        by F2, so it cannot become a restart loop). While the page is hidden
 *        the watchdog stands down - browsers freeze timers and GPS in the
 *        background, so silence there is expected, not a fault.
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
import { resolveRuntimeMode } from "@/lib/runtime/mode";
import { useSettings } from "./providers";

export type GpsStatus =
  | "idle"          // nothing requested yet
  | "requesting"    // waiting for the first fix
  | "watching"      // receiving updates
  | "error"         // fatal error, the player must act
  | "unsupported";  // no Geolocation API

/** Automatic rebuilds are capped so a broken environment cannot loop. */
const REBUILD_MIN_INTERVAL_MS = 5_000;
const REBUILD_MAX_PER_WINDOW = 5;
const REBUILD_WINDOW_MS = 60_000;
/**
 * Watching but silent for this long => assume the watch died silently
 * (mobile OS throttling, page freeze) and rebuild. Chosen above the slowest
 * legitimate fix cadence a phone produces outdoors (~1 Hz) and below the
 * point where the map feels dead to a player.
 */
const WATCHDOG_MAX_SILENCE_MS = 60_000;
const WATCHDOG_TICK_MS = 15_000;

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
  /** Re-run the one-shot request AND rebuild the continuous watcher. */
  retry: () => void;
  /** Force a specific fix (used by the simulator). */
  injectFix: (fix: PositionFix) => void;
  /* --- Diagnostics (B-01D, display-only: never drives the engine) --- */
  /** Wall-clock ms of the last accepted fix (0 = none yet). */
  lastFixAt: number;
  /** True while a watcher subscription handle exists. */
  watcherAlive: boolean;
  /** How many automatic recoveries (watchdog/visibility/permission) ran. */
  autoRebuildCount: number;
}

const GpsContext = createContext<GpsContextValue | null>(null);

export function GpsProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [fix, setFix] = useState<PositionFix | null>(null);
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [error, setError] = useState<GeoError | null>(null);
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [simulatorAvailable, setSimulatorAvailable] = useState(false);
  // Diagnostics mirrors (B-01D): refs are the source of truth for timers,
  // these states expose the same facts to the read-only diagnostics view.
  const [lastFixAt, setLastFixAt] = useState(0);
  const [watcherAlive, setWatcherAlive] = useState(false);
  const [autoRebuildCount, setAutoRebuildCount] = useState(0);

  const watcherRef = useRef<{ stop: () => void } | null>(null);
  const mountedRef = useRef(true);
  /** Wall-clock time of the last accepted fix (simulated or real). */
  const lastFixAtRef = useRef(0);
  /** Set when the PLAYER stopped watching; automatic recovery must respect it. */
  const stoppedByUserRef = useRef(false);
  /** Timestamps of automatic rebuilds, for the F2 throttle. */
  const rebuildsRef = useRef<number[]>([]);
  /**
   * True while the DEV simulator is enabled and therefore authoritative.
   * Mirrored into a ref because the watchPosition callback closes over its
   * initial value and cannot see later state.
   */
  const simulatorActiveRef = useRef(false);
  /** Mirrors `status` for timer callbacks that must not re-subscribe. */
  const statusRef = useRef<GpsStatus>(status);
  statusRef.current = status;
  /**
   * Instance identity of the current watcher subscription. Every
   * `beginWatching()` mints a new generation; callbacks captured by an older
   * subscription no-op once superseded. The lib-level `stopped` guard blocks
   * late deliveries in production, and this ref makes the provider immune
   * even to callbacks that slip past it (belt and braces, B-01 review P2).
   */
  const watchGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    setSimulatorAvailable(isSimulatorAvailable());
    void queryPermission().then((p) => mountedRef.current && setPermission(p));
    return () => {
      mountedRef.current = false;
      watcherRef.current?.stop();
      watcherRef.current = null;
      setWatcherAlive(false);
    };
  }, []);

  const injectFix = useCallback((next: PositionFix) => {
    simulatorActiveRef.current = Boolean(next.simulated) || simulatorActiveRef.current;
    lastFixAtRef.current = Date.now();
    setLastFixAt(lastFixAtRef.current);
    setFix(next);
    setStatus("watching");
    setError(null);
  }, []);

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    watcherRef.current?.stop();
    watcherRef.current = null;
    setWatcherAlive(false);
    setStatus((s) => (s === "watching" ? "idle" : s));
  }, []);

  /** Is an automatic rebuild allowed right now (F2 throttle)? */
  const canAutoRebuild = useCallback((): boolean => {
    const now = Date.now();
    const recent = rebuildsRef.current.filter((t) => now - t < REBUILD_WINDOW_MS);
    rebuildsRef.current = recent;
    if (recent.length >= REBUILD_MAX_PER_WINDOW) return false;
    if (recent.length > 0 && now - recent[recent.length - 1] < REBUILD_MIN_INTERVAL_MS) return false;
    return true;
  }, []);

  const recordRebuild = useCallback((): void => {
    rebuildsRef.current.push(Date.now());
    setAutoRebuildCount((c) => c + 1);
  }, []);

  /**
   * Tear down any existing watcher and create exactly one new one.
   * Always stops the previous subscription first, so repeated calls can
   * never stack duplicate watchers or leak listeners.
   */
  const beginWatching = useCallback(() => {
    watcherRef.current?.stop();
    const generation = ++watchGenerationRef.current;
    watcherRef.current = watchPosition(
      (next) => {
        if (!mountedRef.current || watchGenerationRef.current !== generation) return;
        // While the simulator is enabled it is the single source of truth. A
        // real fix arriving a moment later must not yank the developer's
        // simulated position back to their desk mid-test.
        if (simulatorActiveRef.current) return;
        lastFixAtRef.current = Date.now();
        setLastFixAt(lastFixAtRef.current);
        setFix(next);
        setStatus("watching");
        setError(null);
      },
      (err) => {
        if (!mountedRef.current || watchGenerationRef.current !== generation) return;
        // Recoverable errors keep the previous fix on screen; only surface the
        // fatal ones as a blocking state.
        setError(err);
        if (err.code === "PERMISSION_DENIED" || err.code === "UNSUPPORTED") {
          setStatus(err.code === "UNSUPPORTED" ? "unsupported" : "error");
          if (err.code === "PERMISSION_DENIED") {
            setPermission("denied");
            // The low-level watcher has already cleared itself on denial;
            // drop our handle so the invariant "handle exists => watching"
            // stays true and F1/F3 recovery can engage later.
            watcherRef.current?.stop();
            watcherRef.current = null;
            setWatcherAlive(false);
          }
        }
      },
      { maximumAgeMs: 2000 },
    );
    setWatcherAlive(true);
  }, []);

  /**
   * Automatic rebuild path (watchdog / visibility / permission change).
   * Never fights an explicit user stop, and is always throttled (F2).
   */
  const rebuildWatcher = useCallback((): boolean => {
    if (stoppedByUserRef.current) return false;
    if (!canAutoRebuild()) return false;
    recordRebuild();
    // Recovering from a blocking error must surface as "requesting" again;
    // a silent-death rebuild while "watching" keeps that status until the
    // new watcher produces its first fix (or fails).
    setStatus((s) => (s === "error" ? "requesting" : s));
    beginWatching();
    return true;
  }, [beginWatching, canAutoRebuild, recordRebuild]);

  const retry = useCallback(() => {
    // F1: the retry button must restore CONTINUOUS positioning, not just a
    // one-shot read. Manual action bypasses the rebuild throttle.
    stoppedByUserRef.current = false;
    setError(null);
    setStatus("requesting");
    watcherRef.current?.stop();
    watcherRef.current = null;
    setWatcherAlive(false);
    getCurrentPosition()
      .then((first) => {
        if (!mountedRef.current) return;
        setFix(first);
        setPermission("granted");
        lastFixAtRef.current = Date.now();
        setLastFixAt(lastFixAtRef.current);
        setStatus("watching");
        beginWatching();
      })
      .catch((err: GeoError) => {
        if (!mountedRef.current) return;
        setError(err);
        setStatus(err.code === "UNSUPPORTED" ? "unsupported" : "error");
        if (err.code === "PERMISSION_DENIED") setPermission("denied");
        // A one-shot failure says nothing about whether a watch would work;
        // still try to establish it so a flaky first read cannot leave the
        // session permanently dead.
        if (err.code !== "UNSUPPORTED" && err.code !== "PERMISSION_DENIED") {
          beginWatching();
        }
      });
  }, [beginWatching]);

  const start = useCallback(() => {
    stoppedByUserRef.current = false;
    if (watcherRef.current) return;
    setStatus((s) => (s === "idle" || s === "error" ? "requesting" : s));
    setError(null);
    beginWatching();
  }, [beginWatching]);

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
   * F1 (second half): follow permission changes while mounted.
   *
   * When the user re-grants a previously denied permission, the watch (if it
   * died on the denial) is rebuilt automatically - no reload, no manual tap.
   * When a permission is revoked mid-session the low-level watch stops and
   * the error UI shows; recovery on re-grant is automatic.
   *
   * Browsers without the Permissions API never register a listener; the
   * retry button remains the manual fallback there.
   */
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return;
    let disposed = false;
    let disposeListener: (() => void) | null = null;

    const onPermissionChange = () => {
      if (disposed || !mountedRef.current) return;
      void queryPermission().then((p) => {
        if (disposed || !mountedRef.current) return;
        setPermission(p);
        if (p === "granted") {
          // Re-granted: restore the watch unless the player stopped it or the
          // throttle window is saturated (the watchdog will catch up).
          if (!watcherRef.current && statusRef.current !== "unsupported") {
            rebuildWatcher();
          }
        } else if (p === "denied") {
          setError(null);
        }
      });
    };

    perms
      .query({ name: "geolocation" as PermissionName })
      .then((permissionStatus) => {
        if (disposed) return;
        permissionStatus.addEventListener("change", onPermissionChange);
        disposeListener = () => permissionStatus.removeEventListener("change", onPermissionChange);
      })
      .catch(() => {
        /* Permissions API present but geolocation not queryable: fallback path */
      });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, [rebuildWatcher]);

  /**
   * F3: when the page becomes visible again after backgrounding, mobile
   * browsers may have silently killed the watch. Re-check permission and
   * rebuild a dead or stale watcher. No guarantee is made about background
   * delivery itself - only about recovery on return.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (!mountedRef.current || document.visibilityState !== "visible") return;
      void queryPermission().then((p) => {
        if (mountedRef.current) setPermission(p);
      });
      if (stoppedByUserRef.current) return;
      const watcherAlive = watcherRef.current !== null;
      const fixStale = lastFixAtRef.current > 0 && Date.now() - lastFixAtRef.current > WATCHDOG_MAX_SILENCE_MS;
      if (!watcherAlive || fixStale) {
        rebuildWatcher();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [rebuildWatcher]);

  /**
   * F4: watchdog. While "watching", a session silent for 60 s is presumed
   * dead and rebuilt (throttled by F2 so it can never become a restart
   * loop). Stands down while hidden and for explicit user stops; a session
   * that has NEVER produced a fix is left to the one-shot error paths
   * (first-fix latency is bounded by the watch timeout, not by this timer).
   */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!mountedRef.current || document.hidden) return;
      if (stoppedByUserRef.current) return;
      if (statusRef.current !== "watching") return;
      if (!watcherRef.current) {
        rebuildWatcher();
        return;
      }
      if (lastFixAtRef.current > 0 && Date.now() - lastFixAtRef.current > WATCHDOG_MAX_SILENCE_MS) {
        rebuildWatcher();
      }
    }, WATCHDOG_TICK_MS);
    return () => window.clearInterval(id);
  }, [rebuildWatcher]);

  /**
   * Push simulator fixes into the same channel as real ones.
   * The tick is deliberately slow (1 Hz): a jittering marker at 60 fps is
   * unreadable and would thrash the game reducer.
   */
  const simulatorCoordinate = settings.simulatorCoordinate;
  const simEnabled = settings.simulatorEnabled && simulatorCoordinate !== null;
  /**
   * In demo mode the autopilot owns a dedicated injection channel and must be
   * the single source of simulated fixes - a leftover player setting must not
   * fight it (or leak a second source of fake positions into the session).
   */
  const demoMode = useRef<boolean | null>(null);
  if (demoMode.current === null) {
    demoMode.current =
      typeof window !== "undefined" && resolveRuntimeMode() === "demo";
  }
  useEffect(() => {
    if (!simEnabled || demoMode.current || !simulatorAvailable) {
      simulatorActiveRef.current = false;
      return;
    }
    // Claim authority *before* the first tick so a real fix racing in during
    // the same frame cannot win.
    simulatorActiveRef.current = true;
    const push = () => {
      const next = simulateFix({
        enabled: true,
        coordinate: simulatorCoordinate,
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
    simulatorCoordinate,
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
      lastFixAt,
      watcherAlive,
      autoRebuildCount,
    }),
    [fix, status, error, permission, simulatorAvailable, start, stop, retry, injectFix, lastFixAt, watcherAlive, autoRebuildCount],
  );

  return <GpsContext.Provider value={value}>{children}</GpsContext.Provider>;
}

export function useGps(): GpsContextValue {
  const ctx = useContext(GpsContext);
  if (!ctx) throw new Error("useGps must be used inside <GpsProvider>");
  return ctx;
}
