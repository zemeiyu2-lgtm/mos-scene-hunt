/**
 * Resolve the「继续设计」deep link (/design?game=<id>) to a saved authored pack.
 *
 * Extracted from the design page as a pure function so the deep-link behaviour
 * is directly unit-testable without rendering the map editor. Returns a deep
 * clone so the editor's draft can never mutate the stored pack in place.
 */
import type { Game } from "@/lib/game/types";

export function pickDesignGame(
  search: string,
  load: (gameId: string) => Game | null,
): Game | null {
  const gameId = new URLSearchParams(search).get("game");
  if (!gameId) return null;
  const game = load(gameId);
  return game ? structuredClone(game) : null;
}
