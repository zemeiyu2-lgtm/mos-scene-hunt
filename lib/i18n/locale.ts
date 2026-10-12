/**
 * Small, dependency-free UI locale foundation.
 *
 * UI locale is intentionally separate from game-pack language and game saves.
 * Do not use this module to translate creator-authored game content.
 */
export type UiLocale = "en" | "zh-CN";

export const DEFAULT_UI_LOCALE: UiLocale = "en";
const UI_LOCALE_KEY = "mos-scene-hunt:ui-locale";

const messages = {
  en: {
    "common.online": "Online",
    "common.offline": "Offline",
    "common.back": "Back",
    "common.retry": "Try again",
    "common.loading": "Loading…",
    "home.eyebrow": "REAL-WORLD ADVENTURE",
    "home.title": "Step outside. Find your next clue.",
    "home.description": "Take your phone outdoors, find clues, complete challenges, and unlock a story one step at a time.",
    "home.chooseGame": "Choose a game",
    "home.watchDemo": "Watch the 1-minute demo",
    "home.outdoorsOnly": "Outdoor play only",
    "home.gpsSafety": "Indoor location accuracy can be unreliable. Explore in a safe, open outdoor area.",
    "home.resume": "Continue your hunt",
    "home.continue": "Continue",
    "home.inventory": "Inventory",
    "challenge.choice": "Choice challenge",
    "challenge.keyword": "Find the keyword",
    "challenge.shortAnswer": "Solve the puzzle",
    "challenge.confirmChoice": "Confirm choice",
    "challenge.submitKeyword": "Submit keyword",
    "challenge.checkAnswer": "Check answer",
    "challenge.submitting": "Unlocking…",
    "reward.incomplete": "Challenge not completed yet",
    "reward.notClaimed": "Reward not yet earned",
    "language.english": "English",
    "language.chinese": "简体中文",
    "language.label": "App language",
  },
  "zh-CN": {
    "common.online": "在线",
    "common.offline": "离线",
    "common.back": "返回",
    "common.retry": "重试",
    "common.loading": "正在加载…",
    "home.eyebrow": "真实世界探索",
    "home.title": "走出去，发现下一条线索",
    "home.description": "带上手机，在户外寻找线索、完成挑战，一步步解锁故事。",
    "home.chooseGame": "选择游戏开始",
    "home.watchDemo": "先看一分钟演示",
    "home.outdoorsOnly": "仅限户外游玩",
    "home.gpsSafety": "室内定位可能不稳定。请在安全、开放的户外区域探索。",
    "home.resume": "继续进行中的寻宝",
    "home.continue": "继续寻宝",
    "home.inventory": "背包",
    "challenge.choice": "选择挑战",
    "challenge.keyword": "寻找关键词",
    "challenge.shortAnswer": "解开谜题",
    "challenge.confirmChoice": "确认选择",
    "challenge.submitKeyword": "提交关键词",
    "challenge.checkAnswer": "检查答案",
    "challenge.submitting": "正在解锁…",
    "reward.incomplete": "任务尚未完成",
    "reward.notClaimed": "尚未领取奖励",
    "language.english": "English",
    "language.chinese": "简体中文",
    "language.label": "界面语言",
  },
} as const;

export type UiMessageKey = keyof typeof messages.en;

/** Return the user's saved UI language, defaulting to English for new users. */
export function getUiLocale(): UiLocale {
  try {
    if (typeof window === "undefined") return DEFAULT_UI_LOCALE;
    const stored = window.localStorage.getItem(UI_LOCALE_KEY);
    return stored === "zh-CN" || stored === "en" ? stored : DEFAULT_UI_LOCALE;
  } catch {
    return DEFAULT_UI_LOCALE;
  }
}

/** Save only the interface language; game content and progress are untouched. */
export function setUiLocale(locale: UiLocale): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(UI_LOCALE_KEY, locale);
  } catch {
    // The UI can still use the in-memory selection if browser storage is blocked.
  }
}

export function translate(locale: UiLocale, key: UiMessageKey): string {
  return messages[locale][key] ?? messages.en[key] ?? key;
}
