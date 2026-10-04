/**
 * MOS Scene Hunt - core geospatial types.
 *
 * These types are deliberately free of any framework dependency so that the
 * same code can later run in a Web Worker, a Node test, or a native shell.
 */

/** WGS84 decimal degrees coordinate. */
export interface Coordinate {
  lat: number;
  lng: number;
}

/** A place in the real world that a scene is anchored to. */
export interface Location {
  lat: number;
  lng: number;
  /** Metres. Defaults to DEFAULT_TRIGGER_RADIUS when omitted. */
  radius?: number;
  name?: string;
}

/** A single GPS fix, plus the metadata needed for sane error handling. */
export interface PositionFix {
  lat: number;
  lng: number;
  /** Accuracy radius in metres as reported by the device. */
  accuracy: number;
  /** Unix epoch milliseconds when the fix was taken. */
  timestamp: number;
  /** Altitude in metres, when the device provides it. */
  altitude?: number | null;
  /** Degrees. */
  heading?: number | null;
  /** Metres per second. */
  speed?: number | null;
  /** True when this fix came from the DEV simulator rather than the device. */
  simulated?: boolean;
}

/**
 * Trigger radii offered by the game. Reality has GPS error, so no location ever
 * uses a zero radius. Authors pick one of these presets per scene.
 */
export const TRIGGER_RADIUS_PRESETS = [20, 30, 50, 80, 100] as const;
export type TriggerRadiusPreset = (typeof TRIGGER_RADIUS_PRESETS)[number];

/** Default trigger radius, per spec section 8. */
export const DEFAULT_TRIGGER_RADIUS = 50;

/** Mean Earth radius in metres (IUGG). */
export const EARTH_RADIUS_M = 6371008.8;

/**
 * If the device reports an accuracy worse than this, we surface a warning
 * instead of silently trusting the fix for triggering.
 */
export const POOR_ACCURACY_THRESHOLD_M = 100;

/** A fix older than this is considered stale and should not trigger a scene. */
export const STALE_FIX_THRESHOLD_MS = 60_000;
