/**
 * Merge-pointer resolution — the only place that decides "which profile does
 * this id finally mean".
 *
 * A merged profile is never deleted: it keeps its document (audit value) and
 * forwards readers to the survivor. Depth is capped and cycles are detected,
 * so a corrupted pointer pair degrades to "not found" instead of hanging.
 */

import type { CityStore } from "./store";
import type { CityProfile } from "./types";

export const MAX_MERGE_DEPTH = 5;

export interface ResolvedCity {
  city: CityProfile;
  /** The id that was asked for. */
  requestedCityId: string;
  /** True when a merge pointer had to be followed. */
  redirected: boolean;
  /** Every id traversed, oldest first (requested id included). */
  chain: string[];
}

export async function resolveCityRef(
  store: CityStore,
  cityId: string,
): Promise<ResolvedCity | null> {
  const chain: string[] = [];
  let current = cityId;
  for (let depth = 0; depth <= MAX_MERGE_DEPTH; depth += 1) {
    if (chain.includes(current)) return null; // cycle: treat as broken, not as data
    chain.push(current);
    const city = await store.getCity(current);
    if (!city) return null;
    if (city.status !== "merged") {
      return {
        city,
        requestedCityId: cityId,
        redirected: current !== cityId,
        chain,
      };
    }
    if (!city.mergedInto) return null;
    current = city.mergedInto;
  }
  return null; // pointer chain longer than MAX_MERGE_DEPTH
}
