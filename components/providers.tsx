"use client";

/**
 * Application-wide providers.
 *
 * Provider order matters:
 *   Settings -> GameData -> GPS -> Hunt
 *
 * GPS needs Settings (for simulator config and the accuracy-slack preference),
 * and Hunt needs both GameData and GPS. Keeping the dependency direction one-way
 * is what stops a render loop between position updates and state reduction.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type PlayerSettings } from "@/lib/storage";

/* ------------------------------------------------------------------ */
/* Settings                                                          */
/* ------------------------------------------------------------------ */

interface SettingsContextValue {
  settings: PlayerSettings;
  update: (patch: Partial<PlayerSettings>) => void;
  /** False while the first read from storage is still pending. */
  ready: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PlayerSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  // Read once on mount: localStorage is not available during SSR, so this cannot
  // be a useState initialiser.
  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<PlayerSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("reduce-motion", settings.reduceMotion);
  }, [ready, settings.reduceMotion]);

  const value = useMemo(() => ({ settings, update, ready }), [settings, update, ready]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Online / offline                                                  */
/* ------------------------------------------------------------------ */

export function useOnlineStatus(): boolean {
  // Default to true so the first paint never flashes an "offline" badge while
  // navigator.onLine is still being determined.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

/** Prefers-reduced-motion, resolved for JS-driven animation. */
export function useReducedMotion(): boolean {
  const { settings } = useSettings();
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return settings.reduceMotion || systemReduced;
}

/* ------------------------------------------------------------------ */
/* Layout size                                                       */
/* ------------------------------------------------------------------ */

/**
 * Current viewport width, used to verify the mobile breakpoints in the test
 * report and to size the map's edge padding.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}
