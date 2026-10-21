/**
 * Device-heading helpers.
 *
 * Compass data is noisy (±5-15° jitter is normal on phones) and the raw value
 * would make the map's direction tail visibly twitch. This is a plain
 * exponential smoother over the *shortest arc* between the previous and next
 * heading, so 350° -> 10° glides through north instead of spinning backwards.
 */

/** Shortest signed arc from a to b, in (-180, 180]. */
export function headingDelta(from: number, to: number): number {
  const delta = (((to - from) % 360) + 360) % 360;
  return delta > 180 ? delta - 360 : delta;
}

/**
 * Exponentially smooth `next` toward `prev`.
 *
 * alpha is the weight of the new sample (0..1): higher follows the device more
 * tightly, lower is smoother but laggier. A missing previous value snaps
 * straight to `next`. Output is always a finite 0-360 degree heading.
 */
export function smoothHeading(prev: number | null, next: number, alpha = 0.4): number {
  if (!Number.isFinite(next)) return prev ?? 0;
  const target = ((next % 360) + 360) % 360;
  if (prev === null || !Number.isFinite(prev)) return target;
  const base = ((prev % 360) + 360) % 360;
  return (base + headingDelta(base, target) * alpha + 360) % 360;
}
