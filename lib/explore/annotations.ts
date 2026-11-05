/**
 * Editorial annotations for published packs.
 *
 * The published pack JSON is the source of truth for facts (title, duration,
 * difficulty, stations, rewards). It has no place for editorial framing —
 * which category a pack belongs to, what it feels like, who it suits — and the
 * platform deliberately does not write to production data from a code release.
 *
 * So the framing lives here: a small, reviewed, version-controlled table keyed
 * by game id. Rules that keep this honest:
 *
 *  1. Only packs that are already published may be annotated. An annotation
 *     never makes content public; the registry still decides that.
 *  2. Numbers, durations, station counts and rewards are READ FROM THE PACK,
 *     never restated here. If the pack changes, the page follows.
 *  3. No invented social proof: no participant counts, no ratings, no
 *     "thousands of explorers". Those fields do not exist in this type on
 *     purpose.
 *  4. Every field is optional. A pack with no annotation still lists and plays;
 *     it just has no category, no tags and no editorial copy.
 *
 * Adding an entry is an editorial act, reviewed like code. It is not a data
 * migration and it does not touch Blob storage.
 */

import type { ExploreCategorySlug } from "./taxonomy";

export interface PackAnnotation {
  /** One of the three first-level categories, or omitted when not decided. */
  category?: ExploreCategorySlug;
  /** Interest tags. Keep them short, factual and reusable across packs. */
  tags?: string[];
  /** One sentence that says what the experience is, in plain language. */
  tagline?: string;
  /** Who it suits — audience, not marketing. */
  audience?: string;
  /** Individual or team, when the organiser actually designed for one. */
  teamMode?: string;
  /** "What you will find / do", derived from the pack's own structure. */
  goals?: string[];
  /** What to bring. Practical, not aspirational. */
  preparations?: string[];
  /** Safety notes for the real place. */
  safety?: string[];
  /** Editorial pick for the front page. At most a handful. */
  featured?: boolean;
  /** Lower sorts first among featured packs. */
  featuredRank?: number;
}

/**
 * One entry: the only publicly published pack as of 2026-11-05.
 *
 * Every claim below is checkable against the pack itself
 * (`GET /api/games/mos-classic-01`): 8 stations, 45 minutes, medium difficulty,
 * a 230 m campus area starting at the BSOP assembly point, 8 choice challenges,
 * 7 keyword rewards plus 1 completion badge.
 */
export const PACK_ANNOTATIONS: Readonly<Record<string, PackAnnotation>> = {
  "mos-classic-01": {
    category: "place-activity",
    tags: ["校园", "户外", "步行", "反思"],
    tagline: "在真实校园里走完八个站点，每一站做一个选择，带走一个关键词。",
    audience: "16 岁以上 · 个人或小组",
    teamMode: "个人，或 2–4 人小组同行",
    goals: [
      "在 BSOP 校园内依次到达八个真实地点",
      "每一站回答一个选择题，留下自己的判断",
      "收集七个关键词，最后带走一枚完成徽章",
    ],
    preparations: [
      "穿便于步行的鞋，全程在校园内步行",
      "手机电量充足，并允许浏览器使用定位",
      "预留约 45 分钟的连续时间",
    ],
    safety: [
      "校园内步行，注意车辆、台阶与湿滑地面",
      "天气炎热时自带饮水，量力而行",
      "身体不适可随时中止，进度保存在本机，下次继续",
    ],
    featured: true,
    featuredRank: 10,
  },
};

export function annotationFor(gameId: string): PackAnnotation | null {
  return Object.prototype.hasOwnProperty.call(PACK_ANNOTATIONS, gameId)
    ? PACK_ANNOTATIONS[gameId]
    : null;
}
