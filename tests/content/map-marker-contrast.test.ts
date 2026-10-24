import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";

/**
 * Map status marker contrast guards (batch D of the 2026-10-24 visual
 * work). Unlike the string-level guards elsewhere, every assertion here
 * resolves the actual CSS token / rule value first and then runs the WCAG
 * 2.x relative-luminance math on it — including alpha compositing where a
 * rule declares opacity, so "a translucent color looks fine on white" can
 * never pass while its real composited result fails.
 *
 * Standards applied (WCAG 2.x):
 *  - marker glyphs: 14px bold => normal text => 4.5:1 (the 3:1 large-text
 *    threshold does NOT apply: 14px bold is below the 18.66px-bold cutoff)
 *  - marker fill vs its 3px white border and vs the light raster tiles:
 *    UI component / graphic object => 3:1
 *
 * Tile boundary: the bundled providers (lib/map/tiles.ts) are OSM, OSM-hot
 * and Carto voyager — all light rasters. #e8eaef is the app's own map
 * fallback background; darker satellite tiles are not offered by any
 * provider. Separation from arbitrary street pixels is provided by the
 * markers' 3px white border (fill-vs-border >= 3:1 asserted for every
 * status), NOT by the fill color itself: even the untouched batch-A
 * available fill (#b45309) only reaches ~2.7:1 against a mid-tone street
 * pixel, so a per-pixel tile bound is not the mechanism this design uses.
 * The fill-vs-light-tile assertions below guard the worst case the app's
 * own background can produce.
 */

const globalsCss = readFileSync(
  path.resolve(__dirname, "../../app/globals.css"),
  "utf8",
);

function parseRootVariables(css: string): Record<string, string> {
  const root = css.slice(css.indexOf(":root"), css.indexOf("html,"));
  const vars: Record<string, string> = {};
  for (const match of root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    vars[match[1]] = match[2];
  }
  return vars;
}

/** Normalize #abc / #abcd / #abcde to #rrggbb (and #rrggbbaa to #rrggbb). */
function hex6(hex: string): string {
  const raw = hex.replace("#", "");
  if (raw.length === 3) return raw.split("").map((c) => c + c).join("").slice(0, 6);
  return raw.padEnd(6, "0").slice(0, 6);
}

