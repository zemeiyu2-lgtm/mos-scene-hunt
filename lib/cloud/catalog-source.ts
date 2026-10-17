/**
 * lib/cloud/catalog-source - 玩家可见目录的**唯一合并点**。
 *
 * 目录现在由两份数据合成：
 *
 *   1. 仓库内容层 `content/cloud/catalog.json` —— 随代码提交、随构建发布的官方内容
 *      （`rizal-park-discovery` 等）。它是「仓库即真相」的那一半，不能因为引入了
 *      Blob 就丢掉：静态示范游戏必须继续可下载。
 *   2. Blob 存储里的已发布索引 —— 经由发布接口提交、并在维护者确认后发布的新游戏。
 *
 * 合并规则（顺序即优先级）：
 *   - 先放仓库条目，再放 Blob 条目；
 *   - 同一个 id 两边都有时，**以 Blob 为准**（它是明确的「新版本发布」动作），
 *     仓库那份只保留下来作为「文件可用性」的兜底；
 *   - 任何条目都必须真正可下载才出现（见 isPlayable）。
 *
 * 为什么合并而不是直接取代：`content/*.json` 是随构建层发的静态资源，运维上比
 * Blob 更稳。把官方内容搬进 Blob 只会让「哪份是真相」又多一个答案。
 *
 * 这个模块只做纯逻辑 + 两个注入的读取器，方便单测覆盖「合并 + 过滤」而不用起服务。
 */

import type { CloudGameStatus, CloudGameEntry } from "./index";

export interface RawCatalogEntry {
  id: string;
  packFile: string;
  status: string;
  [key: string]: unknown;
}

/** 判断条目是否真的可以给玩家下载。 */
export type PlayabilityCheck = (entry: RawCatalogEntry) => Promise<boolean>;

export interface MergeOptions {
  /** 仓库内容层的条目（可能为空）。 */
  repoEntries: RawCatalogEntry[];
  /** Blob 索引里的已发布条目（可能为空）。 */
  blobEntries: RawCatalogEntry[];
  /** 可下载性检查（文件存在 + 包内 id 一致）。 */
  isPlayable: PlayabilityCheck;
}

export interface MergeResult {
  playable: RawCatalogEntry[];
  /** 因未发布 / 不可下载而被隐藏的条目数（供自检响应头使用）。 */
  hidden: number;
}

/**
 * 合并两份目录并只保留可下载条目。
 *
 * 「hidden」统计的是**参与本次合并的全部条目**里被过滤掉的数量，包括仓库与 Blob
 * 两边：这样 `X-Cloud-Catalog-Hidden` 能同时反映「有草稿没上线」和「文件坏了」。
 */
export async function mergeCatalogs({ repoEntries, blobEntries, isPlayable }: MergeOptions): Promise<MergeResult> {
  const byId = new Map<string, RawCatalogEntry>();

  for (const entry of repoEntries) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.id !== "string" || !entry.id) continue;
    byId.set(entry.id, entry);
  }
  for (const entry of blobEntries) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.id !== "string" || !entry.id) continue;
    // Blob 侧覆盖仓库侧：同 id 的新版本以发布接口为准。
    byId.set(entry.id, entry);
  }

  const all = [...byId.values()];
  const playable: RawCatalogEntry[] = [];
  let hidden = 0;
  for (const entry of all) {
    if (!(await isPlayable(entry))) {
      hidden += 1;
      continue;
    }
    playable.push(entry);
  }
  return { playable, hidden };
}

/**
 * 把已发布索引里的指针转成目录条目。
 *
 * `packFile` 统一写成 `<id>.json`：玩家侧 `/content/<packFile>` 这条公开路径对
 * Blob 发布的游戏同样成立（内容路由会回落到 store），所以目录格式不变，
 * 已有的客户端代码与 Service Worker 缓存规则都不用改。
 */
export function pointerToCatalogEntry(
  gameId: string,
  pointer: {
    digest: string;
    title: string;
    sceneCount: number;
    publishedAt: string;
  },
  extra: { author?: string; description?: string; language?: string; estimatedMinutes?: number; difficulty?: string } = {},
): RawCatalogEntry {
  return {
    id: gameId,
    title: pointer.title,
    author: extra.author ?? "MOS Scene Hunt",
    description: extra.description ?? "",
    language: extra.language ?? "zh-CN",
    ...(extra.estimatedMinutes ? { estimatedMinutes: extra.estimatedMinutes } : {}),
    ...(extra.difficulty ? { difficulty: extra.difficulty } : {}),
    sceneCount: pointer.sceneCount,
    status: "published" satisfies CloudGameStatus,
    packFile: `${gameId}.json`,
    digest: pointer.digest,
    publishedAt: pointer.publishedAt.slice(0, 10),
  };
}

/** 目录响应的类型（与 lib/cloud 的 CloudGameEntry 保持兼容，多一个 digest 字段）。 */
export type CatalogEntryOut = RawCatalogEntry & Partial<CloudGameEntry>;
