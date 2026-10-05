import {
  DEFAULT_TRIGGER_RADIUS,
  EARTH_RADIUS_M,
  POOR_ACCURACY_THRESHOLD_M,
  STALE_FIX_THRESHOLD_MS,
  type Coordinate,
  type Location,
  type PositionFix,
} from "./types";

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Clamp latitude into [-90, 90] and wrap longitude into [-180, 180). */
export function normalizeCoordinate(coord: Coordinate): Coordinate {
  let { lat, lng } = coord;
  lat = Math.min(90, Math.max(-90, lat));
  lng = ((lng + 180) % 360 + 360) % 360 - 180;
  return { lat, lng };
}

/** True when both components are finite numbers inside the legal degree range. */
export function isValidCoordinate(coord: Partial<Coordinate> | null | undefined): boolean {
  if (!coord) return false;
  const { lat, lng } = coord;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function hasZeroCoordinate(coord: Coordinate): boolean {
  return coord.lat === 0 && coord.lng === 0;
}

/**
 * Great-circle distance between two coordinates in metres.
 *
 * Primary algorithm: Haversine on a spherical Earth. Cheap, dependency-free and
 * accurate to within ~0.5% - which is far below consumer GPS error, so it is the
 * right trade-off for a trigger-radius game.
 *
 * Elevation, when supplied on both ends, is folded in as the Euclidean
 * correction of the 3D chord length (the "haversine with altitude" adjustment),
 * because a scene on a hillside 80 m above the player should not read as
 * in-range purely from map projection.
 */
export function calculateDistance(a: Coordinate, b: Coordinate, altitudeDeltaM = 0): number {
  if (
    typeof a?.lat !== "number" ||
    typeof a?.lng !== "number" ||
    typeof b?.lat !== "number" ||
    typeof b?.lng !== "number" ||
    !Number.isFinite(a.lat) ||
    !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lng)
  ) {
    throw new TypeError("calculateDistance: both coordinates must be finite numbers");
  }

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);

  const h =
    sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLng * sinHalfLng;

  const surfaceDistance = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));

  if (!altitudeDeltaM) return surfaceDistance;
  return Math.sqrt(surfaceDistance * surfaceDistance + altitudeDeltaM * altitudeDeltaM);
}

/** Distance from a fix to a Location, honouring the location's altitude if present. */
export function distanceToLocation(
  fix: Coordinate,
  location: Location,
  fixAltitude?: number | null,
  locationAltitude?: number | null,
): number {
  const altDelta =
    typeof fixAltitude === "number" && typeof locationAltitude === "number"
      ? locationAltitude - fixAltitude
      : 0;
  return calculateDistance(fix, { lat: location.lat, lng: location.lng }, altDelta);
}

/**
 * Resolve the effective trigger radius for a location.
 * Falls back to DEFAULT_TRIGGER_RADIUS for missing/invalid values.
 */
export function resolveRadius(location: Pick<Location, "radius"> | undefined): number {
  const r = location?.radius;
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return DEFAULT_TRIGGER_RADIUS;
  return r;
}

/**
 * Is the player inside the location's trigger ring?
 *
 * Two guards matter for real-world use:
 *  - `accuracyAllowance`: consumer GPS routinely reports +/- 20 m. When
 *    `allowAccuracySlack` is on we expand the ring by the reported accuracy so
 *    that standing *on* the spot with a fuzzy fix still triggers. It never
 *    shrinks the ring.
 *  - Zero/null fixes are rejected outright, they are almost always the browser
 *    defaulting to the null island rather than a real reading.
 */
export function isWithinRadius(
  fix: Coordinate,
  location: Location,
  options: { accuracy?: number; allowAccuracySlack?: boolean } = {},
): boolean {
  if (!isValidCoordinate(fix) || !isValidCoordinate(location)) return false;
  if (hasZeroCoordinate(fix)) return false;

  const baseRadius = resolveRadius(location);
  const slack =
    options.allowAccuracySlack && typeof options.accuracy === "number"
      ? Math.min(options.accuracy, baseRadius * 0.5)
      : 0;

  return distanceToLocation(fix, location) <= baseRadius + slack;
}

/**
 * Signed margin in metres: negative means "inside by N metres",
 * positive means "still N metres away". Handy for UI copy.
 *
 * With accuracy slack the margin is measured against the expanded ring so the
 * UI agrees with the trigger decision.
 */
