import { isValidGameId } from "@/lib/publish/version";
import { getPublicExplorePack } from "@/lib/explore/service";

/**
 * One publicly readable exploration pack, shaped for the detail page.
 *
 * A draft, an unlisted work, an archived work, a pack that is not in the
 * catalogue at all, and a catalogue entry whose file is missing all answer the
 * same 404 with the same body — the endpoint must not become a way to probe
 * which ids exist.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache },
  });
}

const NOT_FOUND = { error: "pack_not_found", message: "该探索包尚未公开或已下架。" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId: rawId } = await params;
  const gameId = decodeURIComponent(rawId ?? "");

  if (!isValidGameId(gameId)) {
    // A malformed id is a client error, exactly as in `/api/games/<id>`; it says
    // nothing about whether any pack with a similar name exists.
    return json(400, { error: "invalid_game_id", message: "探索包 id 不合法。" });
  }

  try {
    const pack = await getPublicExplorePack(gameId);
    if (!pack) {
      return json(404, NOT_FOUND);
    }
    return json(200, { pack }, "public, max-age=30, stale-while-revalidate=120");
  } catch (error) {
    console.error("[explore] 读取探索包失败", error);
    return json(503, { error: "explore_unavailable", message: "暂时无法读取该探索包，请稍后重试。" });
  }
}
