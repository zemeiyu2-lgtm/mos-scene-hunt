import {
  HttpError,
  jsonResponse,
  requireUser,
  toErrorResponse,
} from "@/lib/auth/guard";
import { getRegistry } from "@/lib/registry/store";
import { getStore } from "@/lib/publish/storage";
import { isValidGameId, isValidVersionId } from "@/lib/publish/version";

/**
 * Private preview of one version.
 *
 * GET /api/admin/preview/<gameId>/<versionId>
 *
 * Who may read: the work's owner, or any reviewer/admin. Everyone else gets
 * 404 (not 403) so the route cannot be used to confirm that a game id exists.
 * This is the only way to play an unreviewed version — the public read path
 * refuses it outright.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string; versionId: string }> },
): Promise<Response> {
  try {
    const { gameId: rawId, versionId: rawVersion } = await params;
    const gameId = decodeURIComponent(rawId);
    const versionId = decodeURIComponent(rawVersion);
    if (!isValidGameId(gameId) || !isValidVersionId(versionId)) {
      throw new HttpError(400, "invalid_id", "游戏 id 或版本号不合法。");
    }

    const auth = await requireUser(request);
    const registry = getRegistry();
    const work = await registry.getWork(gameId);
    if (!work) {
      throw new HttpError(404, "work_not_found", "作品不存在。");
    }

    const isOwner = work.ownerUserId === auth.user.id;
    const isStaff = auth.user.role === "reviewer" || auth.user.role === "admin";
    if (!isOwner && !isStaff) {
      // Same shape as a missing work: ownership must not be probeable.
      throw new HttpError(404, "work_not_found", "作品不存在。");
    }

    const version = work.versions.find((v) => v.versionId === versionId);
    if (!version) {
      throw new HttpError(404, "version_not_found", "该版本不存在。");
    }

    const pack = await getStore().readVersion(gameId, versionId);
    if (pack === null) {
      throw new HttpError(404, "version_not_found", "该版本的字节不存在。");
    }

    return new Response(pack, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Never cacheable: a preview may show unreviewed content.
        "Cache-Control": "no-store, private",
        "X-Game-Version": versionId,
      },
    });
  } catch (error) {
    return toErrorResponse(error, "admin-preview");
  }
}
