/**
 * DEV GPS SIMULATOR.
 *
 * Purpose: develop and test the whole "move -> trigger -> unlock" loop without
 * physically walking to the test coordinates.
 *
 * Safety: this module is inert in production. `isSimulatorAvailable()` requires
 * BOTH a non-production build AND an explicit opt-in flag, so a stray import can
 * never hand a player fake coordinates.
 */

import type { Coordinate, PositionFix } from "../location/types";

/**
 * The simulator is compiled in only when the app is built for development, or
 * when the operator explicitly sets NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1 on a
 * preview deployment (useful for stakeholder demos on a hosted URL).
 */
export function isSimulatorAvailable(): boolean {
  const explicitOptIn =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ENABLE_GPS_SIMULATOR === "1";
  const isDevBuild = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
  return isDevBuild || explicitOptIn;
}

/** Why the simulator is unavailable, for display in the settings sheet. */
export function simulatorAvailabilityReason(): string | null {
  if (isSimulatorAvailable()) return null;
  return "模拟定位仅在开发环境或显式开启的预览环境中可用。";
}

export interface SimulatorConfig {
  enabled: boolean;
  /** Fixed coordinate the player is teleported to. */
  coordinate: Coordinate | null;
  /** When true, JitterGenerator adds a small random walk each tick. */
  jitter: boolean;
  /** Peak jitter magnitude in metres. */
  jitterMetres: number;
  /** Emulated accuracy in metres. */
  accuracy: number;
  /** Emulated movement speed in metres per second, used by "walk to" mode. */
  speedMps: number;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  enabled: false,
  coordinate: null,
  jitter: false,
  jitterMetres: 5,
  accuracy: 8,
  speedMps: 1.4,
};

const METRES_PER_DEG_LAT = 111_320;

/** Offset a coordinate by a metre-based east/north delta. */
export function offsetCoordinate(origin: Coordinate, northM: number, eastM: number): Coordinate {
  const lat = origin.lat + northM / METRES_PER_DEG_LAT;
  const cosLat = Math.cos((origin.lat * Math.PI) / 180) || 1e-6;
  const lng = origin.lng + eastM / (METRES_PER_DEG_LAT * cosLat);
  return { lat, lng };
}

/**
 * Interpolate a position along the straight line between two coordinates.
 * Not a great-circle path - intentional, because the simulator is a testing
 * convenience and a straight line is easier to reason about.
 */
export function interpolate(a: Coordinate, b: Coordinate, t: number): Coordinate {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  };
}

/**
 * Deterministic pseudo-random source so simulator runs are reproducible.
 * A seeded LCG keeps test failures debuggable across machines.
 */
export function createSeededRandom(seed = 0x2f6e2b1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Apply jitter to a coordinate using an injectable random source. */
export function applyJitter(
  coord: Coordinate,
  metres: number,
  random: () => number = Math.random,
): Coordinate {
  if (metres <= 0) return coord;
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * metres;
  return offsetCoordinate(coord, Math.sin(angle) * radius, Math.cos(angle) * radius);
}

/**
 * Turn a simulator config into a PositionFix that the rest of the app treats
 * exactly like a real one (except for the `simulated` flag).
 */
export function simulateFix(config: SimulatorConfig, now = Date.now()): PositionFix | null {
  if (!config.coordinate) return null;
  const coord = config.jitter
    ? applyJitter(config.coordinate, config.jitterMetres)
    : config.coordinate;
  return {
    lat: coord.lat,
    lng: coord.lng,
    accuracy: config.accuracy,
    timestamp: now,
    altitude: null,
    heading: null,
    speed: null,
    simulated: true,
  };
}

/**
 * Compute the next position for a simulated walk between two points.
 * Returns the new coordinate plus whether the walk is complete.
 */
export function stepWalk(
  current: Coordinate,
  target: Coordinate,
  totalDistanceM: number,
  speedMps: number,
  tickMs: number,
): { coordinate: Coordinate; arrived: boolean; travelledM: number } {
  if (totalDistanceM <= 0) return { coordinate: target, arrived: true, travelledM: 0 };
  const travelled = (speedMps * tickMs) / 1000;
  const fraction = Math.min(1, travelled / totalDistanceM);
  const coordinate = interpolate(current, target, fraction);
  return { coordinate, arrived: fraction >= 1, travelledM: travelled };
}

/** A few real, safe demo anchors for quick testing in the simulator panel. */
export const SIMULATOR_PRESETS: { label: string; coordinate: Coordinate }[] = [
  { label: "Demo Hunt 起点 (马尼拉黎刹公园)", coordinate: { lat: 14.5832, lng: 120.9794 } },
  { label: "地点 A（北侧 40m）", coordinate: { lat: 14.58356, lng: 120.9794 } },
  { label: "地点 B（东侧 45m）", coordinate: { lat: 14.5832, lng: 120.97981 } },
  { label: "地点 C（南侧 60m）", coordinate: { lat: 14.58266, lng: 120.9794 } },
  { label: "北京天安门广场", coordinate: { lat: 39.9055, lng: 116.3976 } },
  { label: "上海人民广场", coordinate: { lat: 31.2304, lng: 121.4737 } },
];
