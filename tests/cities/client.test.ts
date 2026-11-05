/**
 * City data layer (G2-C).
 *
 * These tests are about the ONE thing pages are allowed to rely on: the data
 * layer never disguises a failure as an empty result, never caches a failure,
 * never shares a cache between permission views, and never re-reads the same
 * payload twice within the TTL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachCity,
  invalidateCityCaches,
  loadCityDetail,
  loadCityList,
  type PublicCitySummary,
} from "@/lib/cities/client";

function city(cityId: string, extra: Partial<PublicCitySummary> = {}): PublicCitySummary {
  return {
    cityId,
    cityName: cityId === "manila-ph" ? "Manila" : "Cebu",
    countryCode: "PH",
    countryName: "Philippines",
    adminAreaName: null,
    localizedNames: {},
    status: "active",
    gameCount: 1,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  invalidateCityCaches();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* List: success vs empty vs the three failure kinds                   */
/* ------------------------------------------------------------------ */

describe("loadCityList", () => {
  it("成功返回城市列表", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: [city("manila-ph")], scope: "public" }));
    const result = await loadCityList();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.map((entry) => entry.cityId)).toEqual(["manila-ph"]);
    }
  });

  it("空列表是成功结果，不是错误", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: [] }));
    const result = await loadCityList();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it("网络失败返回 network，且不会被当成空列表", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await loadCityList();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("network");
      expect(result.error.status).toBe(0);
    }
  });

  it("服务端 5xx 返回 http 并带上服务端错误码与文案", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "internal_error", message: "服务开小差了。" }, 500),
    );
    const result = await loadCityList();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("http");
      expect(result.error.status).toBe(500);
      expect(result.error.code).toBe("internal_error");
      expect(result.error.message).toBe("服务开小差了。");
    }
  });

  it("401 单独识别为 unauthorized", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const result = await loadCityList({ view: "picker" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unauthorized");
  });

  it("结构异常（cities 不是数组）返回 malformed，不返回空列表", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: "nope" }));
    const result = await loadCityList();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("结构异常（城市条目缺 cityId）同样返回 malformed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: [{ cityName: "Manila" }] }));
    const result = await loadCityList();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("响应体不是 JSON 返回 malformed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const result = await loadCityList();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });
});

/* ------------------------------------------------------------------ */
/* Cache behaviour                                                     */
/* ------------------------------------------------------------------ */

