import { NO_STORE, jsonResponse, toErrorResponse } from "@/lib/auth/guard";
import { getPublicCity } from "@/lib/cities/service";
import { listCityPackages } from "@/lib/cities/link";

/**
 * One city: profile + the published packs listed under it.
 *
 * GET /api/cities/<cityId>
 *
 * A merged id answers with the survivor's profile and `redirected: true` — old
 * ids keep working forever, which is what makes merging safe.
 *
 * The pack list is re-validated against the work documents on every read, so a
 * stale index entry can never surface an unlisted or withdrawn pack.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cityId: string }> },
): Promise<Response> {
  try {
    const { cityId: raw } = await params;
    const cityId = decodeURIComponent(raw ?? "");
    const detail = await getPublicCity(cityId);
    if (!detail) {
      return jsonResponse(404, { error: "city_not_found", message: "城市档案不存在。" }, { "Cache-Control": NO_STORE });
    }
    const packages = await listCityPackages(detail.city.cityId);
    /*
     * R2: a city with no publicly readable pack is NOT a public page. Answering
     * 200 with an empty list would advertise "this city exists but has nothing
     * you can play" — a dead end for a stranger and an information leak about
     * other authors' unpublished work. 404 keeps the public surface equal to
     * "something you can actually open".
     *
     * Authors and admins never depend on this route for their own drafts: they
     * read A8 (`/api/works/<gameId>/city`) or the picker scope, both of which
     * are authenticated and permission-scoped.
     */
    if (packages.length === 0) {
      return jsonResponse(
        404,
        { error: "city_not_public", message: "这座城市还没有公开的探索包。" },
        { "Cache-Control": NO_STORE },
      );
    }
    return jsonResponse(
      200,
      {
        city: { ...detail.city, gameCount: packages.length },
        packages,
        requestedCityId: detail.requestedCityId,
        redirected: detail.redirected,
      },
      { "Cache-Control": NO_STORE },
    );
  } catch (error) {
    return toErrorResponse(error, "cities:detail");
  }
}
