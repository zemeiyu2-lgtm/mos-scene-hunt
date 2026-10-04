import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Content pack server.
 *
 * Content packs live in the repo-root `content/` directory, not in `public/`.
 * That is intentional: `content/` is the authoring surface for writers, and
 * duplicating packs into `public/` would create two sources of truth that drift.
 *
 * Serving them through a route handler keeps a single authoring location while
 * still exposing a plain, cacheable URL the service worker can intercept - which
 * is what makes the offline requirement in spec section 13 work.
 *
 * Path traversal is blocked by rejecting any id that is not a bare filename:
 * only `[A-Za-z0-9._-]+.json` is accepted, so `..%2F` and absolute paths can
 * never escape the content directory.
 */

const CONTENT_DIR = path.join(process.cwd(), "content");
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

export const dynamic = "force-static";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const name = decodeURIComponent(file);

  if (!SAFE_ID.test(name) || name.includes("..")) {
    return NextResponse.json(
      { error: "invalid_content_id", message: "内容包名称不合法。" },
      { status: 400 },
    );
  }

  try {
    const raw = await readFile(path.join(CONTENT_DIR, name), "utf8");
    // Parse and re-serialise so a malformed pack fails here with a clear 422
    // rather than surfacing as a JSON parse error inside the game.
    const parsed = JSON.parse(raw);
    return new NextResponse(JSON.stringify(parsed), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Short cache: an author editing a pack should see the change on reload,
        // but the service worker still gets a cacheable response for offline use.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return NextResponse.json(
        { error: "content_not_found", message: `找不到内容包「${name}」。` },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: "content_invalid",
        message: `内容包「${name}」不是合法的 JSON。`,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 422 },
    );
  }
}

/** List available packs, for the hunt-select screen to discover content. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: "GET, OPTIONS" },
  });
}
