import { NextResponse } from "next/server";
import { readBlobConfig, readDrafts } from "@/lib/cloud/blob-store";
import { mergeCatalogs, type RawCatalogEntry } from "@/lib/cloud/catalog-source";
import {
  blobPackUsable,
  indexToCatalogEntries,
  readPublishedIndex,
  readRepoCatalog,
  repoPackUsable,
} from "@/lib/cloud/publish-store";

/**
 * GET /content/cloud/catalog.json - 玩家可见的云端游戏目录。
 *
 * 数据来源（合并逻辑见 lib/cloud/catalog-source）：
 *   1. 仓库内容层 `content/cloud/catalog.json` —— 随构建发布的官方/静态示范内容；
 *   2. Vercel Blob 里的已发布索引 —— 经发布接口提交并发布的新游戏。
 *
 * 这是「发布 / 目录查询 / 下载」三条链路共用同一份持久化数据的那一环：
 * 目录读的索引与下载读的包体在同一个 Blob store 里，而且可下载性检查会先
 * 真的把包体读回来验证，所以不存在「目录说有、下载却取不到」的分叉。
 *
 * 过滤规则（缺一不可）：
 *   - 只返回 status=published（draft / unlisted / archived 一律不出现）；
 *   - 包必须真的可读，且包内 id 与条目 id 一致。
 * 第二条不是多余的：指向不存在/张冠李戴的条目会让玩家点了下载才失败。
 * 目录宁可少一条，也不要给一个坏链接。
 *
 * 缓存策略：目录是公开只读数据，60 秒 + stale-while-revalidate。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_PACK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

function safePackFile(value: unknown): value is string {
  return typeof value === "string" && SAFE_PACK_FILE.test(value) && !value.includes("..");
}

/** 条目是否真的可下载：状态 + 包可读 + 包内 id 与条目一致。 */
async function isPlayable(entry: RawCatalogEntry): Promise<boolean> {
  if (entry.status !== "published") return false;
  if (!safePackFile(entry.packFile)) return false;
  if (typeof entry.digest === "string" && /^[0-9a-f]{64}$/.test(entry.digest)) {
    // 来自 Blob 索引的条目：按摘要读包体，同时校验包内 id。
    return blobPackUsable(entry);
  }
  return repoPackUsable(entry);
}

export async function GET() {
  // 仓库内容层是随构建发布的静态资源，读不到说明部署本身有问题，可以直接报错；
  // Blob 侧的失败则降级——不能让新存储的瞬时故障把官方示范游戏也一起藏起来。
  const repo = await readRepoCatalog();
  if (repo.error) {
    return NextResponse.json(
      { error: "catalog_unreadable", message: repo.error },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const blobConfigured = readBlobConfig().configured;
  let blobEntries: RawCatalogEntry[] = [];
  let blobDegraded = false;
  let blobCorrupt = false;
  if (blobConfigured) {
    try {
      const [index, drafts] = await Promise.all([readPublishedIndex(), readDrafts()]);
      blobEntries = indexToCatalogEntries(index, drafts.games as unknown as RawCatalogEntry[]);
    } catch (error) {
      // 降级不等于「正常」：索引损坏时目录会少掉所有经云端发布的游戏，
      // 必须让调用方从响应头看得出来，而不是显示成一个「恰好很短」的目录。
      blobDegraded = true;
      const name = (error as { name?: string } | null)?.name ?? "";
      const kind = (error as { kind?: unknown } | null)?.kind;
      blobCorrupt = (name === "BlobStoreError" || name === "BlobBackendError") && kind === "corrupt";
    }
  }

  const { playable, hidden } = await mergeCatalogs({
    repoEntries: repo.entries,
    blobEntries,
    isPlayable,
  });

  const headers: Record<string, string> = {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    // 自检用：本次因「未发布 / 文件缺失 / id 不一致」被隐藏的条目数量。
    "X-Cloud-Catalog-Hidden": String(hidden),
    // 自检用：本次目录由谁提供（repo-only = 未接入存储；degraded = 存储读取失败已降级；
    // corrupt = 已发布索引损坏，云端发布的游戏本次全部缺失）。
    "X-Cloud-Catalog-Backend": !blobConfigured ? "repo-only" : blobCorrupt ? "corrupt" : blobDegraded ? "degraded" : "blob",
  };
  if (blobCorrupt) {
    // 明确告诉客户端「这份目录不完整」，避免把数据损坏当成「云端还没有游戏」。
    headers["X-Cloud-Catalog-Warning"] = "published-index-corrupt";
  }

  return NextResponse.json(
    {
      version: "1.0",
      updatedAt: new Date().toISOString().slice(0, 10),
      games: playable,
    },
    { headers },
  );
}
