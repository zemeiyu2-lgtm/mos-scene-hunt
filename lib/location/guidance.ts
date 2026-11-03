/**
 * Platform-aware geolocation guidance.
 *
 * The old copy told every player to open "the site settings in the address
 * bar". That is a Chrome/Android path: it does not exist in iOS Safari, where
 * a denied site can only be re-enabled from the system Settings app. Telling an
 * iPhone player to look for something that is not there is worse than saying
 * nothing, so the recovery steps are selected per platform.
 *
 * The module is deliberately pure: detection takes a plain probe object so it
 * can be unit-tested without a browser, and the copy is data rather than JSX so
 * the map and the select screen render the same words.
 */

export type PlatformId =
  | "ios-safari"
  | "ios-chrome"
  | "ios-firefox"
  | "ios-other"
  | "android-chrome"
  | "android-other"
  | "desktop"
  | "unknown";

export interface PlatformProbe {
  userAgent: string;
  /** `navigator.platform` (deprecated but still the most reliable iPad tell). */
  platform?: string;
  /** iPadOS 13+ reports a desktop UA; a touch-capable Mac is an iPad. */
  maxTouchPoints?: number;
}

export interface Guidance {
  title: string;
  steps: string[];
  /** One short sentence of context, e.g. "Safari will not prompt again". */
  note?: string;
}

/**
 * Which browser/OS pair is this?
 *
 * Order matters: every iOS browser is WebKit with an iPhone/iPad UA, so the iOS
 * branch must come before the generic Chrome/Android checks, and iPadOS must be
 * detected from the touch-capable "Macintosh" UA.
 */
export function detectPlatform(probe: PlatformProbe): PlatformId {
  const ua = probe.userAgent ?? "";
  if (!ua) return "unknown";

  const isIPadOsDesktopUa =
    /Macintosh/i.test(ua) && (probe.maxTouchPoints ?? 0) > 1;
  const isIos = /iPhone|iPad|iPod/i.test(ua) || isIPadOsDesktopUa || /iOS/i.test(ua);

  if (isIos) {
    if (/CriOS/i.test(ua)) return "ios-chrome";
    if (/FxiOS/i.test(ua)) return "ios-firefox";
    if (/EdgiOS|OPiOS|DuckDuckGo/i.test(ua)) return "ios-other";
    if (/Safari/i.test(ua)) return "ios-safari";
    return "ios-other";
  }

  if (/Android/i.test(ua)) {
    const chromeLike = /Chrome|CriOS/i.test(ua);
    const otherShell = /EdgA|OPR|SamsungBrowser|Firefox|UCBrowser|MiuiBrowser|HuaweiBrowser/i.test(ua);
    return chromeLike && !otherShell ? "android-chrome" : "android-other";
  }

  return "desktop";
}

