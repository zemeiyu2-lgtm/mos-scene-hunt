/**
 * Five-state mapping — the single place where server fields become UI states.
 *
 * The failure modes this file exists to prevent:
 *   - "not decided" being rendered as "failed";
 *   - a failed association being rendered as "skipped";
 *   - `cityId === null` being used on its own to infer either of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachCity,
  blocksPublish,
  cityAssociationAnomaly,
  CITY_PROFILE_MISSING,
  INVALID_CITY_ID,
  mapCityAssociation,
  type WorkCityPayload,
} from "@/lib/cities/client";

function payload(overrides: Partial<WorkCityPayload> = {}): WorkCityPayload {
  return {
    gameId: "hunt-1",
    cityId: null,
    state: "submitted",
    city: null,
    intent: null,
    ...overrides,
  };
}

describe("mapCityAssociation", () => {
  it("有 cityId → associated（即使还残留 pending intent）", () => {
    const state = mapCityAssociation(
      payload({
        cityId: "manila-ph",
        city: { cityId: "manila-ph", cityName: "Manila", countryCode: "PH", countryName: "Philippines" },
        intent: { mode: "pending", cityId: "cebu-ph", attempts: 2 },
      }),
    );
    expect(state).toEqual({ kind: "associated", cityId: "manila-ph", cityName: "Manila" });
  });

  it("pending + attempts=0 → 等待关联", () => {
    const state = mapCityAssociation(
      payload({ intent: { mode: "pending", cityId: "manila-ph", cityName: "Manila", attempts: 0 } }),
    );
    expect(state).toEqual({ kind: "pending_waiting", cityId: "manila-ph", cityName: "Manila" });
  });

  it("pending + attempts>0 → 关联失败/结果未知，并保留 lastError", () => {
    const state = mapCityAssociation(
      payload({
        intent: { mode: "pending", cityId: "manila-ph", cityName: "Manila", attempts: 2, lastError: "attach_failed" },
      }),
    );
    expect(state).toEqual({
      kind: "pending_failed",
      cityId: "manila-ph",
      cityName: "Manila",
      attempts: 2,
      lastError: "attach_failed",
    });
  });

  it("明确 skip → skipped", () => {
    expect(mapCityAssociation(payload({ intent: { mode: "skipped", attempts: 0 } }))).toEqual({
      kind: "skipped",
    });
  });

  it("没有 intent 且没有 cityId → unset（不是 skipped，也不是 failed）", () => {
    expect(mapCityAssociation(payload())).toEqual({ kind: "unset" });
  });

  it("没有作品记录（null）→ unset", () => {
    expect(mapCityAssociation(null)).toEqual({ kind: "unset" });
  });
});

/*
 * A stored cityId is an identifier, not a display string. If it is not a legal
 * city id it cannot be a city, so it must never render as "✓ 已关联" — and it
 * must not silently become "未选择" either, because that would let a damaged
 * record pass the publish gate.
 */
describe("无效 cityId 不得显示为 associated", () => {
  const INVALID_IDS = [
    "Manila PH", // space + upper case
    "Manila", // upper case only
    "../etc/passwd", // traversal
    "manila%2Fph", // encoded separator
    "-manila", // leading dash
    "a", // too short for the 2-char minimum
    "manila_ph", // illegal character
    " manila-ph", // leading space
  ];

  for (const cityId of INVALID_IDS) {
    it(`"${cityId}" → 关联失败（记录异常），不是 associated`, () => {
      const state = mapCityAssociation(
        payload({
          cityId,
          city: { cityId, cityName: "Manila", countryCode: "PH", countryName: "Philippines" },
          intent: null,
        }),
      );
      expect(state.kind).not.toBe("associated");
      expect(state).toEqual({
        kind: "pending_failed",
        cityId: null,
        cityName: "Manila",
        attempts: 1,
        lastError: INVALID_CITY_ID,
      });
      // Still blocking: a broken link must not read as "never decided".
      expect(blocksPublish(state)).toBe(true);
    });
  }

  it("无效 cityId 也不会被当作 skipped（即使 intent 说 skipped）", () => {
    const state = mapCityAssociation(
      payload({ cityId: "Manila", intent: { mode: "skipped", attempts: 0 } }),
    );
    expect(state.kind).toBe("pending_failed");
  });

  it("合法 cityId 且档案摘要存在 → associated（含小写 slug 与数字）", () => {
    for (const cityId of ["manila-ph", "cebu-ph", "ho-chi-minh-vn", "city2"]) {
      const state = mapCityAssociation(
        payload({
          cityId,
          city: { cityId, cityName: "Manila", countryCode: "PH", countryName: "Philippines" },
        }),
      );
      expect(state.kind, cityId).toBe("associated");
    }
  });

  it("合法格式但档案不存在/已删除 → 城市档案缺失，绝不是 associated，也不伪造名称", () => {
    // The server omits the city summary exactly when the profile cannot be
    // resolved, so valid-id + no-name is the fingerprint of a dangling link.
    // Rendering "✓ manila-ph" would present a dead reference as a city.
    for (const cityId of ["manila-ph", "cebu-01", "quezon-city-ph"]) {
      const state = mapCityAssociation(payload({ cityId, city: null, intent: null }));
      expect(state, cityId).toEqual({
        kind: "pending_failed",
        cityId, // kept: the UI still offers retry attach / clear recovery
        cityName: null, // never invented from the id
        attempts: 1,
        lastError: CITY_PROFILE_MISSING,
      });
      expect(blocksPublish(state)).toBe(true);
    }
  });

  it("档案缺失的异常反馈出现在管理端提示里，且不误判为 skipped", () => {
    const anomaly = cityAssociationAnomaly({
      workState: "submitted",
      cityId: "manila-ph",
      intent: null,
    });
    expect(anomaly).toBe("城市档案缺失（关联指向的城市已不存在），需人工修正");

    const withSkippedIntent = mapCityAssociation(
      payload({ cityId: "manila-ph", city: null, intent: { mode: "skipped", attempts: 0 } }),
    );
    expect(withSkippedIntent.kind).toBe("pending_failed");
    expect(withSkippedIntent.kind).not.toBe("skipped");
  });

  it("intent 里的无效 cityId 不会变成 associated，也不会被当作可重试的目标", () => {
    // The intent field is a DECISION record, not an association: an invalid id
    // there stays a pending decision, the stored NAME is still shown, and the
    // id is dropped so a retry cannot send a garbage value to the write path.
    const state = mapCityAssociation(
      payload({ intent: { mode: "pending", cityId: "Manila PH", cityName: "Manila", attempts: 0 } }),
    );
    expect(state).toEqual({ kind: "pending_waiting", cityId: null, cityName: "Manila" });
    expect(state.kind).not.toBe("associated");
  });
});

