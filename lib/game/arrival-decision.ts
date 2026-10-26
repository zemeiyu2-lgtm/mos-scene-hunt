/**
 * The arrival-prompt decision.
 *
 * Split from `lib/game/arrival.ts` (which owns the keys and the persisted
 * record) so the rule below can be read - and tested - without storage in the
 * room. See the header of `arrival.ts` for why the saved `arrivedAt` alone
 * cannot tell a page reload apart from a real second arrival.
 */

import {
  arrivalEventKey,
  isFreshArrival,
  PROMPT_REPEAT_GUARD_MS,
  RELOAD_SUPPRESS_MS,
} from "./arrival";

/**
 * Decide whether an arrival should raise a prompt right now.
 *
 * @param lastServed every arrival already announced, keyed by event key.
 * @param persistedStatus the scene's stored status at the moment this document
 *   hydrated the state. `arrived` proves the player was standing in the ring
 *   when the previous document stopped, which is exactly what a reload looks
 *   like; `locked` means the stored record had no live arrival, so the stamp
 *   below has to decide.
 * @param persistedArrivedAt the engine stamp found in the save at hydrate time
 *   (undefined when the scene had never been reached). Captured once, because
 *   the reducer overwrites the live stamp on the next `arrived`.
 * @param hadProgressOnLoad whether saved progress already existed for this game
 *   when the document loaded (see `hasProgressIn` in `lib/storage`). A brand-new
 *   hunt has none; a reload, a revisit or a return from the game centre does.
 *   Deliberately not "a save key exists": hydration alone writes one.
 * @param targetServedAt when this target's arrival was last announced (the
 *   persisted per-target record), or undefined if never. Tells a reload - which
 *   follows the previous prompt within seconds - apart from a real walk-back-in
 *   minutes later, once the record has been pruned.
 * @param firstEvaluation true only for the first decision this document makes
 *   about this target. After that the player must have moved to arrive again.
 *
 * The conditions are evaluated in order and each one can only make the answer
 * more conservative, so the function has no side effects and is cheap to call
 * on every GPS fix.
 */
export function decideArrivalPrompt(input: {
  gameId: string | undefined;
  sceneId: string | null;
  arrivedAt: number | undefined;
  now: number;
  lastServed: ReadonlyMap<string, number>;
  persistedStatus?: string;
  persistedArrivedAt?: number;
  hadProgressOnLoad?: boolean;
  targetServedAt?: number;
  firstEvaluation?: boolean;
}): boolean {
  if (!input.sceneId) return false;

  const fresh = isFreshArrival(input.arrivedAt, input.now);
  if (!fresh) return false;

  const arrivedAt = input.arrivedAt as number;
  const key = arrivalEventKey(input.gameId, input.sceneId, arrivedAt);
  if (!key) return false;

  const servedAt = input.lastServed.get(key);
  const recentlyServed = servedAt !== undefined && input.now - servedAt < PROMPT_REPEAT_GUARD_MS;
  if (recentlyServed) return false;

  // The reload artefact. A player who stops the app while standing in the ring
  // leaves `arrived` (or a rolled-back `locked` plus its stamp) in the save;
  // hydration then resets the status and the first fix re-stamps `arrivedAt`
  // with a NEW value, which on its own looks exactly like a second visit.
  //
  // What separates the two is the record of what was already announced for this
  // target: a reload fires within minutes of the previous prompt, so the arrival
  // it resurrects is still covered by that stamp. A real walk-out and walk-in
  // leaves the same record shape but happens later, once the window has passed -
  // and the player really is standing at the stop again, so it must be announced.
  //
  // The guard has to cover the whole reload, not just its first decision: after
  // hydration the engine's first fix replaces the stored stamp with its own, so
  // the follow-up decision sees a stamp older than the live one and would read
  // that as a walk-back-in. While the recorded announcement is still recent the
  // document therefore treats this stop as "already told", for as long as the
  // player has not left the ring.
  const persistedArrivedAt = input.persistedArrivedAt;
  const targetServedAt = input.targetServedAt;
  const settledStamp =
    input.persistedStatus === "arrived" ||
    (persistedArrivedAt !== undefined && persistedArrivedAt < arrivedAt);
  if (settledStamp && input.hadProgressOnLoad === true && targetServedAt !== undefined) {
    const coveredByRecord = input.now - targetServedAt < RELOAD_SUPPRESS_MS;
    if (coveredByRecord) return false;
  }

  // A stored stamp older than the live one: the player reached this scene
  // before, left (status back to `locked`, stamp kept) and has walked back in.
  const reArrived = persistedArrivedAt !== undefined && persistedArrivedAt < arrivedAt;
  if (reArrived) return true;

  // First arrival of this document with nothing in the save to compare against.
  // The scene never showed an arrival, so the player is genuinely here for the
  // first time - announce it even when a save index entry exists (hydration
  // writes one on its own).
  return true;
}
