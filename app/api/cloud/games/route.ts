import { NextResponse } from "next/server";
import { readBlobConfig, readDrafts, upsertDraft, type DraftEntry } from "@/lib/cloud/blob-store";
import {
  MAX_REQUEST_BYTES,
  classifyDuplicate,
  directPublishEnabled,
  extractGamePayload,
  issuePublishToken,
  readLimitedBody,
  readPublishSecret,
  validateSubmission,
  verifyPublisherAuth,
} from "@/lib/cloud/publish-server";
import {
  readPublishedIndex,
  readRepoCatalog,
  writePublishedGame,
  type IndexSnapshot,
} from "@/lib/cloud/publish-store";

/**
 * POST /api/cloud/games - 提交一个游戏包到云端发布通道（持久化到 Vercel Blob）。
 *
 * 处理顺序（每一步失败都直接返回，不写任何东西）：
 *   1. 鉴权          —— 未配置密钥 503，密钥错误 403，未带密钥 401
 *   2. 存储可用性    —— Blob 未接入 503（失败关闭，绝不写临时盘伪装成功）
 *   3. 体积限制      —— 413
 *   4. JSON 解析     —— 400
 *   5. 游戏包校验    —— 422（复用 lib/game/package 的同一套规则）
 *   6. 重复发布判定  —— 409（同 id 已属于另一个包文件）
 *   7. 写包体 + 元数据 + 草稿目录（可选：发布到玩家目录）
 *   8. 签发短时 HMAC 令牌，返回获取入口
 *
 * 返回 202 而不是 201：内容是「已接受」，玩家是否马上看得见取决于发布模式。
 * 响应里的 catalogStatus 会如实说明 draft 还是 published，不给虚假的成功感。
 */

// 这个路由必须始终动态执行：它读写远端存储、验签、依赖请求头。
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

/**
 * 错误是不是「索引损坏」。
 *
 * 结构化判定（name + kind），不用 `instanceof`：错误类在打包后可能有多个副本。
 * 损坏与瞬时不可用必须给出不同的信号——前者重试永远不会成功，而且重试本身
 * 就是在冒险覆盖数据。
 */
function isCorruptIndexError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  const kind = (error as { kind?: unknown } | null)?.kind;
  return (name === "BlobStoreError" || name === "BlobBackendError") && kind === "corrupt";
}