describe("blocksPublish", () => {
  it("只有 pending 阻断发布", () => {
    expect(blocksPublish({ kind: "pending_waiting", cityId: "manila-ph", cityName: "Manila" })).toBe(true);
    expect(
      blocksPublish({
        kind: "pending_failed",
        cityId: "manila-ph",
        cityName: "Manila",
        attempts: 1,
        lastError: null,
      }),
    ).toBe(true);
    expect(blocksPublish({ kind: "unset" })).toBe(false);
    expect(blocksPublish({ kind: "skipped" })).toBe(false);
    expect(blocksPublish({ kind: "associated", cityId: "manila-ph", cityName: "Manila" })).toBe(false);
  });
});

describe("关联失败不被改写为 skipped", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attachCity 失败时返回错误，调用方保留 pending 失败态", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "work_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await attachCity("hunt-1", "manila-ph");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.code).toBe("work_not_found");
    }

    // The server, re-read after the failed attach, still holds the decision:
    // pending with attempts > 0. That maps to "failed", never to "skipped".
    const afterFailure = mapCityAssociation(
      payload({
        intent: { mode: "pending", cityId: "manila-ph", cityName: "Manila", attempts: 1, lastError: "attach_failed" },
      }),
    );
    expect(afterFailure.kind).toBe("pending_failed");
    expect(filterSkipped(afterFailure)).toBe(false);
  });

  it("关联成功后才变成 associated", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          gameId: "hunt-1",
          cityId: "manila-ph",
          state: "submitted",
          city: { cityId: "manila-ph", cityName: "Manila", countryCode: "PH", countryName: "Philippines" },
          intent: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await attachCity("hunt-1", "manila-ph");
    expect(result.ok).toBe(true);
    if (result.ok) expect(mapCityAssociation(result.data).kind).toBe("associated");
  });
});

function filterSkipped(state: { kind: string }): boolean {
  return state.kind === "skipped";
}

describe("cityAssociationAnomaly（管理端矛盾态，只提示不自动改写）", () => {
  it("published + pending 是矛盾态，给出人工确认提示", () => {
    expect(
      cityAssociationAnomaly({
        workState: "published",
        cityId: null,
        intent: { mode: "pending", cityId: "manila-ph", cityName: "Manila", attempts: 0 },
      }),
    ).toContain("人工确认");
  });

  it("pending 但未发布、published 但已关联/skipped/未决定，都不是矛盾态", () => {
    expect(
      cityAssociationAnomaly({
        workState: "published",
        cityId: "manila-ph",
        cityName: "Manila", // profile resolves → a healthy association
        intent: null,
      }),
    ).toBeNull();
    expect(
      cityAssociationAnomaly({
        workState: "draft",
        cityId: null,
        intent: { mode: "pending", cityId: "manila-ph", cityName: "Manila", attempts: 0 },
      }),
    ).toBeNull();
    expect(
      cityAssociationAnomaly({
        workState: "published",
        cityId: null,
        intent: { mode: "skipped" },
      }),
    ).toBeNull();
    expect(cityAssociationAnomaly({ workState: "published", cityId: null, intent: null })).toBeNull();
  });

  it("不合法的存储 cityId 是记录损坏，同样只提示", () => {
    expect(cityAssociationAnomaly({ workState: "submitted", cityId: "Manila PH", intent: null })).toBe(
      "城市归属记录异常（id 不合法），需人工修正",
    );
  });

  it("矛盾态判定本身不产生任何写操作（纯函数，无副作用面）", () => {
    // The judgement is a pure read of the record: the admin table renders the
    // text and highlights the row, and NOTHING here touches the registry.
    const record = {
      workState: "published",
      cityId: null,
      intent: { mode: "pending" as const, cityId: "manila-ph", cityName: "Manila", attempts: 0 },
    };
    const first = cityAssociationAnomaly(record);
    const second = cityAssociationAnomaly(record);
    expect(first).toBe(second);
    // The input record is untouched.
    expect(record.intent.mode).toBe("pending");
    expect(record.workState).toBe("published");
  });
});
