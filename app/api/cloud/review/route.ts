import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  readDrafts,
  readPublishedPack,
} from "@/lib/cloud/blob-store";
import { readPublishSecret, sha256Hex } from "@/lib/cloud/publish-server";
import { readPublishedIndex, writePublishedGame } from "@/lib/cloud/publish-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** 审核密钥独立于投稿密钥；未配置时审核接口整体关闭。 */
function authorized(request: Request): boolean {
  const expected = (process.env.MOS_CLOUD_REVIEW_KEY ?? "").trim();
  if (expected.length < 32) return false;
  const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reviewEnabled(): boolean {
  return (process.env.MOS_CLOUD_REVIEW_KEY ?? "").trim().length >= 32;
}

/**
 * GET /api/cloud/review — 受保护的待审核清单。
 * POST /api/cloud/review — { id, digest, decision: "approve" }。
 *
 * 审核必须明确指定 digest，避免审核期间新版本覆盖旧版本造成误批。
 * 当前只实现批准；拒绝/退回功能将在有明确状态审计记录后再加，不能假装完成。
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return json({ error: "unauthorized", message: "审核凭据无效或服务端未配置独立审核密钥。" }, 401);
  }

  try {
    const [drafts, index] = await Promise.all([readDrafts(), readPublishedIndex()]);
    const games = drafts.games.filter((draft) => index.games[draft.id]?.digest !== draft.digest);
    return json({ ok: true, updatedAt: drafts.updatedAt, games });
  } catch {
    return json({ error: "review_store_unavailable", message: "无法读取审核队列；未更改任何数据。" }, 503);
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return json({ error: "unauthorized", message: "审核凭据无效或服务端未配置独立审核密钥。" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", message: "请求必须是 JSON。" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "bad_request", message: "请求内容格式不正确。" }, 400);
  }

  const input = body as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const digest = typeof input.digest === "string" ? input.digest.trim() : "";
  if (input.decision !== "approve" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || !/^[0-9a-f]{64}$/.test(digest)) {
    return json({ error: "bad_request", message: "必须提供合法 id、64 位 digest，并将 decision 设为 approve。" }, 400);
  }

  try {
    const [drafts, index] = await Promise.all([readDrafts(), readPublishedIndex()]);
    const draft = drafts.games.find((entry) => entry.id === id && entry.digest === digest);
    if (!draft) {
      return json({ error: "submission_not_found", message: "审核队列中找不到这一版；请刷新清单，不会自动批准其它版本。" }, 404);
    }
    if (index.games[id]?.digest === digest) {
      return json({ ok: true, status: "published", message: "这一版已经发布，无需重复审核。" });
    }

    const text = await readPublishedPack(id, digest);
    if (text === null || sha256Hex(text) !== digest) {
      return json({ error: "package_integrity_error", message: "包体不存在或摘要不匹配，已拒绝批准。" }, 409);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      return json({ error: "package_invalid", message: "包体不是合法 JSON，已拒绝批准。" }, 409);
    }
    if (!parsed || typeof parsed !== "object" || (parsed as { id?: unknown }).id !== id) {
      return json({ error: "package_identity_error", message: "包体内游戏 id 与申请不一致，已拒绝批准。" }, 409);
    }

    const secret = readPublishSecret();
    if (!secret) {
      return json({ error: "publish_disabled", message: "发布签名密钥未配置；审核结果未写入玩家目录。" }, 503);
    }

    const result = await writePublishedGame({
      gameId: id,
      digest,
      body: text,
      title: draft.title,
      sceneCount: draft.sceneCount,
      warningCount: 0,
      draft: draft as unknown as Record<string, unknown> & { id: string; digest: string },
      publishNow: true,
    });

    return json({
      ok: true,
      status: result.catalogStatus,
      game: { id, title: draft.title, digest, publishedAt: result.pointer.publishedAt },
      message: "审核通过：这一版已写入已发布索引。玩家目录仍需读取服务端云端目录才能显示此游戏。",
    }, 200);
  } catch {
    return json({ error: "review_publish_failed", message: "审核发布写入失败；既有已发布索引应保持不变，请检查存储后重试。" }, 503);
  }
}
