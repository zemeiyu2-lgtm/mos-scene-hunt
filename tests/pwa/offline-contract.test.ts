import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../../public/manifest.webmanifest", import.meta.url), "utf8"),
) as {
  start_url: string;
  scope: string;
  display: string;
  icons: Array<{ src: string; sizes?: string; purpose?: string }>;
};

describe("PWA offline contract", () => {
  it("declares a standalone installable app with local icons", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some((icon) => icon.src === "/icons/icon-192.png" && icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((icon) => icon.src === "/icons/icon-512.png" && icon.sizes === "512x512")).toBe(true);
  });

  it("pre-caches the primary game routes and falls back to the cached shell", () => {
    expect(worker).toContain('const SHELL_ROUTES = ["/", "/select", "/map", "/quest", "/bag"]');
    expect(worker).toContain('if (request.mode === "navigate")');
    expect(worker).toContain('const shell = await cache.match("/")');
    expect(worker).toContain("offlineFallbackHtml()");
  });

  it("caches content packs for offline use while preferring fresh online content", () => {
    expect(worker).toContain('url.pathname.startsWith("/content/")');
    expect(worker).toContain("networkFirst(request, CONTENT_CACHE");
    expect(worker).toContain('cache.match(request, { ignoreSearch: true })');
  });

  it("keeps previously viewed map tiles available offline with a bounded cache", () => {
    expect(worker).toContain("const TILE_CACHE_LIMIT = 400");
    expect(worker).toContain("staleWhileRevalidate(request, TILE_CACHE, TILE_CACHE_LIMIT)");
    expect(worker).toContain("return cached || (await fetching) || Response.error()");
  });

  it("does not intercept non-GET requests", () => {
    expect(worker).toContain('if (request.method !== "GET") return;');
  });
});
