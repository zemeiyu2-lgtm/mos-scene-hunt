import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_THEME,
  resolveVisualTheme,
  VISUAL_THEMES,
} from "@/lib/ui/visual-themes";

function relativeLuminance(hex: string): number {
  const channels = hex.replace("#", "").match(/.{2}/g);
  if (!channels || channels.length !== 3) throw new Error(`Invalid hex colour: ${hex}`);
  const linear = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("visual theme registry", () => {
  it("keeps Natural Expedition as the safe default", () => {
    expect(DEFAULT_VISUAL_THEME).toBe("natural-expedition");
    expect(resolveVisualTheme(undefined)).toBe(DEFAULT_VISUAL_THEME);
    expect(resolveVisualTheme(null)).toBe(DEFAULT_VISUAL_THEME);
    expect(resolveVisualTheme("unknown-theme")).toBe(DEFAULT_VISUAL_THEME);
  });

  it("resolves every declared theme without changing gameplay data", () => {
    expect(Object.keys(VISUAL_THEMES)).toEqual([
      "natural-expedition",
      "story-journal",
      "city-detective",
    ]);
    for (const id of Object.keys(VISUAL_THEMES)) {
      expect(resolveVisualTheme(id)).toBe(id);
      expect(VISUAL_THEMES[id as keyof typeof VISUAL_THEMES].tokens).toMatchObject({
        surface: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        card: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        line: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        text: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        muted: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        accent: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        accentDeep: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        decorative: expect.stringMatching(/^#[0-9A-F]{6}$/i),
      });
    }
  });

  it("keeps white text on primary/deep accent colours at WCAG AA contrast", () => {
    for (const theme of Object.values(VISUAL_THEMES)) {
      expect(contrastRatio("#FFFFFF", theme.tokens.accentDeep)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps body text and muted text readable on their theme surfaces", () => {
    for (const theme of Object.values(VISUAL_THEMES)) {
      expect(contrastRatio(theme.tokens.text, theme.tokens.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.tokens.muted, theme.tokens.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
