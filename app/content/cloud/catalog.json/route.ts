import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * GET /content/cloud/catalog.json - 云端游戏目录（动态读取）。
 *
 * 历史问题：这个路由此前返回的是**模块里硬编码的常量**，与 `content/cloud/catalog.json`
 * 是两份会漂移的数据。发布/落库只改文件、目录却不变，玩家自然看不到新游戏。
 * 现在改为**每次请求都读仓库内容层的那一个文件**，文件是唯一的真相来源。
 *
 * 目录是玩家可见的公开数据，所以这里做了「可下载性」兜底：
 *   - 只返回 status=published 的条目（draft / unlisted / archived 一律不出现）；
 *   - 只返回**包文件真实存在、且包内 id 与条目 id 一致**的条目。
 * 第二条不是多余的：指向不存在文件的条目会让玩家点了「下载」才失败。
 * 目录宁可少一条，也不要给一个坏链接。
 *
 * 缓存策略：目录是公开只读数据，60 秒 + stale-while-revalidate 让新发布约一分钟内
 * 可见，离线时仍有旧副本可用。
 */

const CATALOG_PATH = path.join(process.cwd(), "content", "cloud", "catalog.json");
const CONTENT_DIR = path.join(process.cwd(), "content");
const SAFE_PACK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

interface CatalogEntry {
  id: string;
  packFile: string;
  status: string;
  [key: string]: unknown;
}

export const dynamic = "force-dynamic";

/** 条目是否真的可下载：状态已发布 + 文件存在 + 包内 id 与条目一致。 */
async function isPlayable(entry: CatalogEntry): Promise<boolean> {
  if (entry.status !== "published") return false;
  if (typeof entry.packFile !== "string") return false;
  if (!SAFE_PACK_FILE.test(entry.packFile) || entry.packFile.includes("..")) return false;
  const file = path.join(CONTENT_DIR, entry.packFile);
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const parsed = JSON.parse(await readFile(file, "utf8")) as { id?: unknown };
    return parsed?.id === entry.id;
  } catch {
    return false;
  }
}

export async function GET() {
  let raw: string;
  try {
    raw = await readFile(CATALOG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json(
        { error: "catalog_not_found", message: "找不到云端游戏目录。" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "catalog_unreadable", message: "服务器无法读取云端游戏目录。" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  let parsed: { version?: unknown; updatedAt?: unknown; games?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 目录损坏时以 422 明确失败，而不是把解析错误抛进游戏中心的 fetch 里。
    return NextResponse.json(
      { error: "catalog_invalid", message: "云端游戏目录不是合法 JSON。" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const entries: CatalogEntry[] = Array.isArray(parsed.games) ? (parsed.games as CatalogEntry[]) : [];
  const playable: CatalogEntry[] = [];
  let hidden = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
    if (!(await isPlayable(entry))) {
      // 只计数、不输出路径细节：目录自检需要知道「有几条被隐藏」，
      // 但没必要把未发布内容的存在暴露成具体条目。
      hidden += 1;
      continue;
    }
    playable.push(entry);
  }

  return NextResponse.json(
    {
      version: typeof parsed.version === "string" ? parsed.version : "1.0",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      games: playable,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        // 自检用：本次因「未发布 / 文件缺失 / id 不一致」被隐藏的条目数量。
        "X-Cloud-Catalog-Hidden": String(hidden),
      },
    },
  );
}
