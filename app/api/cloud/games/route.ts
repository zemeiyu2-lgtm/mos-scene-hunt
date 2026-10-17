import { NextResponse } from "next/server";
import {
  MAX_REQUEST_BYTES,
  classifyDuplicate,
  extractGamePayload,
  issuePublishToken,
  readLimitedBody,
  readPublishSecret,
  validateSubmission,
  verifyPublisherAuth,
} from "@/lib/cloud/publish-server";
import {
  findStoredDigestForGame,
  readLiveCatalog,
  storeAcceptedPackage,
  upsertCatalogDraft,
} from "@/lib/cloud/publish-store";

/**
 * POST /api/cloud/games - 提交一个游戏包到云端发布通道。
 *
 * 处理顺序（每一步失败都直接返回，不写任何东西）：
 *   1. 方法/鉴权     —— 未配置密钥 503，密钥错误 403，未带密钥 401
 *   2. 体积限制      —— 413
 *   3. JSON 解析     —— 400
 *   4. 游戏包校验    —— 422（复用了 lib/game/package 的同一套规则）
 *   5. 重复发布判定  —— 409（同 id 已属于另一个包文件）
 *   6. 存储 + 目录草稿（draft，永不自动 published）
 *   7. 签发短时 HMAC 令牌，返回获取入口
 *
 * 返回 202 Accepted 而不是 201：这一步只是「接收并批准了包体」，游戏**还不会**
 * 出现在玩家可见的云端目录里——那需要维护者把包落进 content/ 并部署。
 * 把这一点在响应里说清楚，比给一个虚假的「发布成功」重要。
 */

// 这个路由必须始终动态执行：它读写服务端文件、验签、依赖请求头。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      // 发布会话不允许被任何中间层缓存。
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function POST(request: Request) {
  const secret = readPublishSecret();
  const auth = verifyPublisherAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return json({ error: "unauthorized", message: auth.error }, auth.status);
  }
  // 鉴权通过但签名密钥缺失：同样失败关闭，不发不可验证的令牌。
  if (!secret) {
    return json(
      { error: "publish_disabled", message: "发布通道未开通：服务端未配置 MOS_CLOUD_PUBLISH_SECRET（至少 32 位）。" },
      503,
    );
  }

  const body = await readLimitedBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) {
    return json({ error: body.status === 413 ? "payload_too_large" : "bad_request", message: body.error }, body.status);
  }

  const extracted = extractGamePayload(body.text);
  if (!extracted.ok) {
    return json({ error: "invalid_json", message: extracted.error }, 400);
  }

  const outcome = validateSubmission(extracted.raw);
  if (!outcome.ok) {
    return json(
      {
        error: "invalid_package",
        message: outcome.error,
        issues: outcome.issues.slice(0, 25),
        issueCount: outcome.issues.length,
      },
      outcome.status,
    );
  }

  const { accepted } = outcome;

  const live = await readLiveCatalog();
  if (live.error) {
    // 目录读不出来就无法安全判断「是否顶掉别人的 id」，宁可失败也不猜。
    return json({ error: "catalog_unavailable", message: live.error }, 500);
  }
  const verdict = classifyDuplicate(accepted.game.id, accepted.packFile, live.entries);
  if (verdict.kind === "id-taken") {
    return json(
      {
        error: "id_conflict",
        message:
          `游戏 id「${accepted.game.id}」已属于云端目录中的另一个游戏包（${verdict.entry.packFile}）。` +
          "请在设计器中换一个 id 后重新发布。",
        conflict: { id: verdict.entry.id, packFile: verdict.entry.packFile, title: verdict.entry.title },
      },
      409,
    );
  }

  const previousDigest = await findStoredDigestForGame(accepted.game.id);
  const stored = await storeAcceptedPackage(accepted);
  const draft = await upsertCatalogDraft(accepted.catalogEntry);
  const token = issuePublishToken(accepted, secret);

  const unchanged = previousDigest === accepted.digest;
  return json(
    {
      ok: true,
      status: "accepted",
      message: unchanged
        ? "这一版内容与上一次提交完全一致，已返回同一个发布凭据。"
        : "游戏包已通过校验并进入待发布队列。它现在还不会出现在玩家的游戏中心，需要维护者确认后落库。",
      game: {
        id: accepted.game.id,
        title: accepted.game.title,
        version: accepted.game.version,
        sceneCount: accepted.game.scenes.length,
        packFile: accepted.packFile,
      },
      digest: accepted.digest,
      duplicate: verdict.kind,
      unchanged,
      warnings: accepted.warnings.slice(0, 25),
      warningCount: accepted.warnings.length,
      catalogEntry: accepted.catalogEntry,
      catalogStatus: "draft",
      store: { created: stored.created, receivedAt: stored.meta.receivedAt, draftCount: draft.entries.length },
      token,
      // 令牌本身即获取凭据；客户端只需拼到本站路径下。
      retrievalPath: `/api/cloud/games/${encodeURIComponent(token)}`,
      nextStep:
        "维护者在仓库根目录运行 `npm run cloud:publish -- <retrievalPath 或完整 URL>`，" +
        "把包落到 content/ 并把目录条目状态改为 published，然后提交到功能分支/PR。",
    },
    202,
    { "X-Publish-Digest": accepted.digest },
  );
}

/** GET 仅用于让浏览器/维护者确认接口存在，不泄露任何状态。 */
export async function GET() {
  const enabled = Boolean(readPublishSecret() && (process.env.MOS_CLOUD_PUBLISH_KEY ?? "").trim().length >= 16);
  return json(
    {
      endpoint: "/api/cloud/games",
      method: "POST",
      enabled,
      message: enabled
        ? "发布通道已开通。请以 POST 提交游戏包，并携带 Authorization: Bearer <发布密钥>。"
        : "发布通道未开通（服务端缺少 MOS_CLOUD_PUBLISH_KEY / MOS_CLOUD_PUBLISH_SECRET）。",
    },
    200,
  );
}
