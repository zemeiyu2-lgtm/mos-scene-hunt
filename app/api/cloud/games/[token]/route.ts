import { NextResponse } from "next/server";
import { readPublishSecret, sha256Hex, verifyPublishToken } from "@/lib/cloud/publish-server";
import { readPublishedPack } from "@/lib/cloud/blob-store";
import { readPublishedIndex } from "@/lib/cloud/publish-store";

/**
 * GET /api/cloud/games/[token] - 以发布令牌取回**已被批准的那一版**游戏包。
 *
 * 包体来自 Vercel Blob（按摘要寻址），与玩家目录读的是同一个 store。
 *
 * 为什么用令牌而不是 `?id=xxx`：
 *   - 令牌是 HMAC 签名的，客户端无法伪造/篡改；
 *   - 令牌只携带摘要，真正的包体由服务端按摘要从自己的存储读取，因此「令牌里写的
 *     是什么」和「返回的包是什么」不可能不一致；
 *   - 令牌有过期时间，泄露的影响面是有界的。
 *
 * 失败语义刻意区分清楚（客户端要据此提示用户，而不是笼统说「失败」）：
 *   400 令牌格式不对 · 401 签名无效 · 410 令牌过期 · 404 包体不存在 · 500 通道未配置
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOWNLOAD_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  // 包体不可变（按内容摘要寻址），可以长期缓存；凭据本身不应进共享缓存。
  "Cache-Control": "private, max-age=86400",
  "X-Content-Type-Options": "nosniff",
} as const;

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const secret = readPublishSecret();

  const verified = verifyPublishToken(decodeURIComponent(token), secret);
  if (!verified.ok) {
    return errorResponse(verified.status, "invalid_token", verified.error);
  }

  let text: string | null;
  try {
    // A valid submission token is not itself approval. Only the exact digest
    // currently present in the published index can be downloaded through this route.
    const index = await readPublishedIndex();
    if (index.games[verified.payload.gameId]?.digest !== verified.payload.digest) {
      return errorResponse(404, "not_published", "这一版尚未通过审核发布，或已被新版本替代。");
    }
    text = await readPublishedPack(verified.payload.gameId, verified.payload.digest);
  } catch (err) {
    return errorResponse(500, "store_unreadable", "服务端无法读取发布存储：" + (err instanceof Error ? err.message : String(err)));
  }
  if (text === null) {
    return errorResponse(
      404,
      "package_not_found",
      "找不到这个发布凭据对应的游戏包。它可能从未成功写入存储，或已被清理。",
    );
  }

  // 二次校验摘要：防止存储被篡改后「令牌有效但内容被换掉」。
  if (sha256Hex(text) !== verified.payload.digest) {
    return errorResponse(500, "digest_mismatch", "存储的游戏包与凭据摘要不一致，已拒绝返回。");
  }

  return new NextResponse(text, {
    status: 200,
    headers: { ...DOWNLOAD_HEADERS, "X-Publish-Game-Id": verified.payload.gameId },
  });
}
