import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";

/**
 * Visual contrast regression guards (batch A of the 2026-10-24 visual
 * system work). These parse app/globals.css and enforce WCAG ratios so a
 * future token tweak cannot silently reintroduce the contrast failures
 * fixed in this batch.
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

function luminance(hex: string): number {
  const raw = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
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

function ruleFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in globals.css: ${selector}`);
  return match[1];
}

describe("visual contrast tokens (batch A)", () => {
  const vars = parseRootVariables(globalsCss);

  it("deep accent is the compliant #b45309, not the 3.37:1 #c47c0a", () => {
    expect(vars["accent-deep"]).toBe("#b45309");
  });

  it("white on deep accent (available marker / pressed button) meets AA", () => {
    expect(contrast("#ffffff", vars["accent-deep"])).toBeGreaterThanOrEqual(4.5);
  });

  it("deep accent as text on white card (kicker light, tab bar) meets AA", () => {
    expect(contrast(vars["accent-deep"], vars["card"])).toBeGreaterThanOrEqual(4.5);
  });

  it("primary button normal state meets AA", () => {
    expect(contrast(vars["accent"], "#2b1a00")).toBeGreaterThanOrEqual(4.5);
  });

  it("available scene marker adopted 018a81a7's semantics with white text", () => {
    const rule = ruleFor(globalsCss, ".scene-marker--available");
    expect(rule).toContain("var(--accent-deep)");
    expect(rule).toContain("#ffffff");
  });

  it("pressed primary button keeps white text on the deepened background", () => {
    const rule = ruleFor(globalsCss, ".btn-primary:active:not(:disabled)");
    expect(rule).toContain("#ffffff");
  });

  it("game-kicker keeps its dark-hero color and exposes a light variant", () => {
    const base = ruleFor(globalsCss, ".game-kicker");
    // Guard against someone "fixing" the light-bg problem globally.
    expect(base).toMatch(/rgba\(255,\s*255,\s*255/);
    const light = ruleFor(globalsCss, ".game-kicker--light");
    expect(light).toContain("var(--accent-deep)");
  });

  it("creation pages use the light kicker variant on their white cards", () => {
    const create = readFileSync(
      path.resolve(__dirname, "../../app/create/page.tsx"),
      "utf8",
    );
    const howTo = readFileSync(
      path.resolve(__dirname, "../../app/how-to-create/page.tsx"),
      "utf8",
    );
    expect(create).toContain("game-kicker game-kicker--light");
    expect(howTo).toContain("game-kicker game-kicker--light");
  });

  it("the select hero still uses the base kicker on its dark background", () => {
    const select = readFileSync(
      path.resolve(__dirname, "../../app/select/page.tsx"),
      "utf8",
    );
    expect(select).toMatch(/game-kicker(?!\s+game-kicker--light)/);
  });
});
