/**
 * Runtime mode resolution.
 *
 * Every hunt runs in exactly one of three modes, decided once per provider
 * mount (see `components/hunt-provider.tsx`) and exposed through the hunt
 * context. Screens must read the mode from the context or from these helpers -
 * they must not re-derive it from ad-hoc query parameters.
 *
 *  - "player"  : a real person playing for real progress. The only mode that
 *                touches the persistent player save (`save:<gameId>`) and the
 *                multi-hunt index.
 *  - "demo"    : the auto-demo. Its whole lifecycle lives in sessionStorage
 *                (`mos.demo.autopilot` flag + `demo:<gameId>` state), so a
 *                page refresh continues the demo and closing the tab discards
 *                it. It can never write the player save.
 *  - "preview" : the designer trying a pack out. Same transient lifecycle as
 *                demo, under its own namespace, so a preview can never touch
 *                the player save either.
 *
 * Safe default: anything unrecognised resolves to "player" with no special
 * privileges - a stray URL parameter alone never grants persistence into the
 * player save, because demo/preview state lives in sessionStorage, not the
 * player save namespace.
 */

import { isDemoActive, urlRequestsDemo } from "../demo/autopilot";

export type RuntimeMode = "player" | "demo" | "preview";

/** sessionStorage flag marking the designer-preview session. */
export const PREVIEW_SESSION_KEY = "mos.runtime.preview";

/** True when the current browser session is a designer preview. */
export function isPreviewActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PREVIEW_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turn designer-preview mode on for this browser session. */
export function enablePreview(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PREVIEW_SESSION_KEY, "1");
  } catch {
    // Best-effort: without sessionStorage the mode safely falls back to player.
  }
}

/** Turn designer-preview mode off. */
export function disablePreview(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PREVIEW_SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Read the `?preview=1` deep-link trigger (designer "try it now" links). */
export function urlRequestsPreview(search: string | null | undefined): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get("preview") === "1";
  } catch {
    return false;
  }
}

/**
 * Resolve the runtime mode.
 *
 * Demo wins over preview when both markers are present: a kiosk deep link
 * (`?demo=1`) is an explicit stakeholder-facing entry and must not be
 * hijacked by a stale preview flag. Unknown inputs resolve to "player".
 */
export function resolveRuntimeMode(search?: string | null): RuntimeMode {
  if (typeof window === "undefined") return "player";
  const s = search === undefined ? (typeof window.location === "undefined" ? null : window.location.search) : search;
  if (urlRequestsDemo(s) || isDemoActive()) return "demo";
  if (urlRequestsPreview(s) || isPreviewActive()) return "preview";
  return "player";
}
