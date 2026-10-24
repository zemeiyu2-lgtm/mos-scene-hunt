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
