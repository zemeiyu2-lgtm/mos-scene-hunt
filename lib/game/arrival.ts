/**
 * Arrival prompt bookkeeping.
 *
 * Reaching the ring is reported by the engine (`FIX_UPDATE` flips a scene to
 * `arrived`); showing the prompt is a client concern. It must fire exactly once
 * per *real* arrival and survive React re-renders, client navigation remounts,
 * page reloads and noisy GPS callbacks - without ever blocking a genuine
 * second visit to the same place.
 *
 * ## Why "game + scene + arrivedAt" is not a sufficient key
 *
 * `reconcileState()` deliberately rolls a stored `arrived` back to `locked` on
 * load ("a scene that was mid-arrival when the app closed reopens at the
 * neutral baseline"). The next fix therefore re-stamps `arrivedAt` with a FRESH
 * value. Measured on the real map with a stationary player:
 *
 *   before reload: arrived, arrivedAt = T1
 *   after  reload: arrived, arrivedAt = T2   (T2 > T1, no movement at all)
 *
 * A player who really walked out and came back produces the same stored
 * sequence (`locked` in between, then a new stamp), so the saved state alone
 * cannot separate the two cases. Elapsed time cannot separate them either: the
 * restart re-stamp lands ~10-70 ms after hydration, i.e. *sooner* than a real
 * walk-in, so a "was it quick?" threshold would suppress real arrivals.
 *
 * ## What the map decides with
 *
 * For ONE scene `arrivedAt` is only ever reassigned by the `locked -> arrived`
 * transition, and the reducer keeps the old stamp when the player leaves (the
 * status flips back to `locked` while `arrivedAt` stays). So on a page load:
 *
 *  - the stored stamp still equals the current stamp -> the scene was reached,
 *    left and reached again during this page session: announce it;
 *  - the stored stamp is missing or older            -> either a first visit of
 *    this document, or the reload artefact above.
 *
 * A reload and a walk-back-in leave the SAME stored record, and the re-stamp
 * lands ~10-70 ms after hydration either way, so neither the state nor the
 * arrival timing can separate them. The only remaining signal is how long ago
 * this target was last announced (`RELOAD_SUPPRESS_MS`): the reload follows the
 * previous prompt within a couple of minutes, while a real return to the stop
 * happens after the player has walked away and back. The decision itself lives
 * in `lib/game/arrival-decision.ts`.
 *
 * Nothing here widens the trigger radius or touches the engine: the engine
 * stays the only authority on whether the player is inside the ring.
 */

/** Freshness window: only an arrival the engine stamped recently is announced. */
export const FRESH_ARRIVAL_WINDOW_MS = 30_000;

/**
 * How long a served arrival stays suppressed for the same event key.
 *
 * Purely a safety net for the single case the event key cannot cover - a
 * second `arrived` stamp with the exact same millisecond - and for remount
 * bursts. Correctness comes from the event key and the reload guard, and this
 * window is deliberately short so it can never block a genuine re-arrival.
 */
export const PROMPT_REPEAT_GUARD_MS = 10_000;

/** Identity of one arrival event: game + scene + the engine's arrival stamp. */
export function arrivalEventKey(
  gameId: string | undefined,
  sceneId: string,
  arrivedAt: number | undefined,
): string | null {
  if (!gameId || !sceneId || !arrivedAt) return null;
  return `${gameId}/${sceneId}/${arrivedAt}`;
}

/**
 * How long after an announcement a re-arrival at the SAME stop counts as the
 * player still standing there rather than as a new visit.
 *
 * This is the one thing that separates a page reload from walking out and
 * coming back: the saved record looks identical (a stamp, then a fresh stamp),
 * and hydration re-stamps the arrival within a second of loading either way.
 * Time is the only signal left, so the window has to cover the slowest realistic
 * restart - a phone that reloads the tab, or a player who closes the app at the
 * stop and reopens it - while staying well under "walk around the block".
 *
 * A reload only ever matters for the FIRST arrival a document sees; after that
 * the player must have physically left the ring, which is real movement.
 */
export const RELOAD_SUPPRESS_MS = 3 * 60_000;

/** Identity of a target, independent of any single arrival stamp. */export function arrivalTargetKey(gameId: string | undefined, sceneId: string): string | null {
  if (!gameId || !sceneId) return null;
  return `${gameId}/${sceneId}`;
}

