/**
 * Raster tile health.
 *
 * Leaflet renders a broken tile layer as grey squares and stays silent: the
 * player cannot tell "still loading" from "your network is gone", and there is
 * no way to retry (B-02 UX-07). This module turns the layer's own
 * `tileload` / `tileerror` events into three states the UI can act on, with a
 * deliberately conservative threshold so a single missing tile in a remote area
 * never raises a banner.
 *
 * Pure by design: the caller owns the counters and the clock, so the rules can
 * be unit-tested without Leaflet or a DOM.
 */

export type TileHealth = "loading" | "ok" | "failed";

export interface TileHealthInput {
  /** Tiles that rendered successfully since the layer was created. */
  loaded: number;
  /** Tiles that errored since the layer was created. */
  errors: number;
  /** Milliseconds since the layer was created. */
  elapsedMs: number;
}

export interface TileHealthRules {
  /** Errors tolerated before declaring failure (when nothing loaded at all). */
  errorThreshold: number;
  /** After any error, give up at this age if still nothing rendered. */
  errorGraceMs: number;
  /** A single early error is not enough: wait this long before judging. */
  minObservationMs: number;
}

export const DEFAULT_TILE_RULES: TileHealthRules = {
  errorThreshold: 4,
  errorGraceMs: 12_000,
  minObservationMs: 4_000,
};

/**
 * Classify the layer.
 *
 * - Any successful tile wins: partial coverage is normal on mobile networks,
 *   and a banner over a usable map is worse than the missing tiles.
 * - No success + enough errors => failed. Offline and DNS-blocked tile hosts
 *   fail many tiles within a second, so the threshold is reached quickly.
 * - No success + a few errors => still "loading" until the grace period ends.
 */
export function evaluateTileHealth(
  input: TileHealthInput,
  rules: TileHealthRules = DEFAULT_TILE_RULES,
): TileHealth {
  if (input.loaded > 0) return "ok";
  if (input.elapsedMs < rules.minObservationMs) return "loading";
  if (input.errors >= rules.errorThreshold) return "failed";
  if (input.errors > 0 && input.elapsedMs >= rules.errorGraceMs) return "failed";
  return "loading";
}

/** The next provider in the picker, used by the "换底图" action. */
export function nextTileProvider<T extends string>(ids: readonly T[], current: T): T {
  const index = ids.indexOf(current);
  if (index < 0) return ids[0] ?? current;
  return ids[(index + 1) % ids.length] ?? current;
}
