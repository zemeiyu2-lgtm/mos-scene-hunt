import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readBlobConfig } from "@/lib/cloud/blob-store";
import { readPublishedPackById } from "@/lib/cloud/publish-store";

/**
 * Content pack server.
 *
 * Content packs live in the repo-root `content/` directory, not in `public/`.
 * That is intentional: `content/` is the authoring surface for writers, and
 * duplicating packs into `public/` would create two sources of truth that drift.
 *
 * 2026-10-17 起，包体有两个来源，顺序固定：
 *   1. 仓库内容层 `content/<file>` —— 随构建发布的官方/静态内容（优先）；
 *   2. Vercel Blob 里的当前已发布版本 —— 经发布接口上线的游戏。
 *
 * 这样玩家的下载地址只有一种（`/content/<id>.json`），不必知道某个包到底来自
 * 仓库还是对象存储；Service Worker 的 `/content/*` 缓存规则也不用改。
 *
 * Serving them through a route handler keeps a single authoring location while
 * still exposing a plain, cacheable URL the service worker can intercept - which
 * is what makes the offline requirement in spec section 13 work.
 *
 * Path traversal is blocked by rejecting any id that is not a bare filename:
 * only `[A-Za-z0-9._-]+.json` is accepted, so `..%2F` and absolute paths can
 * never escape the content directory.
 */

const CONTENT_DIR = path.join(process.cwd(), "content");
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

export const dynamic = "force-static";
export const revalidate = 0;

function packResponse(raw: string, source: "repo" | "blob", pub?: { digest: string; publishedAt: string }) {
  return NextResponse.json(JSON.parse(raw), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Short cache: an author editing a pack should see the change on reload,
      // but the service worker still gets a cacheable response for offline use.
      "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
      "X-Content-Source": source,
      ...(pub ? { "X-Content-Digest": pub.digest, "X-Content-Published-At": pub.publishedAt.slice(0, 10) } : {}),
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const name = decodeURIComponent(file);

  if (!SAFE_ID.test(name) || name.includes("..")) {
    return NextResponse.json(
      { error: "invalid_content_id", message: "内容包名称不合法。" },
      { status: 400 },
    );
  }

  try {
    const raw = await readFile(path.join(CONTENT_DIR, name), "utf8");
    // Parse and re-serialise so a malformed pack fails here with a clear 422
    // rather than surfacing as a JSON parse error inside the game.
    return packResponse(raw, "repo");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      // 仓库里没有 → 看是不是经发布接口上线的游戏。
      return await serveFromStore(name);
    }
    if (code) {
      // Filesystem-level failure (permissions, directory, I/O...). This is a
      // server fault, not invalid content: 422 must be reserved for packs
      // that genuinely fail JSON.parse, so failures stay diagnosable.
      return NextResponse.json(
        {
          error: "content_unreadable",
          message: `服务器无法读取内容包「${name}」。`,
          code,
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        error: "content_invalid",
        message: `内容包「${name}」不是合法的 JSON。`,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 422 },
    );
  }
}

/**
 * 从发布存储里取当前已发布版本。
 *
 * 只按 **id → 当前已发布指针** 取，不按任意摘要：玩家能下载的必须是维护者
 * 明确发布过的那一版，草稿与历史版本不对外。
 */
async function serveFromStore(name: string): Promise<NextResponse> {
  const gameId = name.slice(0, -".json".length);
  if (!readBlobConfig().configured) {
    return NextResponse.json(
      { error: "content_not_found", message: `找不到内容包「${name}」。` },
      { status: 404 },
    );
  }
  try {
    const found = await readPublishedPackById(gameId);
    if (!found) {
      return NextResponse.json(
        { error: "content_not_found", message: `找不到内容包「${name}」。` },
        { status: 404 },
      );
    }
    // 包内 id 必须与请求的文件名一致，避免「索引指错版本」时把别的游戏发出去。
    const parsed = JSON.parse(found.text) as { id?: unknown };
    if (parsed?.id !== gameId) {
      return NextResponse.json(
        { error: "content_mismatch", message: `内容包「${name}」与已发布版本不一致。` },
        { status: 500 },
      );
    }
    return packResponse(found.text, "blob", {
      digest: found.pointer.digest,
      publishedAt: found.pointer.publishedAt,
    });
  } catch (err) {
    const errorName = (err as { name?: string } | null)?.name ?? "";
    const errorKind = (err as { kind?: unknown } | null)?.kind;
    // 索引损坏时无法判断「当前已发布的是哪一版」，宁可明确报错也不猜一个版本发出去。
    if ((errorName === "BlobStoreError" || errorName === "BlobBackendError") && errorKind === "corrupt") {
      return NextResponse.json(
        {
          error: "index_corrupt",
          message: "云端已发布索引损坏，暂时无法确定该游戏当前发布的版本，请联系维护者。",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        error: "content_unreadable",
        message: `服务器无法从存储读取内容包「${name}」。`,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}

/** List available packs, for the hunt-select screen to discover content. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: "GET, OPTIONS" },
  });
}