/** True when the engine stamped this arrival recently enough to announce it. */
export function isFreshArrival(arrivedAt: number | undefined, now: number): boolean {
  if (!arrivedAt) return false;
  const age = now - arrivedAt;
  // A stamp from the future means a device clock jump; treat it as fresh rather
  // than silently swallowing a real arrival.
  if (age < 0) return true;
  return age <= FRESH_ARRIVAL_WINDOW_MS;
}

/**
 * Bounded module-level record of served arrivals.
 *
 * A Map alone would grow for the whole session (one entry per arrival), so old
 * entries are pruned once it grows past `max`. Pruning only drops stale keys -
 * an entry that is still inside the repeat guard is always kept.
 */
export function pruneServedArrivals(
  lastServed: Map<string, number>,
  now: number,
  max = 50,
): void {
  if (lastServed.size <= max) return;
  for (const [key, at] of lastServed) {
    if (now - at >= PROMPT_REPEAT_GUARD_MS) lastServed.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* Durable record of served arrivals                                   */
/* ------------------------------------------------------------------ */

/**
 * localStorage key holding the served arrivals across reloads.
 *
 * A module-level Map is enough to survive client navigation remounts, but a
 * full page reload starts a blank module. The record is therefore persisted and
 * consulted together with the engine's own `arrivedAt` stamp - a real new
 * arrival gets a new stamp and is announced regardless of this record.
 */
export const SERVED_ARRIVALS_KEY = "mos-scene-hunt:served-arrivals";

/**
 * Per-target record: game/scene -> the arrival stamp already announced.
 *
 * Kept next to the per-event record because the two answer different questions:
 * "have I announced this exact arrival?" (event record) and "when did I last
 * tell the player about arriving here?" (target record, which also gives the
 * prompt a stable identity when the event record has been pruned).
 */
export const SERVED_TARGETS_KEY = "mos-scene-hunt:served-arrival-targets";

/** Upper bound on persisted entries, so the keys cannot grow without limit. */
const MAX_PERSISTED_ARRIVALS = 50;

function storage(kind: "local" | "session"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    // Storage blocked (private mode / sandboxed iframe): run without it.
    return null;
  }
}

/** Read a numeric record, tolerating absent/corrupt data. */
function readNumberRecord(key: string, kind: "local" | "session"): Map<string, number> {
  const map = new Map<string, number>();
  const store = storage(kind);
  if (!store) return map;
  try {
    const raw = store.getItem(key);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return map;
    const entries = Object.entries(parsed as Record<string, unknown>);
    for (const [entryKey, value] of entries) {
      if (typeof value === "number" && Number.isFinite(value)) map.set(entryKey, value);
    }
  } catch {
    // Corrupt JSON: start clean rather than breaking the map screen.
  }
  return map;
}

function writeNumberRecord(
  key: string,
  kind: "local" | "session",
  map: Map<string, number>,
  now: number,
): void {
  const store = storage(kind);
  if (!store) return;
  pruneServedArrivals(map, now, MAX_PERSISTED_ARRIVALS);
  try {
    const record: Record<string, number> = {};
    for (const [entryKey, at] of map) record[entryKey] = at;
    store.setItem(key, JSON.stringify(record));
  } catch {
    /* quota exceeded / storage blocked - the in-memory guard still applies */
  }
}

/** Read the persisted served-arrival record, tolerating absent/corrupt data. */
export function loadServedArrivals(): Map<string, number> {
  return readNumberRecord(SERVED_ARRIVALS_KEY, "local");
}

/**
 * Persist the served-arrival record.
 *
 * Best effort by design: a blocked or full storage must not break the arrival
 * prompt, so failures are swallowed (the in-memory map still prevents repeats
 * for the rest of the session).
 */
export function saveServedArrivals(lastServed: Map<string, number>, now: number): void {
  writeNumberRecord(SERVED_ARRIVALS_KEY, "local", lastServed, now);
}

/** Read the per-target record of already-announced arrivals. */
export function loadServedTargets(): Map<string, number> {
  return readNumberRecord(SERVED_TARGETS_KEY, "local");
}

/** Persist the per-target record. */
export function saveServedTargets(targets: Map<string, number>, now: number): void {
  writeNumberRecord(SERVED_TARGETS_KEY, "local", targets, now);
}