/** 请求是否要求把这一版直接放进玩家目录。 */function wantsPublishNow(request: Request, rawBody: unknown): boolean {
  const url = new URL(request.url);
  const flag = url.searchParams.get("publish");
  if (flag === "1" || flag === "true") return true;
  if (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) {
    const value = (rawBody as Record<string, unknown>).publish;
    if (value === true || value === "1") return true;
  }
  return false;
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
  // 存储未接入：明确失败。绝不能退化成「写本地临时文件然后返回成功」——
  // 那会让发布者以为内容已上线，实际下一个请求就消失。
  const blob = readBlobConfig();
  if (!blob.configured) {
    return json({ error: "storage_unavailable", message: blob.reason }, 503);
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

  // 仓库内容层是随构建发布的官方目录，用来判断「是否顶掉别人的 id」。
  // 读不到就说明部署有问题：宁可失败，也不要在不确定的情况下覆盖。
  const repo = await readRepoCatalog();
  if (repo.error) {
    return json({ error: "catalog_unavailable", message: repo.error }, 500);
  }

  // 已发布索引：判断同一 id 当前指向哪个包，以及本次内容是否与上一版一致。
  let index: IndexSnapshot;
  try {
    index = await readPublishedIndex();
  } catch (error) {
    // 索引损坏不是「暂时读不到」：它是数据坏了，任何写入都会把其它已发布游戏
    // 从目录里抹掉。这里明确区分，并给出可执行的处置说明（不改、不删、不重试）。
    if (isCorruptIndexError(error)) {
      return json(
        {
          error: "index_corrupt",
          message:
            "云端已发布索引损坏，为避免覆盖其它已发布游戏，本次发布已停止。" +
            "包体与既有 Blob 数据均未被修改；需要维护者人工修复 scene-hunt/indexes/games.json 后重试。",
        },
        500,
      );
    }
    return json(
      { error: "storage_unavailable", message: "无法读取发布索引：" + (error instanceof Error ? error.message : String(error)) },
      503,
    );
  }

  const previousPointer = index.games[accepted.game.id];
  // 目录冲突判定要同时看「仓库里的条目」和「已发布索引里的条目」：
  // 同一个 store 里，一个 id 只能有一个当前包文件。
  const combined = [
    ...repo.entries
      .filter((entry) => typeof entry?.id === "string" && typeof entry?.packFile === "string")
      .map((entry) => ({
        ...entry,
        title: typeof entry.title === "string" ? entry.title : entry.id,
        status: typeof entry.status === "string" ? entry.status : "published",
      })),
    { id: accepted.game.id, packFile: accepted.packFile, title: accepted.game.title, status: "published" },
  ];
  const verdict = classifyDuplicate(accepted.game.id, accepted.packFile, combined);
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

  const publishAllowed = directPublishEnabled();
  const publishNow = publishAllowed && wantsPublishNow(request, extracted.raw);

  const draft: DraftEntry = {
    id: accepted.catalogEntry.id,
    title: accepted.catalogEntry.title,
    author: accepted.catalogEntry.author,
    description: accepted.catalogEntry.description,
    language: accepted.catalogEntry.language,
    ...(accepted.catalogEntry.estimatedMinutes ? { estimatedMinutes: accepted.catalogEntry.estimatedMinutes } : {}),
    ...(accepted.catalogEntry.difficulty ? { difficulty: accepted.catalogEntry.difficulty } : {}),
    sceneCount: accepted.catalogEntry.sceneCount,
    status: "draft",
    packFile: accepted.packFile,
    digest: accepted.digest,
    receivedAt: new Date().toISOString(),
  };

  let written;
  try {
    written = await writePublishedGame({
      gameId: accepted.game.id,
      digest: accepted.digest,
      body: accepted.canonicalJson,
      title: accepted.game.title,
      sceneCount: accepted.game.scenes.length,
      warningCount: accepted.warnings.length,
      draft: draft as unknown as Record<string, unknown> & { id: string; digest: string },
      publishNow,
    });
    // 草稿目录最后写：它只是给维护者看的清单，写失败不应让整个发布失败。
    await upsertDraft(draft).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCorruptIndexError(error)) {
      // 包体/元数据可能已经写进去了，但索引（玩家唯一可见的状态）没动，
      // 所以既有游戏仍然可下载，只是「本次发布未生效」。
      return json(
        {
          error: "index_corrupt",
          message:
            "云端已发布索引损坏，为避免覆盖其它已发布游戏，本次未更新目录（既有游戏不受影响）。" +
            "需要维护者人工修复 scene-hunt/indexes/games.json 后重试。" + message,
        },
        500,
      );
    }
    // 失败的写入不会改变已发布索引（索引是最后一步），所以既有游戏仍然可下载。
    return json(
      { error: "storage_write_failed", message: "写入云端存储失败，本次发布未生效：" + message },
      503,
    );
  }

  // 「内容未变」要按这一版**自己的**归属判断，不能只看已发布索引：
  //   - 已直接发布：索引里当前指针就是同一摘要 → 线上版本没变；
  //   - 只是草稿：索引里本来就没有它，但存储里已经有这份包体 → 重复提交，同一个凭据。
  // 否则同一份草稿提交两次会被说成「产生了新版本」，是误导。
  const unchanged = publishNow
    ? previousPointer?.digest === accepted.digest
    : !written.created || previousPointer?.digest === accepted.digest;
  const token = issuePublishToken(accepted, secret);

  const message = publishNow
    ? unchanged
      ? "这一版内容与当前线上版本完全一致，未产生新版本。"
      : "游戏包已发布，玩家现在可以在游戏中心的云端游戏里找到它。"
    : unchanged
      ? "这一版内容与上一次提交完全一致，已返回同一个发布凭据（当前仍为草稿）。"
      : "游戏包已通过校验并存进云端存储，当前为草稿：玩家还看不到，需要维护者发布后才会上线。";

  return json(
    {
      ok: true,
      status: "accepted",
      message,
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
      catalogStatus: written.catalogStatus,
      store: {
        // 本机联调的内存后端必须如实标注，不能冒充 vercel-blob。
        backend: blob.ephemeral ? "memory-ephemeral" : "vercel-blob",
        created: written.created,
        receivedAt: written.pointer.receivedAt,
        publishedAt: written.catalogStatus === "published" ? written.pointer.publishedAt : null,
        draftCount: (await readDrafts().catch(() => ({ games: [] }))).games.length,
      },
      directPublishEnabled: publishAllowed,
      token,
      // 令牌本身即获取凭据；客户端只需拼到本站路径下。
      retrievalPath: `/api/cloud/games/${encodeURIComponent(token)}`,
      nextStep: publishNow
        ? "玩家已可通过手机游戏中心发现并下载这一版。"
        : publishAllowed
          ? "如需立即上线，请在请求里加 ?publish=1（或请求体 publish: true）重新发布。"
          : "服务端未开启直接发布：本次只进草稿。维护者确认后把 MOS_CLOUD_ALLOW_DIRECT_PUBLISH 设为 1 并重新发布即可上线。",
    },
    202,
    { "X-Publish-Digest": accepted.digest },
  );
}

/** GET 仅用于让浏览器/维护者确认接口存在，不泄露任何状态。 */
export async function GET() {
  const enabled = Boolean(readPublishSecret() && (process.env.MOS_CLOUD_PUBLISH_KEY ?? "").trim().length >= 16);
  const blob = readBlobConfig();
  const backend = blob.configured ? (blob.ephemeral ? "memory-ephemeral" : "vercel-blob") : "unavailable";
  return json(
    {
      endpoint: "/api/cloud/games",
      method: "POST",
      enabled: enabled && blob.configured,
      storage: backend,
      directPublishEnabled: directPublishEnabled(),
      message: !blob.configured
        ? blob.reason
        : blob.ephemeral
          ? "发布通道已开通，但当前使用进程内存后端（仅本机联调）：数据不持久化，重启即丢失，不能用于正式发布。"
          : enabled
            ? "发布通道已开通。请以 POST 提交游戏包，并携带 Authorization: Bearer <发布密钥>。"
            : "发布通道未开通（服务端缺少 MOS_CLOUD_PUBLISH_KEY / MOS_CLOUD_PUBLISH_SECRET）。",
    },
    200,
  );
}
