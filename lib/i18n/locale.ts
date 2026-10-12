/**
 * Small, dependency-free UI locale foundation.
 *
 * UI locale is intentionally separate from game-pack language and game saves.
 * Do not use this module to translate creator-authored game content.
 */
export type UiLocale = "en" | "zh-CN";

// Keep the draft experience consistently Chinese until the main routes are bilingual.
// Switch new-user default back to English when the language selector is released.
export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";
const UI_LOCALE_KEY = "mos-scene-hunt:ui-locale";

const messages = {
  en: {
    "status.locked": "Locked",
    "status.available": "Ready to visit",
    "status.arrived": "Arrived",
    "status.challenging": "In challenge",
    "status.completed": "Completed",
    "distance.locating": "Getting location…",
    "distance.inRange": "Inside the challenge area",
    "distance.target": "Distance to target:",
    "distance.direction": "direction",
    "distance.triggerRadius": "Trigger radius",

        "challenge.pageTitle": "Challenge",
    "challenge.sceneMissing": "Scene not found",
    "challenge.returnList": "Back to hunt list",
    "challenge.done": "You have completed this challenge",
    "challenge.reward": "Reward:",
    "challenge.nextLocation": "Go to the next location",
    "challenge.viewFindings": "View your findings",
    "challenge.outsideArea": "You are outside the challenge area",
    "challenge.distanceUnknown": "unknown distance",
    "challenge.continueOutside": "You can finish an opened challenge, but returning near the location is recommended for the best experience.",
    "challenge.choiceType": "Multiple choice",
    "challenge.keywordType": "Keyword",
    "challenge.textType": "Short answer",
    "challenge.yourAnswer": "Your answer",
    "challenge.keywordPlaceholder": "Enter a keyword…",
    "challenge.answerPlaceholder": "Enter your answer…",
    "challenge.normalizationHint": "Capitalization, full-/half-width characters, and punctuation are ignored automatically.",
    "challenge.solved": "Completed",
    "challenge.keyComing": "Your key is on its way…",
    "challenge.wrong": "Not quite",
    "challenge.wrongHint": "Try again. A wrong answer will not cost you any progress.",
    "challenge.hint": "Hint",
    "challenge.submitting": "Completing…",
    "challenge.submit": "Submit answer",
    "challenge.backToMap": "Back to map",
    "challenge.attemptHint": "Hint: the answer relates to something specific you can observe at the location. Keep it simple.",
    "challenge.task": "Challenge",
    "challenge.notFound": "This challenge could not be found.",
"common.online": "Online",
    "common.offline": "Offline",
    "common.back": "Back",
    "common.retry": "Try again",
    "common.loading": "Loading…",
    "home.online": "Online",
    "home.offline": "Offline",
    "home.continueHunt": "Continue your hunt",
    "home.completed": "Completed",
    "home.stations": "stops",
    "home.minutes": "min",
    "home.cached": "Offline cache",
    "home.myCreation": "My creation",
    "home.availableGames": "Available hunts",
    "home.contentFailed": "Could not load game content",
    "home.reload": "Reload",
    "home.example": "Featured example · BSOP Seminary",
    "home.exampleTitle": "Eight Secrets of the Seminary",
    "home.exampleDescription": "Eight outdoor locations and eight light Bible-memory questions. Find clues, answer questions, collect the keys, and see if you can finish the hunt!",
    "home.tryDemo": "Try the demo",
    "home.designImport": "Create / Import",
    "home.designTitle": "Want to create your own game?",
    "home.designDescription": "Use your usual AI tool to brainstorm gameplay, then import a game package. No coding or built-in AI required.",
    "home.learnCreate": "Learn how to create a game →",
    "home.contentLanguage": "Game language",
    "home.design": "Design / Import",
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
    "status.locked": "未解锁",
    "status.available": "待前往",
    "status.arrived": "已到达",
    "status.challenging": "答题中",
    "status.completed": "已完成",
    "distance.locating": "正在获取定位…",
    "distance.inRange": "已进入任务区域",
    "distance.target": "距离目标：",
    "distance.direction": "方向",
    "distance.triggerRadius": "触发半径",

        "challenge.pageTitle": "挑战",
    "challenge.sceneMissing": "场景不存在",
    "challenge.returnList": "返回任务列表",
    "challenge.done": "你已完成这个任务",
    "challenge.reward": "奖励：",
    "challenge.nextLocation": "前往下一个地点",
    "challenge.viewFindings": "查看收获",
    "challenge.outsideArea": "你现在不在任务区域内",
    "challenge.distanceUnknown": "距离未知",
    "challenge.continueOutside": "已打开的任务可以继续完成，但建议回到地点附近以获得最佳体验。",
    "challenge.choiceType": "选择题",
    "challenge.keywordType": "关键词题",
    "challenge.textType": "简答题",
    "challenge.yourAnswer": "你的答案",
    "challenge.keywordPlaceholder": "输入关键词…",
    "challenge.answerPlaceholder": "输入你的答案…",
    "challenge.normalizationHint": "大小写、全角半角与标点都会被自动忽略。",
    "challenge.solved": "完成了",
    "challenge.keyComing": "这一站的钥匙正在交到你手里…",
    "challenge.wrong": "答案不正确",
    "challenge.wrongHint": "这次没有答对，可以再试一次。答错不会丢失任何进度。",
    "challenge.hint": "提示",
    "challenge.submitting": "完成中…",
    "challenge.submit": "提交答案",
    "challenge.backToMap": "回到地图",
    "challenge.attemptHint": "提示：答案与你在现场能观察到的具体事物有关，不必想得太复杂。",
    "challenge.task": "任务",
    "challenge.notFound": "找不到这个任务。",
"common.online": "在线",
    "common.offline": "离线",
    "common.back": "返回",
    "common.retry": "重试",
    "common.loading": "正在加载…",
    "home.online": "在线",
    "home.offline": "离线",
    "home.continueHunt": "继续寻宝",
    "home.completed": "已完成",
    "home.stations": "站",
    "home.minutes": "分钟",
    "home.cached": "离线缓存",
    "home.myCreation": "我的创作",
    "home.availableGames": "可用寻宝",
    "home.contentFailed": "内容包加载失败",
    "home.reload": "重新加载",
    "home.example": "经典案例 · BSOP 神学院",
    "home.exampleTitle": "《神学院的八个秘密》",
    "home.exampleDescription": "八个户外站点、八道轻松的圣经记忆题。找线索、答问题、集齐钥匙，看看你能不能一次通关！",
    "home.tryDemo": "试玩示范",
    "home.designImport": "设计 / 导入",
    "home.designTitle": "想设计自己的游戏？",
    "home.designDescription": "用你平常使用的 AI 帮你想玩法，再导入游戏包。不需要编程，也不需要 MOS Scene Hunt 内置 AI。",
    "home.learnCreate": "学习如何设计游戏 →",
    "home.contentLanguage": "游戏内容语言",
    "home.design": "设计 / 导入",
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
