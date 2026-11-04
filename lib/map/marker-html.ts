/**
 * Marker HTML shared by the DOM-based engines.
 *
 * Leaflet builds identical markup through `L.divIcon`; MapLibre accepts a raw
 * element in `new Marker({ element })`. Extracting the strings keeps the two
 * engines visually indistinguishable, which matters because the comparison
 * screenshots must differ only in the *basemap*, not in the game overlays.
 *
 * The `data-role` hooks are load-bearing: the E2E suite and the accessibility
 * tests query them, and the CSS in `globals.css` styles them.
 */

import { MARKER_LOCKED, MARKER_OK } from "@/lib/visual-tokens";

export const SCENE_MARKER_SIZE = 44;
export const PLAYER_MARKER_SIZE = 48;

export function sceneMarkerHtml(props: {
  status: string;
  isActive: boolean;
  glyph: string;
  sceneId: string;
}): string {
  const statusClass =
    props.status === "completed"
      ? "scene-marker--completed"
      : props.status === "arrived" || props.status === "challenging"
        ? "scene-marker--arrived"
        : props.status === "available"
          ? "scene-marker--available"
          : "scene-marker--locked";
  return `<div class="scene-marker-wrap ${props.isActive ? "scene-marker-wrap--active" : ""}">
      <div class="scene-marker ${statusClass} ${props.isActive ? "scene-marker--active" : ""}" data-role="scene-marker" data-scene-id="${props.sceneId}" data-status="${props.status}">${props.glyph}</div>
      ${props.isActive ? '<div class="scene-marker__beacon"></div>' : ""}
    </div>`;
}

export function playerMarkerHtml(simulated: boolean, heading: number | null): string {
  const direction = heading ?? 0;
  const pointer = `
    <div aria-hidden="true" style="position:absolute;left:50%;top:50%;width:22px;height:38px;transform:translate(-50%,-88%) rotate(${direction}deg);transform-origin:50% 88%;pointer-events:none;z-index:1;filter:drop-shadow(0 0 4px rgba(29,127,240,.55));">
      <div style="width:100%;height:100%;clip-path:polygon(50% 0%,100% 100%,50% 79%,0% 100%);background:linear-gradient(to bottom,rgba(219,234,254,.98) 0%,rgba(29,127,240,.85) 55%,rgba(29,127,240,.05) 100%);"></div>
    </div>`;
  return `<div class="player-marker ${simulated ? "player-marker--sim" : ""}" data-role="player-marker" style="position:relative;width:${PLAYER_MARKER_SIZE}px;height:${PLAYER_MARKER_SIZE}px;overflow:visible;">
             ${pointer}
             <div class="player-marker__pulse" style="position:absolute;left:50%;top:50%;right:auto;bottom:auto;width:38px;height:38px;transform:translate(-50%,-50%);z-index:2;"></div>
             <div class="player-marker__dot" style="position:absolute;left:50%;top:50%;right:auto;bottom:auto;width:22px;height:22px;transform:translate(-50%,-50%);z-index:3;"></div>
           </div>`;
}

export function vertexHtml(index: number): string {
  return `<div style="display:grid;place-items:center;width:22px;height:22px;border-radius:9999px;background:#f5a524;border:2px solid #fff;color:#3b2600;font:600 11px/1 ui-sans-serif,system-ui;box-shadow:0 1px 3px rgba(0,0,0,.35);">${index}</div>`;
}

export function huntHandleHtml(): string {
  return '<div style="width:18px;height:18px;border-radius:9999px;background:rgba(91,107,154,.25);border:2px solid #5b6b9a;cursor:grab"></div>';
}

export function isValidPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/** Ring colour by scene status, shared with the styling in `globals.css`. */
export function ringColor(status: string): string {
  return status === "completed" ? MARKER_OK : status === "locked" ? MARKER_LOCKED : "#f5a524";
}

export function ringStrokeOpacity(status: string): number {
  return status === "locked" ? 0.45 : 0.85;
}

export function ringFillOpacity(status: string, inRange: boolean): number {
  const base = inRange ? 0.22 : 0.1;
  return status === "locked" ? Math.min(base, 0.12) : base;
}
