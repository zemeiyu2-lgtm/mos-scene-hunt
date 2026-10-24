import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";
import { NAV_BLUE } from "@/lib/visual-tokens";

/**
 * Token unification guards (batch B of the 2026-10-24 visual system work).
 * They keep the brand colors single-sourced: CSS custom properties in
 * app/globals.css for everything style-driven, lib/visual-tokens.ts for the
 * colors Leaflet needs as plain strings, and no raw hex duplicates in pages.
 */

const repoRoot = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(repoRoot, p), "utf8");

const globalsCss = read("app/globals.css");

function rootVar(name: string): string {
  const root = globalsCss.slice(
    globalsCss.indexOf(":root"),
    globalsCss.indexOf("html,"),
  );
  const match = root.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing :root token --${name}`);
  return match[1].trim();
}

describe("brand tokens (batch B)", () => {
  it("defines the teal x gold hero palette once", () => {
    expect(rootVar("hero-teal")).toBe("#173f3b");
    expect(rootVar("hero-teal-mid")).toBe("#27665c");
    expect(rootVar("hero-gold")).toBe("#d6ad67");
    expect(rootVar("gold-chalk")).toBe("#f4ead4");
    expect(rootVar("gold-bright")).toBe("#f5c26b");
  });

  it("defines the navigation blue family with documented variants", () => {
    expect(rootVar("nav-blue")).toBe("#1d7ff0");
    expect(rootVar("nav-blue-deep")).toBe("#2563eb");
    expect(rootVar("nav-blue-soft")).toBe("#60a5fa");
    expect(rootVar("accent-contrast")).toBe("#3a2400");
  });

  it("keeps lib/visual-tokens.ts in lockstep with the CSS tokens", () => {
    expect(NAV_BLUE).toBe(rootVar("nav-blue"));
  });

  it("homepage no longer hardcodes hero colors", () => {
    const page = read("app/page.tsx");
    for (const hex of ["#173f3b", "#27665c", "#d6ad67", "#f4ead4", "#f5c26b"]) {
      expect(page).not.toContain(hex);
    }
    expect(page).toContain("var(--hero-teal)");
    expect(page).toContain("var(--hero-gold)");
  });

  it("games and tutorial pages no longer hardcode hero colors", () => {
    for (const file of ["app/games/page.tsx", "app/tutorial/page.tsx"]) {
      const text = read(file);
      expect(text).not.toContain("#173f3b");
      expect(text).not.toContain("#f4ead4");
      expect(text).toContain("var(--gold-chalk)");
      expect(text).toContain("var(--hero-teal-veil)");
    }
  });

  it("map pointer uses the navigation blue tokens", () => {
    const map = read("app/map/page.tsx");
    expect(map).not.toMatch(/#(2563EB|2563eb|60A5FA|60a5fa)/);
    expect(map).toContain("var(--nav-blue-deep)");
    expect(map).toContain("var(--nav-blue-soft)");
  });

  it("globals.css map markers reference --nav-blue instead of raw hex", () => {
    expect(globalsCss).toContain("background: var(--nav-blue)");
    expect(globalsCss).toContain("var(--nav-blue-ring)");
  });

  it("accent-contrast replaces scattered #3a2400 text colors", () => {
    for (const file of [
      "app/design/page.tsx",
      "app/quest/page.tsx",
      "app/challenge/[sceneId]/page.tsx",
    ]) {
      expect(read(file)).not.toContain("#3a2400");
      expect(read(file)).toContain("var(--accent-contrast)");
    }
    // globals.css keeps exactly one definition (the token itself).
    const usages = globalsCss.match(/#3a2400/g) ?? [];
    expect(usages).toHaveLength(1);
  });

  it("removed the unused Tailwind ink/signal/moss palette", () => {
    const config = read("tailwind.config.ts");
    expect(config).not.toMatch(/\b(ink|signal|moss)\s*:/);
  });

  it("removed the dead BSOP reference and map-bottom-sheet styles", () => {
    for (const cls of [
      "bsop-reference__cover",
      "bsop-reference__image",
      "bsop-reference__overlay",
      ".bsop-key-rail__item {",
      ".map-bottom-sheet",
    ]) {
      expect(globalsCss).not.toContain(cls);
    }
    // And no template references them either.
    for (const dir of ["app", "components", "lib", "tests"]) {
      const { execSync } = require("node:child_process") as typeof import("node:child_process");
      const hits = execSync(
        `grep -rl "bsop-reference\\\\|bsop-key-rail\\\\|map-bottom-sheet" ${dir} --include="*.ts" --include="*.tsx" --include="*.mjs" || true`,
        { cwd: repoRoot, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter((line) => line && !line.includes("visual-tokens.test.ts"))
        .join("\n");
      expect(hits).toBe("");
    }
  });

  it("kept the live BSOP classes that reward/scene pages still use", () => {
    expect(globalsCss).toContain(".bsop-key");
    expect(globalsCss).toContain(".scene-observation");
  });

  it("select hero joined the brand teal x gold family (batch C)", () => {
    const rule = ruleForLike(globalsCss, ".hero-explore");
    expect(rule).toContain("var(--hero-teal)");
    expect(rule).toContain("var(--hero-gold)");
    expect(rule).not.toContain("#15233d");
  });
});

/** Matches a selector's rule body even when a later selector shares the prefix. */
function ruleForLike(css: string, selector: string): string {
  const idx = css.indexOf(selector + " {");
  if (idx === -1) throw new Error(`selector not found: ${selector}`);
  const end = css.indexOf("}", idx);
  return css.slice(idx, end);
}
