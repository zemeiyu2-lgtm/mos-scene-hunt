/**
 * Single TS source for map colors that Leaflet consumes as plain strings:
 * Leaflet sets SVG paint attributes programmatically, and attribute values
 * cannot resolve CSS custom properties, so the --nav-* tokens in
 * app/globals.css cannot be referenced directly here.
 *
 * tests/content/visual-tokens.test.ts asserts these constants stay in
 * lockstep with the CSS tokens.
 */

/** Player/position blue (CSS: --nav-blue). */
export const NAV_BLUE = "#1d7ff0";

/**
 * Deepened map-marker status fills (CSS: --marker-locked / --marker-ok),
 * batch D of the 2026-10-24 visual work. The scene trigger rings are drawn
 * by Leaflet as SVG paths and need plain strings; their completed/locked
 * strokes follow the marker fills so ring and marker read as one status
 * color. A unit test keeps these in lockstep with the CSS tokens.
 */
export const MARKER_LOCKED = "#5f6b7a";
export const MARKER_OK = "#177245";
