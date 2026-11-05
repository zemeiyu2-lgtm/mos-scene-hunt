/**
 * The production cloud catalogue — one source of truth.
 *
 * The catalogue used to be a literal inside `app/content/cloud/catalog.json/route.ts`.
 * The exploration centre needs the same list on the server, and two copies would
 * drift (a pack published into one and not the other is exactly the kind of lie
 * this release is meant to remove). So the literal moved here and the route now
 * only serialises it.
 *
 * What did NOT change: the URL, the response shape, the field names and the
 * cache headers. This is a code-level extraction, not a data migration — no
 * storage format, no environment variable and no published pack is touched.
 *
 * `status` is the whole publication gate for public reads. `published` is the
 * only value the exploration surface will ever list or serve; `draft`,
 * `unlisted` and `archived` are refused exactly like a non-existent id.
 */

import type { CloudCatalog } from "./index";

export const CLOUD_CATALOG: CloudCatalog = {
  version: "1.1",
  updatedAt: "2026-10-17",
  games: [
    {
      id: "rizal-park-discovery",
      title: "黎刹公园：寻找最后的宝藏",
      author: "MOS Scene Hunt · 官方母版",
      description: "观察、图片线索、团队挑战与最终宝藏兑现的轻量户外寻宝示范。坐标需由设计者现场确认。",
      language: "zh-CN",
      estimatedMinutes: 25,
      difficulty: "easy",
      sceneCount: 5,
      status: "published",
      packFile: "rizal-park-discovery.json",
    },
  ],
};
