/**
 * AUTO-DEMO AUTOPILOT helpers.
 *
 * Purpose: let the official showcase pack be demonstrated end-to-end without
 * walking to the coordinates. The autopilot teleports the DEV GPS simulator to
 * each station in order and lets the existing arrival -> scene -> challenge ->
 * reward UI flow run untouched, so a stakeholder sees exactly what a player
 * sees - only faster and hands-free.
 *
 * Guardrails:
 *  - The flag lives in sessionStorage, never in a cookie or the save file, so a
 *    demo session can never leak into a real player's progress.
 *  - The driver component refuses to run unless `isSimulatorAvailable()` is
 *    true (dev build or explicit NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1), the same
 *    gate the simulator panel uses.
 *  - No game content is modified: this module only reads the pack and drives
 *    the same actions a tap would.
 */

import { entryScene, type Challenge, type Game } from "../game/types";
import type { SceneStatus } from "../game/state";
import { isSimulatorAvailable } from "../location";

export const DEMO_SESSION_KEY = "mos.demo.autopilot";

/** True when the current browser session is in auto-demo mode. */
export function isDemoActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turn auto-demo mode on for this browser session. */
export function enableDemo(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, "1");
    document.body.dataset.demoAutopilot = "1";
  } catch {
    // Private-mode storage quotas etc: demo is a best-effort affordance.
  }
}

/** Turn auto-demo mode off and clear the visual marker. */
export function disableDemo(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch {
    // ignore
  }
  delete document.body.dataset.demoAutopilot;
}

/** Read the `?demo=1` deep-link trigger (kiosk URLs, QR codes). */
export function urlRequestsDemo(search: string | null | undefined): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get("demo") === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the auto-demo may run in this build.
 *
 * Deliberately DECOUPLED from the DEV GPS simulator gate: a production kiosk
 * enables the demo with `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1` while the DEV
 * simulator panel stays off, so a stakeholder-facing demo never hands real
 * players a fake-position panel. Dev/E2E builds keep working through the
 * existing simulator gate.
 */
export function isDemoSupported(): boolean {
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ENABLE_AUTO_DEMO === "1"
  ) {
    return true;
  }
  return isSimulatorAvailable();
}

/* ------------------------------------------------------------------ */
/* Demo playback speed                                                */
/* ------------------------------------------------------------------ */

export type DemoSpeed = "slow" | "normal" | "fast";

const DEMO_SPEED_KEY = "mos.demo.speed";

export function getDemoSpeed(): DemoSpeed {
  if (typeof window === "undefined") return "normal";
  try {
    const raw = window.sessionStorage.getItem(DEMO_SPEED_KEY);
    return raw === "slow" || raw === "fast" ? raw : "normal";
  } catch {
    return "normal";
  }
}

export function setDemoSpeed(speed: DemoSpeed): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DEMO_SPEED_KEY, speed);
  } catch {
    // Best-effort; the demo keeps running at normal speed.
  }
}

/**
 * Multiplier applied to every demo wait (arrival beat, auto-answer beats,
 * reward dwell). slow=more patient for a stage, fast=quicker for a lobby.
 */
export function demoSpeedFactor(speed: DemoSpeed = getDemoSpeed()): number {
  switch (speed) {
    case "slow":
      return 1.8;
    case "fast":
      return 0.4;
    default:
      return 1;
  }
}

/**
 * The play order as actually wired: follow `nextSceneId` from the entry scene.
 * Packs in practice are linear; a broken chain falls back to pack order so the
 * demo still covers every station instead of stopping mid-way.
 */
export function demoSceneChain(game: Game): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = entryScene(game)?.id ?? game.scenes[0]?.id ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    const next = game.scenes.find((s) => s.id === cursor)?.nextSceneId ?? null;
    // Only follow edges that actually land on a scene; a dangling id ends the
    // chain here and the pack-order fallback below covers the rest.
    cursor = next && game.scenes.some((s) => s.id === next) ? next : null;
  }
  if (chain.length < game.scenes.length) {
    for (const scene of game.scenes) {
      if (!seen.has(scene.id)) chain.push(scene.id);
    }
  }
  return chain;
}

export interface DemoSceneInfo {
  id: string;
  title: string;
  status: SceneStatus;
  lat: number;
  lng: number;
}

/**
 * Pick the station the autopilot should drive next: the first scene in chain
 * order that is not completed yet. Returns null when the whole hunt is done.
 */
export function nextDemoTarget(
  chain: string[],
  statusById: Record<string, SceneStatus>,
): string | null {
  for (const id of chain) {
    if ((statusById[id] ?? "locked") !== "completed") return id;
  }
  return null;
}

/**
 * Which option an auto-demo should submit for a choice challenge.
 * Reflective questions have no wrong answer, so the first option reads most
 * naturally; graded questions must submit the correct one or the demo stalls.
 * Returns null for non-choice challenges (the autopilot never guesses text).
 */
export function autoChoiceIndex(challenge: Challenge | null | undefined): number | null {
  if (!challenge || challenge.type !== "choice") return null;
  if (challenge.reflective) return 0;
  // Pack validation guarantees a graded choice carries a numeric answer index.
  return typeof challenge.answer === "number" ? challenge.answer : null;
}

/** Human-readable phase label for the demo bar. */
export function demoPhaseLabel(status: SceneStatus | undefined): string {
  switch (status) {
    case "available":
    case "locked":
      return "前往站点";
    case "arrived":
      return "已到达";
    case "challenging":
      return "回答中";
    case "completed":
      return "已完成";
    default:
      return "准备中";
  }
}