/** Detect from the live environment, falling back to "unknown" on the server. */
export function detectCurrentPlatform(): PlatformId {
  if (typeof navigator === "undefined") return "unknown";
  return detectPlatform({
    userAgent: navigator.userAgent ?? "",
    platform: (navigator as Navigator & { platform?: string }).platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

const PERMISSION_GUIDE: Record<PlatformId, Guidance> = {
  "ios-safari": {
    title: "在 iPhone / iPad 上重新允许定位",
    steps: [
      "打开系统的「设置」",
      "向下找到「Safari 浏览器」",
      "点「位置」，选择「使用 App 期间」或「询问」",
      "回到本页，点下方「重新请求定位」",
    ],
    note: "Safari 不会再次自动弹出授权框，必须先在系统设置里改。",
  },
  "ios-chrome": {
    title: "在 iPhone / iPad 的 Chrome 中重新允许定位",
    steps: [
      "打开系统的「设置」",
      "向下找到「Chrome」",
      "点「位置」，选择「使用 App 期间」或「询问」",
      "回到本页，点下方「重新请求定位」",
    ],
    note: "iOS 上的所有浏览器都从系统设置管理位置权限。",
  },
  "ios-firefox": {
    title: "在 iPhone / iPad 的 Firefox 中重新允许定位",
    steps: [
      "打开系统的「设置」",
      "向下找到「Firefox」",
      "点「位置」，选择「使用 App 期间」或「询问」",
      "回到本页，点下方「重新请求定位」",
    ],
    note: "iOS 上的所有浏览器都从系统设置管理位置权限。",
  },
  "ios-other": {
    title: "在 iPhone / iPad 上重新允许定位",
    steps: [
      "打开系统的「设置」",
      "找到你正在使用的浏览器（Safari、Chrome 或 Firefox）",
      "点「位置」，选择「使用 App 期间」或「询问」",
      "回到本页，点下方「重新请求定位」",
    ],
    note: "iOS 上的浏览器位置权限只能在系统设置里修改。",
  },
  "android-chrome": {
    title: "在 Android Chrome 中重新允许定位",
    steps: [
      "点地址栏左侧的锁形或 ⓘ 图标",
      "选择「权限」→「位置」",
      "改为「允许」",
      "回到本页，点下方「重新请求定位」",
    ],
  },
  "android-other": {
    title: "在 Android 浏览器中重新允许定位",
    steps: [
      "打开浏览器菜单，进入「设置」→「站点权限」→「位置」",
      "找到本站并改为「允许」",
      "同时在系统「设置」→「应用」中确认浏览器有位置权限",
      "回到本页，点下方「重新请求定位」",
    ],
  },
  desktop: {
    title: "在浏览器中重新允许定位",
    steps: [
      "点地址栏左侧的站点图标（锁形或 ⓘ）",
      "把「位置」改为「允许」",
      "刷新本页或点下方「重新请求定位」",
    ],
  },
  unknown: {
    title: "重新允许定位",
    steps: [
      "在浏览器的站点设置（地址栏旁的锁形图标）中允许定位",
      "iPhone / iPad 用户请到系统「设置」里找到当前浏览器并允许位置",
      "回到本页，点下方「重新请求定位」",
    ],
  },
};

const LOCATION_SERVICE_GUIDE: Record<PlatformId, Guidance> = {
  "ios-safari": {
    title: "确认系统定位服务已开启",
    steps: ["设置 → 隐私与安全性 → 定位服务：打开", "在列表中找到「Safari 浏览器」，选择「使用 App 期间」"],
  },
  "ios-chrome": {
    title: "确认系统定位服务已开启",
    steps: ["设置 → 隐私与安全性 → 定位服务：打开", "在列表中找到「Chrome」，选择「使用 App 期间」"],
  },
  "ios-firefox": {
    title: "确认系统定位服务已开启",
    steps: ["设置 → 隐私与安全性 → 定位服务：打开", "在列表中找到「Firefox」，选择「使用 App 期间」"],
  },
  "ios-other": {
    title: "确认系统定位服务已开启",
    steps: ["设置 → 隐私与安全性 → 定位服务：打开", "确认当前浏览器在允许列表中"],
  },
  "android-chrome": {
    title: "确认系统定位已开启",
    steps: ["下拉通知栏，确认「位置信息」已打开", "设置 → 位置信息 → 位置服务：开启并选择「高精度」"],
  },
  "android-other": {
    title: "确认系统定位已开启",
    steps: ["下拉通知栏，确认「位置信息」已打开", "设置 → 位置信息 → 位置服务：开启"],
  },
  desktop: {
    title: "确认系统定位已开启",
    steps: ["Windows：设置 → 隐私和安全性 → 位置：允许", "macOS：系统设置 → 隐私与安全性 → 定位服务：开启"],
  },
  unknown: {
    title: "确认系统定位已开启",
    steps: ["手机下拉通知栏确认定位开关已打开", "系统设置 → 隐私 / 位置信息中允许浏览器使用位置"],
  },
};

/** Steps for recovering from a denied site permission. */
export function permissionRecoveryGuide(platform: PlatformId): Guidance {
  return PERMISSION_GUIDE[platform] ?? PERMISSION_GUIDE.unknown;
}

/** Steps for the "permission is granted but no fix ever arrives" case. */
export function locationServiceGuide(platform: PlatformId): Guidance {
  return LOCATION_SERVICE_GUIDE[platform] ?? LOCATION_SERVICE_GUIDE.unknown;
}

/** True when the platform manages site permissions outside the browser UI. */
export function usesSystemSettingsForLocation(platform: PlatformId): boolean {
  return platform.startsWith("ios-");
}
