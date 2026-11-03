/**
 * Small geodesy helpers used only for *drawing* overlays.
 *
 * These build the polygons that visually approximate a metre radius on a
 * Mercator map. They are not part of the arrival calculation and must never be
 * used for one: distance/arrival live in `lib/location/geodesy.ts` and stay on
 * the raw WGS84 fix. Keeping the two apart is deliberate — a display radius
 * that drifts by a metre is invisible, an arrival radius that drifts is a bug.
 */

export type LngLat = [number, number];
export type LngLatRing = LngLat[];

const EARTH_METERS_PER_DEG_LAT = 111_320;

/**
 * Closed ring approximating a circle of `radiusMeters` around a WGS84 point.
 * Returned as [lng, lat] pairs — GeoJSON order, not Leaflet order.
 */
export function circleRing(
  lat: number,
  lng: number,
  radiusMeters: number,
  steps = 64,
): LngLatRing {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(radiusMeters > 0)) return [];
  const safeSteps = Math.max(12, Math.min(256, Math.round(steps)));
  const dLat = radiusMeters / EARTH_METERS_PER_DEG_LAT;
  // Guard the cosine near the poles: a 1 m circle at |lat|>85 would otherwise
  // produce an infinite longitude delta.
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusMeters / (EARTH_METERS_PER_DEG_LAT * cosLat);
  const ring: LngLatRing = [];
  for (let i = 0; i < safeSteps; i += 1) {
    const angle = (2 * Math.PI * i) / safeSteps;
    ring.push([lng + dLng * Math.sin(angle), lat + dLat * Math.cos(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Bounding box of a set of [lng, lat] points, as MapLibre's `fitBounds` wants it. */
export function boundsOf(points: LngLat[]): [[number, number], [number, number]] | null {
  const valid = points.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (valid.length === 0) return null;
  let minLng = valid[0][0];
  let maxLng = valid[0][0];
  let minLat = valid[0][1];
  let maxLat = valid[0][1];
  for (const [lng, lat] of valid) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Grow a bounding box by a metre pad, so a single-target fit is not a point. */
export function padBounds(
  bounds: [[number, number], [number, number]],
  padMeters: number,
): [[number, number], [number, number]] {
  const midLat = (bounds[0][1] + bounds[1][1]) / 2;
  const cosLat = Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const dLat = padMeters / EARTH_METERS_PER_DEG_LAT;
  const dLng = padMeters / (EARTH_METERS_PER_DEG_LAT * cosLat);
  return [
    [bounds[0][0] - dLng, bounds[0][1] - dLat],
    [bounds[1][0] + dLng, bounds[1][1] + dLat],
  ];
}
