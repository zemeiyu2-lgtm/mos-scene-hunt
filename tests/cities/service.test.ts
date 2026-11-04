/**
 * City service: create-or-reuse, idempotency, concurrency, merge resolution,
 * revision conflicts.
 *
 * Every assertion here is about the server being the final authority: a client
 * that retries, or two clients that race, must converge on ONE profile.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOrReuseCity, getPublicCity, listCitiesPublic, mergeCities, updateCityDisplay } from "@/lib/cities/service";
import { getCityStore } from "@/lib/cities/store";
import type { CityTestEnv } from "./setup";
import { setupCityEnv } from "./setup";

let env: CityTestEnv;

beforeEach(async () => {
  env = await setupCityEnv();
});

afterEach(async () => {
  await env.cleanup();
});

const MANILA = {
  cityName: "马尼拉",
  countryCode: "PH",
  countryName: "Philippines",
  localizedNames: { en: "Manila", fil: "Maynila" },
  adminAreaName: "Metro Manila",
};

describe("城市档案创建", () => {
  it("首次创建成功并返回稳定 id", async () => {
    const result = await createOrReuseCity(MANILA);
    expect(result.created).toBe(true);
    expect(result.reused).toBe(false);
    expect(result.city.cityId).toBe("manila-ph");
    expect(result.city.status).toBe("active");
    expect(result.city.revision).toBe(0);
  });

  it("再次创建同一城市复用原档案，不新建文档", async () => {
    const first = await createOrReuseCity(MANILA);
    const second = await createOrReuseCity(MANILA);
    expect(second.created).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.city.cityId).toBe(first.city.cityId);
    expect(second.city.createdAt).toBe(first.city.createdAt);
    expect(await getCityStore().listCities()).toHaveLength(1);
  });

  it("不同语言别名识别同一城市", async () => {
    await createOrReuseCity(MANILA);
    const byEnglish = await createOrReuseCity({ cityName: "Manila", countryCode: "PH" });
    const byFilipino = await createOrReuseCity({ cityName: "Maynila", countryCode: "PH" });
    expect(byEnglish.city.cityId).toBe("manila-ph");
    expect(byFilipino.city.cityId).toBe("manila-ph");
    expect(await getCityStore().listCities()).toHaveLength(1);
  });

  it("不同国家的同名城市不会错误合并", async () => {
    const ph = await createOrReuseCity({ cityName: "Springfield", countryCode: "PH" });
    const us = await createOrReuseCity({ cityName: "Springfield", countryCode: "US" });
    expect(ph.city.cityId).not.toBe(us.city.cityId);
    expect(await getCityStore().listCities()).toHaveLength(2);
  });

  it("同名同国不同行政区各自建档，且不合并", async () => {
    const il = await createOrReuseCity({
      cityName: "Springfield",
      countryCode: "US",
      adminAreaId: "IL",
      adminAreaName: "Illinois",
    });
    const ma = await createOrReuseCity({
      cityName: "Springfield",
      countryCode: "US",
      adminAreaId: "MA",
      adminAreaName: "Massachusetts",
    });
    expect(il.city.cityId).not.toBe(ma.city.cityId);
    expect(il.city.adminAreaId).toBe("IL");
    expect(ma.city.adminAreaId).toBe("MA");
  });

  it("歧义输入不会被强行并入既有档案", async () => {
    await createOrReuseCity({ cityName: "Springfield", countryCode: "US", adminAreaId: "IL" });
    await createOrReuseCity({ cityName: "Springfield", countryCode: "US", adminAreaId: "MA" });
    const third = await createOrReuseCity({ cityName: "Springfield", countryCode: "US" });
    expect(third.created).toBe(true);
    expect(third.city.cityId).not.toBe("springfield-us");
    expect(third.city.cityId).not.toBe("springfield-us-2");
    expect(await getCityStore().listCities()).toHaveLength(3);
  });

  it("并发创建同一城市只产生一个档案", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createOrReuseCity(MANILA)),
    );
    const ids = new Set(results.map((r) => r.city.cityId));
    expect(ids.size).toBe(1);
    expect(ids.has("manila-ph")).toBe(true);
    expect(await getCityStore().listCities()).toHaveLength(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("重复请求（网络超时后重试）是幂等的", async () => {
    const first = await createOrReuseCity(MANILA);
    const retries = await Promise.all(Array.from({ length: 3 }, () => createOrReuseCity(MANILA)));
    for (const retry of retries) expect(retry.city.cityId).toBe(first.city.cityId);
    expect(await getCityStore().listCities()).toHaveLength(1);
  });

  it("输入校验拒绝非法国家码与空名称", async () => {
    await expect(createOrReuseCity({ cityName: "", countryCode: "PH" })).rejects.toThrow();
    await expect(createOrReuseCity({ cityName: "Manila", countryCode: "PHL" })).rejects.toThrow();
  });
});

describe("城市档案合并", () => {
  it("合并后旧 id 解析到有效城市，且标记 redirected", async () => {
    const a = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaName: "Metro Manila" });
    const b = await createOrReuseCity({ cityName: "Maynila", countryCode: "PH", adminAreaName: "Metro Manila" });
    expect(a.city.cityId).not.toBe(b.city.cityId);

    await mergeCities(a.city.cityId, b.city.cityId);

    const oldLookup = await getPublicCity(a.city.cityId);
    expect(oldLookup).not.toBeNull();
    expect(oldLookup?.city.cityId).toBe(b.city.cityId);
    expect(oldLookup?.redirected).toBe(true);

    const retired = await getCityStore().getCity(a.city.cityId);
    expect(retired?.status).toBe("merged");
    expect(retired?.mergedInto).toBe(b.city.cityId);
  });

  it("合并后再次创建同名城市复用存活档案", async () => {
    const a = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "MNL" });
    const b = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "METRO" });
    await mergeCities(a.city.cityId, b.city.cityId);
    const again = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "MNL" });
    expect(again.created).toBe(false);
    expect(again.city.cityId).toBe(b.city.cityId);
  });

  it("拒绝自合并与成环", async () => {
    const a = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "A" });
    const b = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "B" });
    await expect(mergeCities(a.city.cityId, a.city.cityId)).rejects.toThrow();
    await mergeCities(a.city.cityId, b.city.cityId);
    await expect(mergeCities(a.city.cityId, b.city.cityId)).rejects.toThrow();
  });

  it("合并可恢复：清除指针后旧档案重新可解析", async () => {
    const a = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "A" });
    const b = await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "B" });
    await mergeCities(a.city.cityId, b.city.cityId);

    const store = getCityStore();
    const retired = await store.getCity(a.city.cityId);
    expect(retired).not.toBeNull();
    const restored = { ...retired!, status: "active" as const, mergedInto: undefined, revision: retired!.revision + 1 };
    const written = await store.putCity(restored, retired!.revision);
    expect(written.ok).toBe(true);

    const lookup = await getPublicCity(a.city.cityId);
    expect(lookup?.city.cityId).toBe(a.city.cityId);
    expect(lookup?.redirected).toBe(false);
  });
});

describe("并发与冲突", () => {
  it("ETag/revision 冲突不会覆盖他人更新", async () => {
    const created = await createOrReuseCity(MANILA);
    const store = getCityStore();
    const base = await store.getCity(created.city.cityId);
    expect(base).not.toBeNull();

    const first = await updateCityDisplay(created.city.cityId, { cityName: "马尼拉市" });
    expect(first.revision).toBe(base!.revision + 1);

    // A second writer still holding the OLD revision must be rejected, not
    // silently overwrite the first update.
    const stale = { ...base!, cityName: "马尼拉（旧）", revision: base!.revision + 1 };
    const rejected = await store.putCity(stale, base!.revision);
    expect(rejected.ok).toBe(false);
    expect(rejected.conflict).toBe(true);

    const after = await store.getCity(created.city.cityId);
    expect(after?.cityName).toBe("马尼拉市");
  });

  it("两个并发展示更新只有一个成功", async () => {
    const created = await createOrReuseCity(MANILA);
    const results = await Promise.allSettled([
      updateCityDisplay(created.city.cityId, { cityName: "A" }),
      updateCityDisplay(created.city.cityId, { cityName: "B" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
  });
});

describe("公开列表", () => {
  it("支持按名称与按国家过滤，合并档案不出现在列表", async () => {
    await createOrReuseCity({ cityName: "Manila", countryCode: "PH", adminAreaId: "A" });
    const b = await createOrReuseCity({ cityName: "Cebu", countryCode: "PH" });
    const c = await createOrReuseCity({ cityName: "Singapore", countryCode: "SG" });
    await mergeCities(c.city.cityId, b.city.cityId);

    const all = await listCitiesPublic();
    expect(all.map((entry) => entry.cityId).sort()).toEqual([b.city.cityId, "manila-ph"].sort());

    const ph = await listCitiesPublic({ country: "PH" });
    expect(ph.every((entry) => entry.countryCode === "PH")).toBe(true);

    const searched = await listCitiesPublic({ q: "cebu" });
    expect(searched).toHaveLength(1);
    expect(searched[0].cityId).toBe(b.city.cityId);
  });
});