describe("60 秒缓存", () => {
  it("TTL 内相同请求只发一次", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cities: [city("manila-ph")] }));
    await loadCityList();
    await loadCityList();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("并发相同请求共享一次飞行中的请求", async () => {
    let release: ((value: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    const first = loadCityList();
    const second = loadCityList();
    // Two callers, one fetch — the second is waiting on the first, not starting.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release!(jsonResponse({ cities: [city("manila-ph")] }));
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);

    // And the result was cached, so a third call does not fetch again.
    await loadCityList();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("失败结果不进入缓存：下一次请求会重新执行", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const first = await loadCityList();
    expect(first.ok).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: [city("manila-ph")] }));
    const second = await loadCityList();
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("结构异常也不进入缓存", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: 42 }));
    expect((await loadCityList()).ok).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: [] }));
    const second = await loadCityList();
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data).toEqual([]);
  });

  it("失败会作废此前的成功缓存，避免旧数据盖住已知故障", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: [city("manila-ph")] }));
    expect((await loadCityList()).ok).toBe(true);

    // Force the TTL to look expired without waiting a minute.
    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 61_000);
    try {
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const stale = await loadCityList();
      expect(stale.ok).toBe(false);
    } finally {
      spy.mockRestore();
    }

    fetchMock.mockResolvedValueOnce(jsonResponse({ cities: [city("cebu-ph")] }));
    const fresh = await loadCityList();
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.data[0].cityId).toBe("cebu-ph");
  });

  it("不同权限视图的缓存互不复用", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ cities: [city("manila-ph")] }))
      .mockResolvedValueOnce(jsonResponse({ cities: [city("manila-ph"), city("cebu-ph")] }))
      .mockResolvedValueOnce(jsonResponse({ cities: [city("cebu-ph")] }));

    const publicResult = await loadCityList();
    const pickerResult = await loadCityList({ view: "picker" });
    const adminResult = await loadCityList({ view: "admin" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    if (publicResult.ok) expect(publicResult.data).toHaveLength(1);
    if (pickerResult.ok) expect(pickerResult.data).toHaveLength(2);
    if (adminResult.ok) expect(adminResult.data).toHaveLength(1);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toBe("/api/cities");
    expect(urls[1]).toContain("scope=picker");
    expect(urls[2]).toContain("scope=admin");
  });

  it("不同查询条件使用不同缓存键", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cities: [] }));
    await loadCityList({ q: "manila" });
    await loadCityList({ q: "cebu" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /* ------------------------------------------------------------------ */
  /* limit is a response-shaping parameter, so it must split the cache    */
  /* ------------------------------------------------------------------ */

  it("limit=3 与完整列表互不复用缓存", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ cities: [city("cebu-ph"), city("manila-ph")] })) // full list
      .mockResolvedValueOnce(jsonResponse({ cities: [city("cebu-ph")] })); // limit=3 answer

    const full = await loadCityList();
    const preview = await loadCityList({ limit: 3 });

    // Two different questions, two requests — a 3-row answer must never be
    // handed to a caller that asked for everything.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (full.ok) expect(full.data).toHaveLength(2);
    if (preview.ok) expect(preview.data).toHaveLength(1);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toBe("/api/cities");
    expect(urls[1]).toBe("/api/cities?limit=3");

    // And each answer stays under its own key: asking again returns the same
    // row count without another request.
    const againFull = await loadCityList();
    const againPreview = await loadCityList({ limit: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (againFull.ok) expect(againFull.data).toHaveLength(2);
    if (againPreview.ok) expect(againPreview.data).toHaveLength(1);
  });

  it("不同 limit 之间也不共享缓存", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cities: [city("cebu-ph")] }));
    await loadCityList({ limit: 3 });
    await loadCityList({ limit: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toContain("limit=3");
    expect(urls[1]).toContain("limit=10");
  });

  it("反向顺序同样隔离：入口的 limit=3 先行，完整列表不被污染", async () => {
    // The /games entry fires first with limit=3; the /cities catalogue then
    // asks for everything. The catalogue must get its OWN full answer, never
    // the entry's 3-row preview.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ cities: [city("cebu-ph")] })) // entry: limit=3
      .mockResolvedValueOnce(
        jsonResponse({
          cities: [city("cebu-ph"), city("manila-ph"), city("quezon-city-ph"), city("davao-ph")],
        }),
      ); // catalogue: full

    const entry = await loadCityList({ limit: 3 });
    const catalogue = await loadCityList();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toBe("/api/cities?limit=3");
    expect(urls[1]).toBe("/api/cities");

    if (entry.ok) expect(entry.data).toHaveLength(1);
    if (catalogue.ok) expect(catalogue.data).toHaveLength(4);

    // Repeats stay under their own keys too.
    const againCatalogue = await loadCityList();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (againCatalogue.ok) expect(againCatalogue.data).toHaveLength(4);
  });

  it("limit 与 scope 组合仍各自成键（预览不会被当成管理端列表）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cities: [] }));
    await loadCityList({ limit: 3 });
    await loadCityList({ view: "admin", limit: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toBe("/api/cities?limit=3");
    expect(urls[1]).toBe("/api/cities?scope=admin&limit=3");
  });

  it("等价请求（大小写、首尾空格、小数 limit）共用一次请求", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cities: [] }));
    await loadCityList({ q: "  Manila ", country: "ph", limit: 3 });
    await loadCityList({ q: "manila", country: "PH", limit: 3.9 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/cities?q=manila&country=PH&limit=3");
  });

  it("成功写入后列表缓存失效", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ cities: [] })) // initial picker list
      .mockResolvedValueOnce(
        jsonResponse({
          gameId: "hunt-1",
          cityId: "manila-ph",
          state: "submitted",
          city: { cityId: "manila-ph", cityName: "Manila", countryCode: "PH", countryName: "Philippines" },
          intent: null,
        }),
      ) // attach
      .mockResolvedValueOnce(jsonResponse({ cities: [city("manila-ph")] })); // re-read

    await loadCityList({ view: "picker" });
    const attached = await attachCity("hunt-1", "manila-ph");
    expect(attached.ok).toBe(true);

    const after = await loadCityList({ view: "picker" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    if (after.ok) expect(after.data).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

describe("loadCityDetail", () => {
  it("一次请求同时返回城市与公开探索包", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        city: city("manila-ph", { gameCount: 1 }),
        packages: [{ gameId: "hunt-1", title: "Intramuros", sceneCount: 5, updatedAt: "2026-11-01" }],
        requestedCityId: "manila-ph",
        redirected: false,
      }),
    );

    const result = await loadCityDetail("manila-ph");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.city.cityId).toBe("manila-ph");
      expect(result.data.packages.map((pack) => pack.gameId)).toEqual(["hunt-1"]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("城市存在但没有公开包：not_found + city_not_public", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "city_not_public", message: "没有公开内容。" }, 404));
    const result = await loadCityDetail("manila-ph");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.code).toBe("city_not_public");
    }
  });

  it("城市不存在：not_found + city_not_found（与上一种区分开）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "city_not_found", message: "城市档案不存在。" }, 404));
    const result = await loadCityDetail("nowhere-xx");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("city_not_found");
  });

  it("空 cityId 不发请求", async () => {
    const result = await loadCityDetail("");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("详情结构异常返回 malformed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ city: city("manila-ph"), packages: null }));
    const result = await loadCityDetail("manila-ph");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("网络失败返回 network（详情页据此给出重试）", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await loadCityDetail("manila-ph");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("network");
  });
});

/* ------------------------------------------------------------------ */
/* Clearing an association (admin repair path)                         */
/* ------------------------------------------------------------------ */

describe("attachCity(null)", () => {
  it("用同一个写入端点发送 cityId: null，而不是发明一个 DELETE", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ gameId: "hunt-1", cityId: null, state: "published", city: null, intent: null }),
    );

    const result = await attachCity("hunt-1", null);
    expect(result.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/works/hunt-1/city");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ cityId: null });
  });

  it("清除失败时如实返回错误（管理端不得显示成功）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "forbidden", message: "没有权限。" }, 403));
    const result = await attachCity("hunt-1", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("forbidden");
  });
});
