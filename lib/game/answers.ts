/**
 * Answer normalisation and matching.
 *
 * Real players type "记忆 ", "記憶", "MEMORY." and "memory!" and mean the same
 * thing. Matching happens here, in one place, so every content pack behaves
 * consistently and the behaviour is unit-testable.
 */

/**
 * Characters stripped before comparison.
 *
 * The interpunct family (·, ‧, •) matters more than it looks: the game's own UI
 * renders titles as "Demo Hunt · 记忆之路", so a player who copies text out of
 * the screen will paste an interpunct into their answer. Failing them for that
 * would be a self-inflicted bug.
 */
const PUNCTUATION =
  /[\s\u3000.,;:!?、。，；：！？…—\-_/\\'"“”‘’()（）\[\]【】{}《》·‧•・∙]+/g;

/**
 * Full-width -> half-width folding for ASCII-range characters.
 * Handles the common case where a Chinese IME leaves full-width punctuation or
 * digits in a latin answer.
 */
export function foldWidth(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code === 0x3000) {
      out += " ";
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Traditional -> simplified folding for the handful of characters that show up
 * in Chinese answers. A full conversion table would be a large dependency; these
 * are the ones that realistically appear in short-answer keywords.
 */
const T2S_MAP: Record<string, string> = {
  記: "记", 憶: "忆", 鑰: "钥", 匙: "匙", 橋: "桥", 樹: "树", 龍: "龙", 燈: "灯",
  門: "门", 國: "国", 學: "学", 會: "会", 書: "书", 車: "车", 東: "东", 長: "长",
  風: "风", 雲: "云", 時: "时", 間: "间", 開: "开", 關: "关", 頭: "头", 邊: "边",
  島: "岛", 園: "园", 廣: "广", 場: "场", 話: "话", 語: "语", 詞: "词", 樂: "乐",
  紅: "红", 綠: "绿", 藍: "蓝", 黃: "黄", 銀: "银", 錢: "钱", 寶: "宝", 舊: "旧",
  聲: "声", 響: "响", 靜: "静", 動: "动", 過: "过", 進: "进", 遠: "远", 近: "近",
  續: "续", 現: "现", 實: "实", 體: "体", 驗: "验", 證: "证", 據: "据", 紙: "纸",
  線: "线", 問: "问", 題: "题", 答: "答", 對: "对", 錯: "错", 選: "选", 項: "项",
};

export function foldTraditional(input: string): string {
  return Array.from(input)
    .map((ch) => T2S_MAP[ch] ?? ch)
    .join("");
}

/**
 * Canonical form used for comparison:
 * width-folded, traditional-folded, lowercased, punctuation-stripped.
 */
export function normalizeAnswer(input: string): string {
  if (typeof input !== "string") return "";
  return foldTraditional(foldWidth(input))
    .toLowerCase()
    .replace(PUNCTUATION, "");
}

/**
 * Levenshtein distance, iterative with a single rolling row.
 * Used only as a *typo* fallback for latin answers longer than 4 characters,
 * where a one-character slip ("memori") is obviously still correct.
 * Never applied to CJK, where one character can change the meaning entirely.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

const isMostlyLatin = (s: string): boolean => /^[\x20-\x7e]+$/.test(s);

export interface MatchOptions {
  /** Allow a single-character typo on latin answers. Default true. */
  allowTypo?: boolean;
  /** Extra accepted strings supplied by the content pack. */
  acceptedExtra?: string[];
}

export interface MatchResult {
  correct: boolean;
  /** How the match succeeded - useful for telemetry and for softening feedback. */
  method: "exact" | "typo" | "none";
  /** The canonical answer that matched, if any. */
  matchedAgainst?: string;
}

/**
 * Match a player's typed answer against a content pack's accepted answers.
 */
export function matchTextAnswer(
  playerInput: string,
  answer: string | string[],
  options: MatchOptions = {},
): MatchResult {
  const { allowTypo = true, acceptedExtra = [] } = options;
  const canonical = normalizeAnswer(playerInput);
  if (!canonical) return { correct: false, method: "none" };

  const candidates = [
    ...(Array.isArray(answer) ? answer : [answer]),
    ...acceptedExtra,
  ]
    .map(normalizeAnswer)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (canonical === candidate) return { correct: true, method: "exact", matchedAgainst: candidate };
  }

  if (allowTypo) {
    for (const candidate of candidates) {
      // ≥5 chars keeps the tolerance at roughly 20%, so "home" never matches
      // "hope", but "memori" still matches "memory".
      if (candidate.length >= 5 && isMostlyLatin(candidate)) {
        const distance = levenshtein(canonical, candidate);
        if (distance <= 1) {
          return { correct: true, method: "typo", matchedAgainst: candidate };
        }
      }
    }
  }

  return { correct: false, method: "none" };
}

/**
 * Check a choice answer. Accepts the option index or the option's own text, so
 * content authors can write either form without breaking save data.
 */
export function matchChoiceAnswer(
  selected: number | string,
  answer: number | string,
  options: string[] = [],
): boolean {
  if (typeof selected === "number" && typeof answer === "number") return selected === answer;

  const selectedText = typeof selected === "number" ? options[selected] : selected;
  const answerText =
    typeof answer === "number" ? options[answer] : answer;
  if (selectedText === undefined || answerText === undefined) return false;
  return normalizeAnswer(String(selectedText)) === normalizeAnswer(String(answerText));
}

/**
 * Union of `answer` and `acceptedKeywords`, used to build a forgiving input
 * matcher without exposing the answer list to the UI.
 */
export function buildAcceptedPool(
  answer: string | string[],
  acceptedKeywords: string[] = [],
): string[] {
  return [...(Array.isArray(answer) ? answer : [answer]), ...acceptedKeywords];
}
