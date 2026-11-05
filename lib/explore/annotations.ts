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
  /** City attribution exists only while at least one linked pack is public. */
  cityId?: string;
  cityName?: string;
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
 * Editorial annotations for public packs. City labels are exposed only while
 * the corresponding real published pack is present in the public catalogue.
 *
 * Nothing below restates a number from the pack: the five stations, the duration,
 * the difficulty, the 350 m area and the challenge/reward mix are all read from
 * the pack itself by `lib/explore/summary.ts`. What is added here is framing
 * only — the category, the tags and practical advice for the real place.
 */
export const PACK_ANNOTATIONS: Readonly<Record<string, PackAnnotation>> = {
  "mos-ph-mnl-intramuros-01": {"cityId":"manila-ph","cityName":"马尼拉","category":"culture-history","tags":["王城墙垣","城市历史","建筑","步行"],"safety":["五个任务点均在免费露天区域；不进入圣地亚哥堡等收费区或建筑物。","门洞 GPS 多径明显；定位不稳时在安全开放区域停留，不要靠近限制区域。"]},
  "mos-ph-mnl-rizal-park-01": {"cityId":"manila-ph","cityName":"马尼拉","category":"culture-history","tags":["历史","人物","纪念公园","步行"],"safety":["五个点位均在黎刹公园免费露天区域。","纪念碑哨兵区禁止越过围栏；公园开放时段以现场告示为准。"]},
  "mos-ph-mnl-arroceros-01": {"cityId":"manila-ph","cityName":"马尼拉","category":"nature-outdoor","tags":["城市森林","生态","公园","步行"],"preparations":["免费开放 08:00–17:00；入园需在门口签到。"],"safety":["树冠遮挡可能造成 15–40 m GPS 漂移；抵达后建议原地停留约 5 秒。","任务在公园及剧院门前广场完成，不进入建筑物。"]},
  "mos-ph-cebu-fort-san-pedro-01": {"cityId":"cebu-city-ph","cityName":"宿务","category":"culture-history","tags":["历史","堡垒","广场","步行"],"preparations":["堡垒准入费约 ₱30；闭园时间来源不一，出发前复核当天安排。"],"safety":["堡垒中庭 GPS 多径风险较高；按现场安全位置定位，不进入限制区域。","麦哲伦十字架游客较多，请注意随身财物。"]},
  "mos-ph-cebu-tops-lookout-01": {"cityId":"cebu-city-ph","cityName":"宿务","category":"nature-outdoor","tags":["观景","山地","城市景观","户外"],"preparations":["TOPS 24 小时开放，门票 ₱100（现金）；停车约 ₱50。"],"safety":["大雾时视野与定位可能同时失效，建议改期。","全部点位在护栏内侧，禁止翻越；Mountain View 可能另行收费，以现场公示为准。"]},
  "mos-ph-baguio-botanical-garden-01": {"cityId":"baguio-ph","cityName":"碧瑶","category":"nature-outdoor","tags":["植物园","松林","自然观察","步行"],"preparations":["官方开放 06:00–18:00，门票 ₱110；出发前核对当天公告。"],"safety":["任务不进入隧道或任何建筑物；洞口触发半径约 10 m。","树冠遮挡可能造成 15–40 m GPS 漂移，建议原地停留约 5 秒。"]},
  "mos-ph-baguio-burnham-park-01": {"cityId":"baguio-ph","cityName":"碧瑶","category":"nature-outdoor","tags":["湖畔","公园","环线","步行"],"safety":["Burnham Park 24 小时免费开放。","北段台阶雨后湿滑；玩法不依赖乘船或轮滑等付费活动。"]},
  "mos-ph-davao-magsaysay-park-01": {"cityId":"davao-city-ph","cityName":"达沃","category":"nature-outdoor","tags":["海湾","公园","户外","文化"],"preparations":["公园免费，开放约 04:00–22:00，以现场告示为准。"],"safety":["节庆期间场院可能被临时设施占用；摊位会更替，任务不依赖具体摊位。"]},
  "mos-ph-davao-peoples-park-01": {"cityId":"davao-city-ph","cityName":"达沃","category":"culture-history","tags":["地标","城市文化","雕塑","步行"],"preparations":["公园免费；开放时段和整修状态可能变化，行前复核官方公告。"],"safety":["全部任务在前坪和步道等露天区域完成，不进入建筑物。","若当日闭园或正在整修，不要进入，待确认开放后再游玩。"]},
  "mos-ph-davao-chinatown-01": {"cityId":"davao-city-ph","cityName":"达沃","category":"culture-history","tags":["唐人街","城市文化","建筑","步行"],"safety":["四座牌坊临街露天、免费；请走人行道和斑马线。","街道峡谷可能造成 GPS 漂移，建议在牌坊正下方取位。"]},
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
