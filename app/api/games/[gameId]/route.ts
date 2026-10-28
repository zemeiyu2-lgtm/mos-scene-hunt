import { isValidGameId, isValidVersionId } from "@/lib/publish/version";
import { getStore } from "@/lib/publish/storage";
import { getRegistry } from "@/lib/registry/store";
import { isPubliclyReadable } from "@/lib/registry/types";

/**
 * Public read endpoint for published game versions.
 *
 * GET /api/games/<gameId>          -> the currently PUBLISHED version
 * GET /api/games/<gameId>?v=<id>   -> one immutable historical version
 *
 * The read gate now consults the registry, not the storage layer:
 *
 *  - a work that is not `published`/`unlisted` is 404 with the same body as a
 *    work that does not exist, so the endpoint cannot be used to probe which
 *    ids are taken;
 *  - `?v=` only serves versions whose review outcome was `approved` (or that
 *    were published and later superseded). A `pending` or `rejected` version
 *    is unreachable even if its bytes are on disk — this is what makes
 *    "submit ≠ publish" true rather than a UI convention;
 *  - historical `?v=` links keep working after a newer version is published,
 *    because QR codes already in the wild cannot be recalled.
 *
 * Deployment note: this route no longer falls back to `<store>/<id>/meta.json`.
 * Legacy works must be imported into the registry by
 * `scripts/migrate-legacy.mjs` before this route is deployed, otherwise they
 * read as 404. That ordering is deliberate: a fallback would serve unreviewed
 * legacy objects and reopen the exact hole this change closes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Indistinguishable from "no such game" on purpose. */
function notPublished(): Response {
  return json(404, { error: "game_not_found", message: "该游戏尚未发布或已下架。" });
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

  try {
    const registry = getRegistry();
    const work = await registry.getWork(gameId);
    if (!work || !isPubliclyReadable(work.state) || !work.publishedVersionId) {
      return notPublished();
    }

    let versionId: string;
    let immutable: boolean;
    if (versionParam) {
      const record = work.versions.find((v) => v.versionId === versionParam);
      if (!record || (record.status !== "approved" && record.status !== "superseded")) {
        // Unreviewed or rejected content must look identical to a missing one.
        return json(404, {
          error: "version_not_found",
          message: "该版本不存在，请向分享者确认链接是否完整。",
        });
      }
      versionId = versionParam;
      immutable = true;
    } else {
      versionId = work.publishedVersionId;
      immutable = false;
    }

    const pack = await getStore().readVersion(gameId, versionId);
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
          : // Bounded staleness: a publish must become visible within a minute,
            // while read bursts still get absorbed.
            "public, max-age=10, stale-while-revalidate=30",
        "X-Game-Version": versionId,
      },
    });
  } catch (error) {
    // Never echo raw error text: storage messages can contain host internals.
    console.error("[games] 读取失败", error);
    return json(500, { error: "read_failed", message: "读取已发布游戏失败，请稍后重试。" });
  }
}
