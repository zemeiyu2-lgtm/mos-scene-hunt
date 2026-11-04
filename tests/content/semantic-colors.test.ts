import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * B-03 batch 4 (B03-09): semantic color convergence guard.
 *
 * Every status color in the app must come from the four semantic token
 * groups defined in globals.css (:root) — success (--ok-*), warning
 * (--warn-*), danger (--err-*) and info (--info-*). Scattered Tailwind
 * status palette classes (emerald/amber/red/blue/sky/orange/green) were
 * converged onto them; this file keeps them converged.
 *
 * Deliberately out of scope (documented in globals.css):
 *  - purple/violet: the DEV/simulator accent (internal tooling identity,
 *    not a status semantic);
 *  - slate/zinc: plain neutrals;
 *  - the brand palette (--hero-teal / --accent / --gold-*): the teal x
 *    gold pairing must not be repurposed as status colors.
 *
 * Contrast pairs are checked with the same WCAG 2.x math as
 * map-marker-contrast.test.ts: status ink on its own surface and on
 * white must reach 4.5:1 (normal text) — outdoor use means small text
 * happens in bright light, so we do not lean on the large-text 3:1 rule.
 */

const globalsCss = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

function parseRootVariables(css: string): Record<string, string> {
  const root = css.slice(css.indexOf(":root"), css.indexOf("html,"));
  const vars: Record<string, string> = {};
  for (const match of root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    vars[match[1]] = match[2];
  }
  return vars;
}

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

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const vars = parseRootVariables(globalsCss);
const v = (name: string): string => {
  const value = vars[name];
  if (!value) throw new Error(`missing semantic token --${name} in globals.css :root`);
  return value;
};
const WHITE = "#ffffff";

describe("B03-09 semantic tokens exist", () => {
  const REQUIRED = [
    "ok-bg", "ok-bg-strong", "ok-border", "ok-solid", "ok-strong", "ok-text",
    "warn-bg", "warn-bg-strong", "warn-border", "warn-solid", "warn-ink", "warn-solid-deep", "warn-text",
    "err-bg", "err-bg-strong", "err-border", "err-solid", "err-text",
    "info-bg", "info-border", "info-text",
  ] as const;

  it.each(REQUIRED)("defines --%s in :root", (name) => {
    expect(v(name)).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("does not repurpose the brand palette as status colors", () => {
    // The teal x gold brand pairing is untouched by the convergence.
    expect(v("hero-teal")).toBe("#173f3b");
    expect(v("accent")).toBe("#f5a524");
    expect(v("gold-bright")).toBe("#f5c26b");
    // Status tokens stay distinct from the brand gold accent.
    expect(v("warn-solid")).not.toBe(v("accent"));
  });
});

describe("B03-09 semantic contrast pairs (WCAG 2.x, normal text 4.5:1)", () => {
  const PAIRS: Array<[string, string, string, number]> = [
    // [ink, surface, description, minRatio]
    ["warn-text", "warn-bg", "warning ink on warning surface", 4.5],
    ["warn-text", "warn-bg-strong", "warning ink on amber-100 surface", 4.5],
    ["warn-ink", "warn-solid", "amber-950 ink on amber fill (badges)", 4.5],
    ["err-text", "err-bg", "danger ink on danger surface", 4.5],
    ["err-text", "err-bg-strong", "danger ink on red-100 surface", 4.5],
    ["ok-text", "ok-bg", "success ink on success surface", 4.5],
    ["ok-strong", "ok-bg-strong", "success-strong ink on emerald-100 chip", 4.5],
    ["info-text", "info-bg", "info ink on info surface", 4.5],
    // white-ink fills (buttons)
    ["err-solid", WHITE, "white ink on danger fill", 4.5],
    ["warn-solid-deep", WHITE, "white ink on warning-deep fill", 4.5],
    ["ok-solid", WHITE, "white ink on success fill", 3], // status quo of emerald-600 buttons, kept
  ];

  it.each(PAIRS)("%s on %s (%s) >= %s:1", (ink, surface, _desc, min) => {
    const ratio = contrast(v(ink), surface === WHITE ? WHITE : v(surface));
    expect(ratio).toBeGreaterThanOrEqual(min);
  });

  it("ink-on-white also reaches 4.5:1 for every status ink", () => {
    for (const ink of ["warn-text", "err-text", "ok-text", "ok-strong", "info-text"]) {
      expect(contrast(v(ink), WHITE)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("B03-09 no scattered status palette classes remain", () => {
  const files = execSync('git ls-files "app/**/*.tsx" "components/*.tsx"', {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(path.resolve(__dirname, "../..", f), "utf8");
    for (const match of src.matchAll(
      /(text|bg|border|ring|divide|from|to)-(red|amber|green|emerald|orange|blue|sky|yellow|rose|lime)-\d{2,3}(\/\d{1,3})?\b/g,
    )) {
      offenders.push(`${f}: ${match[0]}`);
    }
  }

  it("app/ and components/ use only semantic tokens for status colors", () => {
    expect(offenders).toEqual([]);
  });
});
