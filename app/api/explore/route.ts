import { NextResponse } from "next/server";
import { categoryCounts, listPublicExplorePacks } from "@/lib/explore/service";

/**
 * Public exploration catalogue.
 *
 * Same publication gate as the rest of the app: it is built from catalogue
 * entries whose status is exactly `published`, and the pack bytes come from the
 * same content route `/games` downloads from. Nothing else is readable.
 *
 * The response is deliberately one payload (packs + real category counts)
 * because both pages need both, and a count that disagrees with the list it sits
 * next to is worse than one extra kilobyte.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const packs = await listPublicExplorePacks();
    return NextResponse.json(
      { packs, categories: categoryCounts(packs) },
      {
        headers: {
          // Same bounded staleness as the cloud catalogue: a publish becomes
          // visible within half a minute without re-reading files on every view.
          "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    console.error("[explore] 读取公开探索包失败", error);
    return NextResponse.json(
      { error: "explore_unavailable", message: "暂时无法读取探索内容，请稍后重试。" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