export function radiusMargin(
  fix: Coordinate,
  location: Location,
  options: { accuracy?: number; allowAccuracySlack?: boolean } = {},
): number {
  const baseRadius = resolveRadius(location);
  const slack =
    options.allowAccuracySlack && typeof options.accuracy === "number"
      ? Math.min(options.accuracy, baseRadius * 0.5)
      : 0;
  return distanceToLocation(fix, location) - (baseRadius + slack);
}

/** Format a distance for the player: "127 m" / "1.4 km". */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "--";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** Initial great-circle bearing from `a` to `b`, in degrees clockwise from north. */
export function bearing(a: Coordinate, b: Coordinate): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Compass point for a bearing, 8-way. */
export function bearingToCompass(deg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export type FixQuality = "good" | "fair" | "poor" | "stale";

/** Classify a fix so the UI can warn the player instead of lying to them. */
export function classifyFix(
  fix: PositionFix,
  now: number = Date.now(),
): { quality: FixQuality; message: string | null } {
  if (!fix) return { quality: "poor", message: "尚未取得定位" };
  if (now - fix.timestamp > STALE_FIX_THRESHOLD_MS) {
    return { quality: "stale", message: "定位数据已过期，正在重新获取…" };
  }
  if (fix.accuracy > POOR_ACCURACY_THRESHOLD_M) {
    return {
      quality: "poor",
      message: `定位精度较低（±${Math.round(fix.accuracy)} m），请到开阔处或稍候再试`,
    };
  }
  if (fix.accuracy > 35) {
    return { quality: "fair", message: `定位精度 ±${Math.round(fix.accuracy)} m` };
  }
  return { quality: "good", message: null };
}

/** Look up the nearest location to a fix. Used for "head to X" guidance. */
export function nearestLocation<T extends Location>(
  fix: Coordinate,
  locations: T[],
): { location: T; distance: number } | null {
  if (!locations?.length || !isValidCoordinate(fix)) return null;
  let best: { location: T; distance: number } | null = null;
  for (const location of locations) {
    if (!isValidCoordinate(location)) continue;
    const d = distanceToLocation(fix, location);
    if (!best || d < best.distance) best = { location, distance: d };
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Polygon geometry (authoring)                                       */
/* ------------------------------------------------------------------ */

/**
 * Arithmetic centroid of a ring of points.
 *
 * The vertex average, not the area-weighted centroid: for the small, roughly
 * convex spaces a micro-hunt covers the difference is centimetres, and the
 * vertex average can never fall outside a concave ring the way the area
 * centroid can. Closed rings may repeat the first point; that duplicate is
 * ignored so it does not bias the result.
 */
export function polygonCentroid(points: Coordinate[]): Coordinate | null {
  const ring = dedupeClosingPoint(points);
  if (ring.length === 0) return null;
  if (ring.length === 1) return { lat: ring[0].lat, lng: ring[0].lng };
  const lat = ring.reduce((sum, p) => sum + p.lat, 0) / ring.length;
  const lng = ring.reduce((sum, p) => sum + p.lng, 0) / ring.length;
  return { lat, lng };
}

/**
 * Radius of the smallest circle centred on the centroid that contains every
 * vertex, in metres. Lets a polygon be summarised as centre+radius for the
 * consumers that only speak circle.
 */
export function polygonBoundingRadius(points: Coordinate[]): number {
  const ring = dedupeClosingPoint(points);
  const center = polygonCentroid(ring);
  if (!center) return 0;
  let max = 0;
  for (const p of ring) {
    const d = calculateDistance(center, p);
    if (d > max) max = d;
  }
  return max;
}

/** Drop a trailing point that repeats the first, so rings stay open for math. */
function dedupeClosingPoint(points: Coordinate[]): Coordinate[] {
  const clean = (points ?? []).filter((p) => isValidCoordinate(p));
  if (clean.length >= 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) return clean.slice(0, -1);
  }
  return clean;
}

/**
 * Is a coordinate inside a polygon ring? Ray-casting (even-odd rule), which is
 * correct for the concave rings a designer can draw by hand and needs no
 * triangulation. Boundary points are treated as inside via a small epsilon on
 * the crossing test.
 *
 * Not wired into the unlock engine - it exists so the editor can tell a
 * designer whether a scene they placed actually falls inside the area they
 * drew, and so that check is unit-testable rather than eyeballed.
 */
export function isPointInPolygon(point: Coordinate, points: Coordinate[]): boolean {
  const ring = dedupeClosingPoint(points);
  if (ring.length < 3 || !isValidCoordinate(point)) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;

    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
