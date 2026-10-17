import { NextResponse } from "next/server";
import { readDrafts } from "@/lib/cloud/blob-store";
import { indexToCatalogEntries, readPublishedIndex, readRepoCatalog, repoPackUsable, blobPackUsable } from "@/lib/cloud/publish-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public player catalog. Only approved/published entries are returned.
 * Static first-party games remain available; Blob submissions are included only
 * when their published index points at an intact package.
 */
export async function GET() {
  try {
    const [repo, index, drafts] = await Promise.all([
      readRepoCatalog(),
      readPublishedIndex(),
      readDrafts(),
    ]);
    if (repo.error) {
      return NextResponse.json({ error: "catalog_unavailable", message: repo.error }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    const staticGames = await Promise.all(repo.entries
      .filter((entry) => entry.status === "published")
      .map(async (entry) => ({ entry, usable: await repoPackUsable(entry) })));
    const official = staticGames.filter((item) => item.usable).map((item) => item.entry);
    const submitted = indexToCatalogEntries(index, drafts.games)
      .filter((entry) => entry.status === "published");
    const cloudGames = await Promise.all(submitted.map(async (entry) => ({
      entry,
      usable: await blobPackUsable(entry),
    })));
    const merged = new Map<string, unknown>();
    for (const entry of official) merged.set(entry.id, entry);
    for (const item of cloudGames) {
      if (item.usable) merged.set(item.entry.id, item.entry);
    }

    return NextResponse.json({
      version: "1.0",
      updatedAt: index.updatedAt || new Date().toISOString(),
      games: Array.from(merged.values()),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Never turn a storage failure into an empty successful catalog.
    return NextResponse.json({ error: "catalog_unavailable", message: "云端目录暂时不可用，请稍后重试。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
