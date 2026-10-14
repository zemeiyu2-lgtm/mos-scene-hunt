"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_VISUAL_THEME,
  resolveVisualTheme,
  VISUAL_THEMES,
  type VisualThemeId,
} from "@/lib/ui/visual-themes";

const STORAGE_KEY = "mos-scene-hunt:visual-theme";

type VisualThemeContextValue = {
  theme: VisualThemeId;
  setTheme: (theme: VisualThemeId) => void;
};

const VisualThemeContext = createContext<VisualThemeContextValue | null>(null);

export function VisualThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<VisualThemeId>(DEFAULT_VISUAL_THEME);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      setThemeState(resolveVisualTheme(saved));
    } catch {
      // Private browsing or storage restrictions must not prevent the game from loading.
      setThemeState(DEFAULT_VISUAL_THEME);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.visualTheme = theme;
    return () => {
      delete document.documentElement.dataset.visualTheme;
    };
  }, [theme]);

  const setTheme = useCallback((next: VisualThemeId) => {
    const safeTheme = resolveVisualTheme(next);
    setThemeState(safeTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, safeTheme);
    } catch {
      // Theme still works for the current session when storage is unavailable.
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <VisualThemeContext.Provider value={value}>{children}</VisualThemeContext.Provider>;
}

export function useVisualTheme() {
  const value = useContext(VisualThemeContext);
  if (!value) throw new Error("useVisualTheme must be used within VisualThemeProvider");
  return value;
}

export const VISUAL_THEME_OPTIONS = Object.entries(VISUAL_THEMES).map(([id, definition]) => ({
  id: id as VisualThemeId,
  label: definition.label,
}));
