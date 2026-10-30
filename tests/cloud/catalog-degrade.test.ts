/**
 * 目录降级行为：registry 不可读时 `/games` 不能整页失败。
 *
 * 这条用例必须替换模块导出（模拟 Blob 缺凭据/网络故障），所以单独成文件；
 * 与 catalog-visibility.test.ts 共用同一套断言风格。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const failing = { mode: "throw" as "throw" | "ok" };

vi.mock("@/lib/registry/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registry/service")>();
  return {
    ...actual,
    publishedCatalogEntries: async () => {
      if (failing.mode === "throw") throw new Error("blob: missing token");
      return actual.publishedCatalogEntries();
    },
  };
});

const { GET: catalogGet } = await import("@/app/content/cloud/catalog.json/route");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catalog degradation", () => {
  it("falls back gracefully instead of returning 500", async () => {
    failing.mode = "throw";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await catalogGet();
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      version: string;
      games: Array<{ id: string; source: string }>;
    };
    // 3331715 起游戏中心只展示 registry 中 state=published 的作品，内置精选
    // 列表为空（内置包仍在仓库中，但不进目录）。registry 不可用时目录为空，
    // 但必须是 200 —— 不能因为后台读失败把整个游戏中心打挂。
    expect(body.games).toEqual([]);
    // 降级必须留下痕迹，否则线上目录变短没人会发现
    expect(errors).toHaveBeenCalled();
  });

  it("marks the catalogue as revalidatable rather than immutable", async () => {
    failing.mode = "throw";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await catalogGet();
    const cache = response.headers.get("cache-control") ?? "";
    expect(cache).toContain("max-age=30");
    expect(cache).not.toContain("immutable");
  });
});
