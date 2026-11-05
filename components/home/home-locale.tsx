"use client";

/**
 * 首页 V2.0 的语言状态。
 *
 * 范围说明：V2.0 只重做首页，语言切换只作用于首页自身（其余页面仍是中文，
 * 不受影响，也不引入全站 i18n 架构改动）。选择持久化在 localStorage，下次
 * 打开首页沿用；首次访问按浏览器语言选择 zh / en。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { HOME_COPY, type HomeCopy, type HomeLocale } from "@/lib/home-copy";

const LOCALE_KEY = "mos-scene-hunt:home-locale";

interface HomeLocaleContextValue {
  locale: HomeLocale;
  t: HomeCopy;
  setLocale: (locale: HomeLocale) => void;
}

const HomeLocaleContext = createContext<HomeLocaleContextValue | null>(null);

function readInitialLocale(): HomeLocale {
  try {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (saved === "zh" || saved === "en") return saved;
    const nav = window.navigator.language?.toLowerCase() ?? "zh";
    return nav.startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}

export function HomeLocaleProvider({ children }: { children: ReactNode }) {
  // SSR 与首帧渲染固定 zh（与 <html lang="zh-CN"> 一致，保证水合确定性）；
  // 挂载后再按保存的偏好或浏览器语言切换。
  const [locale, setLocaleState] = useState<HomeLocale>("zh");

  useEffect(() => {
    setLocaleState(readInitialLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const setLocale = useCallback((next: HomeLocale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // 存储不可用（隐私模式等）时仅本次会话生效。
    }
  }, []);

  const value = useMemo<HomeLocaleContextValue>(
    () => ({ locale, t: HOME_COPY[locale], setLocale }),
    [locale, setLocale],
  );

  return <HomeLocaleContext.Provider value={value}>{children}</HomeLocaleContext.Provider>;
}

export function useHomeLocale(): HomeLocaleContextValue {
  const ctx = useContext(HomeLocaleContext);
  if (!ctx) throw new Error("useHomeLocale 必须在 HomeLocaleProvider 内使用");
  return ctx;
}

/** 导航栏右侧的「中 / EN」切换。 */
export function LocaleToggle() {
  const { locale, setLocale, t } = useHomeLocale();
  return (
    <div
      className="home-lang"
      role="group"
      aria-label={t.langToggleLabel}
    >
      <button
        type="button"
        aria-pressed={locale === "zh"}
        onClick={() => setLocale("zh")}
      >
        中
      </button>
      <button
        type="button"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}
