/**
 * Presentation-only visual theme tokens.
 *
 * This registry intentionally has no storage, browser, gameplay, or GPS
 * dependencies. A later UI-only switch may map these values to CSS custom
 * properties, but must not write them into game packs or player progress.
 */
export const DEFAULT_VISUAL_THEME = "natural-expedition" as const;

export const VISUAL_THEMES = {
  "natural-expedition": {
    label: "Natural Expedition",
    description: "A clear, outdoors-first baseline for exploration.",
    tokens: {
      surface: "#F5F8F6",
      card: "#FFFFFF",
      line: "#DDE7E2",
      text: "#14251F",
      muted: "#64748B",
      accent: "#109B81",
      accentDeep: "#08765F",
      decorative: "#E8F4EF",
    },
  },
  "story-journal": {
    label: "Story Journal",
    description: "Warm paper tones with readable ink and restrained earth accents.",
    tokens: {
      surface: "#F8F5EE",
      card: "#FFFEFA",
      line: "#E5DCCB",
      text: "#2E3028",
      muted: "#68695F",
      accent: "#497565",
      accentDeep: "#315B4C",
      decorative: "#F0E7D7",
    },
  },
  "city-detective": {
    label: "City Detective",
    description: "Crisp stone surfaces with focused teal clue accents.",
    tokens: {
      surface: "#F3F5F7",
      card: "#FFFFFF",
      line: "#D9E0E7",
      text: "#1D2935",
      muted: "#596A79",
      accent: "#247F83",
      accentDeep: "#176368",
      decorative: "#E5EEF0",
    },
  },
} as const;

export type VisualThemeId = keyof typeof VISUAL_THEMES;
export type VisualThemeTokens = (typeof VISUAL_THEMES)[VisualThemeId]["tokens"];

/**
 * Resolve an optional theme identifier safely.
 * Unknown or absent identifiers always preserve the current default theme.
 */
export function resolveVisualTheme(
  value: string | null | undefined,
): VisualThemeId {
  return value && Object.prototype.hasOwnProperty.call(VISUAL_THEMES, value)
    ? (value as VisualThemeId)
    : DEFAULT_VISUAL_THEME;
}