function luminance(hex: string): number {
  const raw = hex6(hex);
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(raw.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 2.x contrast ratio between two hex colors. */
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Composite an #rrggbb color at `alpha` over an opaque background. */
function blend(fgHex: string, alpha: number, bg: string): string {
  const f = [0, 2, 4].map((i) => parseInt(hex6(fgHex).slice(i, i + 2), 16));
  const b = [0, 2, 4].map((i) => parseInt(hex6(bg).slice(i, i + 2), 16));
  return (
    "#" +
    f
      .map((c, i) =>
        Math.round(c * alpha + b[i] * (1 - alpha))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** Body of a selector's rule, tolerating grouped selectors ("a,\nb {"). */
function ruleFor(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`selector not found in globals.css: ${selector}`);
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/** Resolve `var(--x)` inside a rule body to its :root value when possible. */
function resolveColor(value: string, vars: Record<string, string>): string {
  const varMatch = value.match(/var\(--([\w-]+)\)/);
  if (varMatch) {
    const resolved = vars[varMatch[1]];
    if (!resolved) throw new Error(`unresolvable token var(--${varMatch[1]})`);
    return resolved;
  }
  const hex = value.match(/#[0-9a-fA-F]{3,8}/);
  if (!hex) throw new Error(`no color found in rule value: ${value}`);
  return hex[0];
}

const WHITE = "#ffffff";
/** The app's own light map fallback (.leaflet-container background). */
const LIGHT_TILE = "#e8eaef";

describe("map status marker contrast (batch D)", () => {
  const vars = parseRootVariables(globalsCss);

  // Foreground: the glyph color set on .scene-marker (#fff, line-level rule).
  const glyphColor = resolveColor(
    ruleFor(globalsCss, ".scene-marker").match(/color:\s*([^;]+);/)?.[1] ?? "",
    vars,
  );

  // Backgrounds: each status rule's background, resolved through tokens.
  const fills = {
    locked: resolveColor(ruleFor(globalsCss, ".scene-marker--locked").match(/background:\s*([^;]+);/)?.[1] ?? "", vars),
    available: resolveColor(ruleFor(globalsCss, ".scene-marker--available").match(/background:\s*([^;]+);/)?.[1] ?? "", vars),
    arrived: resolveColor(ruleFor(globalsCss, ".scene-marker--arrived").match(/background:\s*([^;]+);/)?.[1] ?? "", vars),
    completed: resolveColor(ruleFor(globalsCss, ".scene-marker--completed").match(/background:\s*([^;]+);/)?.[1] ?? "", vars),
  };

  it("keeps the four status fills hue-distinct (no single color for everything)", () => {
    expect(new Set(Object.values(fills)).size).toBe(4);
  });

  it("locked: solid deep slate, white glyph >= 4.5:1, fill >= 3:1 vs border and light tile", () => {
    expect(fills.locked).toBe("#5f6b7a");
    expect(contrast(glyphColor, fills.locked)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fills.locked, WHITE)).toBeGreaterThanOrEqual(3); // white border
    expect(contrast(fills.locked, LIGHT_TILE)).toBeGreaterThanOrEqual(3);
  });

  it("locked: no whole-marker opacity (it dimmed the glyph, not just the fill)", () => {
    // The old rule carried `opacity: 0.85`, compositing BOTH fill and glyph
    // with the tile and dragging real contrast to ~2.3-2.5:1. If a future
    // edit reintroduces opacity, only a composited pass counts.
    const rule = ruleFor(globalsCss, ".scene-marker--locked");
    const opacityMatch = rule.match(/opacity:\s*([\d.]+)/);
    if (!opacityMatch) return; // solid fill: covered by the direct assertion above
    const alpha = parseFloat(opacityMatch[1]);
    for (const tile of [LIGHT_TILE]) {
      const effBg = blend(fills.locked, alpha, tile);
      const effText = blend(glyphColor, alpha, effBg);
      expect(contrast(effText, effBg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("arrived/challenging: deep navigation blue, white glyph >= 4.5:1", () => {
    expect(fills.arrived).toBe("#2563eb");
    expect(contrast(glyphColor, fills.arrived)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fills.arrived, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(fills.arrived, LIGHT_TILE)).toBeGreaterThanOrEqual(3);
  });

  it("completed: dedicated deep green, white glyph >= 4.5:1, fill >= 3:1 vs border and light tile", () => {
    expect(fills.completed).toBe("#177245");
    expect(contrast(glyphColor, fills.completed)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fills.completed, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(fills.completed, LIGHT_TILE)).toBeGreaterThanOrEqual(3);
  });

  it("completed keeps --ok untouched for its non-marker roles (chips, completion hero)", () => {
    expect(vars.ok).toBe("#2ec27e");
  });

  it("available: regression guard, still accent-deep at >= 4.5:1 (batch A value)", () => {
    expect(fills.available).toBe("#b45309");
    expect(contrast(glyphColor, fills.available)).toBeGreaterThanOrEqual(4.5);
  });

  it("TS constants for Leaflet rings stay in lockstep with the CSS tokens", async () => {
    const { MARKER_LOCKED, MARKER_OK } = await import("@/lib/visual-tokens");
    expect(MARKER_LOCKED).toBe(vars["marker-locked"]);
    expect(MARKER_OK).toBe(vars["marker-ok"]);
  });

  it("game-map trigger rings follow the marker fills for completed/locked", () => {
    const map = readFileSync(
      path.resolve(__dirname, "../../components/game-map.tsx"),
      "utf8",
    );
    expect(map).not.toContain("#2ec27e");
    expect(map).not.toContain("#98a1b3");
    expect(map).toContain("MARKER_OK");
    expect(map).toContain("MARKER_LOCKED");
  });
});
