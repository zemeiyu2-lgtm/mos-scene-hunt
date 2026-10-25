import { isValidGameId, isValidVersionId } from "@/lib/publish/version";
import { getStore } from "@/lib/publish/storage";

/**
 * Public read endpoint for published game versions.
 *
 * GET /api/games/<gameId>          -> latest published version
 * GET /api/games/<gameId>?v=<id>   -> one immutable version
 *
 * A missing game or version is a clean 404 (never a silent fallback). A
 * specific `?v=` response is content-addressed and cacheable forever;
 * the "latest" response uses a short cache so a new publish propagates.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId: rawId } = await params;
  const gameId = decodeURIComponent(rawId);
  if (!isValidGameId(gameId)) {
    return json(400, { error: "invalid_game_id", message: "游戏 id 不合法。" });
  }

  const versionParam = new URL(request.url).searchParams.get("v");
  if (versionParam !== null && !isValidVersionId(versionParam)) {
    return json(400, { error: "invalid_version_id", message: "版本号格式不合法。" });
  }

  const store = getStore();
  try {
    let versionId = versionParam;
    let immutable = true;
    if (!versionId) {
      const meta = await store.readMeta(gameId);
      if (!meta) {
        return json(404, { error: "game_not_found", message: "该游戏尚未发布或已下架。" });
      }
      versionId = meta.latestVersionId;
      immutable = false;
    }

    const pack = await store.readVersion(gameId, versionId);
    if (pack === null) {
      return json(404, {
        error: "version_not_found",
        message: "该版本不存在，请向分享者确认链接是否完整。",
      });
    }

    return new Response(pack, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": immutable
          ? "public, max-age=31536000, immutable"
          : "public, max-age=60, stale-while-revalidate=600",
        "X-Game-Version": versionId,
      },
    });
  } catch (error) {
    return json(500, {
      error: "read_failed",
      message: "读取已发布游戏失败，请稍后重试。",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
