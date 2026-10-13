"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_UI_LOCALE, getUiLocale, setUiLocale, translate, type UiLocale, type UiMessageKey } from "@/lib/i18n/locale";

type UiLocaleContextValue = {
  locale: UiLocale;
  ready: boolean;
  toggleLocale: () => void;
  t: (key: UiMessageKey) => string;
};

const UiLocaleContext = createContext<UiLocaleContextValue | null>(null);

export function UiLocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_UI_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocaleState(getUiLocale());
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
    }
  }, [locale]);

  const toggleLocale = useCallback(() => {
    setLocaleState((current) => {
      const next = current === "en" ? "zh-CN" : "en";
      setUiLocale(next);
      return next;
    });
  }, []);

  const value = useMemo<UiLocaleContextValue>(() => ({
    locale,
    ready,
    toggleLocale,
    t: (key) => translate(locale, key),
  }), [locale, ready, toggleLocale]);

  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale() {
  const value = useContext(UiLocaleContext);
  if (!value) throw new Error("useUiLocale must be used within UiLocaleProvider");
  return value;
}
