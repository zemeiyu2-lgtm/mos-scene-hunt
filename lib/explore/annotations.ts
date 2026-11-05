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
 *     never makes content public; the catalogue still decides that.
 *  2. Numbers, durations, station counts and rewards are READ FROM THE PACK,
 *     never restated here. If the pack changes, the page follows.
 *  3. No invented social proof: no participant counts, no ratings, no
 *     "thousands of explorers". Those fields do not exist in this type on
 *     purpose.
 *  4. Every field is optional. A pack with no annotation still lists and plays;
 *     it just has no category, no tags and no editorial copy.
 *
 * Adding an entry is an editorial act, reviewed like code. It is not a data
 * migration and it does not touch storage.
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
 * The only publicly published pack in the production catalogue as of
 * 2026-11-05: `rizal-park-discovery`, served by `/content/rizal-park-discovery.json`
 * and listed by `/content/cloud/catalog.json`.
 *
 * Nothing below restates a number from the pack: the five stations, the duration,
 * the difficulty, the 350 m area and the challenge/reward mix are all read from
 * the pack itself by `lib/explore/summary.ts`. What is added here is framing
 * only — the category, the tags and practical advice for the real place.
 */
export const PACK_ANNOTATIONS: Readonly<Record<string, PackAnnotation>> = {
  "rizal-park-discovery": {
    category: "culture-history",
    tags: ["公园", "历史", "户外", "步行"],
    tagline: "在黎刹公园里按线索走完几站，最后找到并兑现那份宝藏。",
    audience: "适合家庭、朋友或小组一起走",
    teamMode: "个人，或 2–4 人小组同行",
    goals: [
      "在黎刹公园内按线索依次到达各个站点",
      "通过观察、图片线索与选择题解开每一站",
      "收集关键词与道具，在最后一站兑现宝藏",
    ],
    preparations: [
      "穿便于步行的鞋，全程在公园内步行",
      "手机电量充足，并允许浏览器使用定位",
      "预留一段连续时间，园区日晒较强时自带饮水",
    ],
    safety: [
      "公园内步行，注意车辆、台阶与湿滑地面",
      "天气炎热时量力而行，身体不适可随时中止",
      "进度保存在本机，下次可以继续",
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
