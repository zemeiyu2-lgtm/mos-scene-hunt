/**
 * City service: create-or-reuse, idempotency, concurrency, merge resolution,
 * revision conflicts — all through the ONLY creation path, `attachCityToWork`.
 *
 * Every assertion here is about the server being the final authority: a client
 * that retries, or two clients that race, must converge on ONE profile, and no
 * profile may exist without a pack behind it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachCityToWork,
  auditCityProvenance,
  getPublicCity,
  listCitiesPublic,
  mergeCities,
  updateCityDisplay,
} from "@/lib/cities/service";
import { getCityStore } from "@/lib/cities/store";
import { publishWork } from "@/lib/registry/service";
import type { WorkState } from "@/lib/registry/types";
import type { CityTestEnv } from "./setup";
import { actor, seedUser, seedWork, setupCityEnv } from "./setup";

let env: CityTestEnv;
let owner: Awaited<ReturnType<typeof seedUser>>;
let admin: Awaited<ReturnType<typeof seedUser>>;
let seq = 0;

beforeEach(async () => {
  env = await setupCityEnv();
  owner = await seedUser(env.registry, "owner0001", "creator");
  admin = await seedUser(env.registry, "admin0001", "admin");
  seq = 0;
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

function nextGameId(): string {
  seq += 1;
  return `hunt-${String(seq).padStart(3, "0")}`;
}

/**
 * Attach a city to a freshly seeded pack. Mirrors what the API does, minus
 * HTTP: a pack must exist before a city can.
 */
async function attach(
  input: Parameters<typeof attachCityToWork>[2]["city"],
  opts: { gameId?: string; state?: WorkState } = {},
) {
  const gameId = opts.gameId ?? nextGameId();
  if (!(await env.registry.getWork(gameId))) {
    await seedWork(env.registry, { gameId, ownerUserId: owner.id, state: opts.state ?? "draft" });
  }
  const result = await attachCityToWork(actor(owner), gameId, { city: input });
  return { ...result, gameId, cityId: result.city!.cityId };
}

async function attachAndPublish(input: Parameters<typeof attach>[0]) {
  const result = await attach(input, { state: "approved" });
  const work = await publishWork(actor(admin), result.gameId);
  expect(work.state).toBe("published");
  return result;
}

describe("城市档案创建（必须由真实探索包触发）", () => {
  it("首次创建成功并返回稳定 id，且记录来源探索包", async () => {
    const result = await attach(MANILA);
    expect(result.created).toBe(true);
    expect(result.reused).toBe(false);
    expect(result.cityId).toBe("manila-ph");
    expect(result.city!.status).toBe("active");
    expect(result.city!.revision).toBe(0);
    // Provenance: the pack is why this city exists, and it is recorded.
    expect(result.city!.sourceGameId).toBe(result.gameId);
    expect(result.city!.sourceUserId).toBe(owner.id);
    expect(result.work.cityId).toBe(result.cityId);
  });

  it("探索包不存在时不建档", async () => {
    await expect(
      attachCityToWork(actor(owner), "hunt-missing", { city: MANILA }),
    ).rejects.toMatchObject({ status: 404, code: "work_not_found" });
    expect(await getCityStore().listCities()).toHaveLength(0);
  });

  it("无权限用户不能替他人的探索包建档或关联", async () => {
    const stranger = await seedUser(env.registry, "stranger01", "creator");
    await seedWork(env.registry, { gameId: "hunt-theirs", ownerUserId: owner.id, state: "draft" });
    await expect(
      attachCityToWork(actor(stranger), "hunt-theirs", { city: MANILA }),
    ).rejects.toMatchObject({ status: 403 });
    // Nothing was written: the rejected request left no profile behind.
    expect(await getCityStore().listCities()).toHaveLength(0);
    expect((await env.registry.getWork("hunt-theirs"))?.cityId).toBeUndefined();
  });

  it("已发布作品的城市归属，作者也不能改（管理员可以）", async () => {
    const live = await attachAndPublish({ cityName: "Manila", countryCode: "PH" });
    await expect(
      attachCityToWork(actor(owner), live.gameId, { city: { cityName: "Cebu", countryCode: "PH" } }),
    ).rejects.toMatchObject({ status: 403, code: "city_change_forbidden" });
    expect(await getCityStore().listCities()).toHaveLength(1);

    const moved = await attachCityToWork(actor(admin), live.gameId, {
      city: { cityName: "Cebu", countryCode: "PH" },
    });
    expect(moved.work.cityId).toBe("cebu-ph");
  });

  it("再次创建同一城市复用原档案，不新建文档", async () => {
    const first = await attach(MANILA);
    const second = await attach(MANILA);
    expect(second.created).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.cityId).toBe(first.cityId);
    expect(second.city!.createdAt).toBe(first.city!.createdAt);
    // One profile, two packs pointing at it.
    expect(await getCityStore().listCities()).toHaveLength(1);
    expect((await env.registry.getWork(second.gameId))?.cityId).toBe(first.cityId);
  });

  it("不同语言别名识别同一城市", async () => {
    await attach(MANILA);
    const byEnglish = await attach({ cityName: "Manila", countryCode: "PH" });
    const byFilipino = await attach({ cityName: "Maynila", countryCode: "PH" });
    expect(byEnglish.cityId).toBe("manila-ph");
    expect(byFilipino.cityId).toBe("manila-ph");
    expect(await getCityStore().listCities()).toHaveLength(1);
  });

  it("不同国家的同名城市不会错误合并", async () => {
    const ph = await attach({ cityName: "Springfield", countryCode: "PH" });
    const us = await attach({ cityName: "Springfield", countryCode: "US" });
    expect(ph.cityId).not.toBe(us.cityId);
    expect(await getCityStore().listCities()).toHaveLength(2);
  });

  it("同名同国不同行政区各自建档，且不合并", async () => {
    const il = await attach({
      cityName: "Springfield",
      countryCode: "US",
      adminAreaId: "IL",
      adminAreaName: "Illinois",
    });
    const ma = await attach({
      cityName: "Springfield",
      countryCode: "US",
      adminAreaId: "MA",
      adminAreaName: "Massachusetts",
    });
    expect(il.cityId).not.toBe(ma.cityId);
    expect(il.city!.adminAreaId).toBe("IL");
    expect(ma.city!.adminAreaId).toBe("MA");
  });

  it("歧义输入不会被强行并入既有档案", async () => {
    await attach({ cityName: "Springfield", countryCode: "US", adminAreaId: "IL" });
    await attach({ cityName: "Springfield", countryCode: "US", adminAreaId: "MA" });
    const third = await attach({ cityName: "Springfield", countryCode: "US" });
    expect(third.created).toBe(true);
    expect(third.cityId).not.toBe("springfield-us");
    expect(third.cityId).not.toBe("springfield-us-2");
    expect(await getCityStore().listCities()).toHaveLength(3);
  });

  it("多个探索包并发关联同一城市只产生一个档案", async () => {
    const gameIds = Array.from({ length: 6 }, () => nextGameId());
    for (const gameId of gameIds) {
      await seedWork(env.registry, { gameId, ownerUserId: owner.id, state: "draft" });
    }
    const results = await Promise.all(
      gameIds.map((gameId) => attachCityToWork(actor(owner), gameId, { city: MANILA })),
    );

    const ids = new Set(results.map((r) => r.city!.cityId));
    expect(ids.size).toBe(1);
    expect(ids.has("manila-ph")).toBe(true);
    expect(await getCityStore().listCities()).toHaveLength(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    // Every pack ended up attached to the same profile.
    for (const gameId of gameIds) {
      expect((await env.registry.getWork(gameId))?.cityId).toBe("manila-ph");
    }
  });

  it("同一探索包重复提交（超时重试）是幂等的", async () => {
    const first = await attach(MANILA);
    const before = (await env.registry.getWork(first.gameId))!;
    const retries = await Promise.all(
      Array.from({ length: 3 }, () =>
        attachCityToWork(actor(owner), first.gameId, { city: MANILA }),
      ),
    );
    for (const retry of retries) expect(retry.city!.cityId).toBe(first.cityId);
    expect(retries.every((r) => r.created === false)).toBe(true);
    // No duplicate profile and no pointless work revision bump.
    expect(await getCityStore().listCities()).toHaveLength(1);
    expect((await env.registry.getWork(first.gameId))?.revision).toBe(before.revision);
  });

  it("输入校验拒绝非法国家码与空名称", async () => {
    await seedWork(env.registry, { gameId: "hunt-invalid", ownerUserId: owner.id, state: "draft" });
    await expect(
      attachCityToWork(actor(owner), "hunt-invalid", { city: { cityName: "", countryCode: "PH" } }),
    ).rejects.toThrow();
    await expect(
      attachCityToWork(actor(owner), "hunt-invalid", { city: { cityName: "Manila", countryCode: "PHL" } }),
    ).rejects.toThrow();
    expect(await getCityStore().listCities()).toHaveLength(0);
  });
});

describe("城市档案合并", () => {
  it("合并后旧 id 解析到有效城市，且标记 redirected", async () => {
    const a = await attach({ cityName: "Manila", countryCode: "PH", adminAreaName: "Metro Manila" });
    const b = await attach({ cityName: "Maynila", countryCode: "PH", adminAreaName: "Metro Manila" });
    expect(a.cityId).not.toBe(b.cityId);

    await mergeCities(a.cityId, b.cityId);

    const oldLookup = await getPublicCity(a.cityId);
    expect(oldLookup).not.toBeNull();
    expect(oldLookup?.city.cityId).toBe(b.cityId);
    expect(oldLookup?.redirected).toBe(true);

    const retired = await getCityStore().getCity(a.cityId);
    expect(retired?.status).toBe("merged");
    expect(retired?.mergedInto).toBe(b.cityId);
  });

  it("合并后再次创建同名城市复用存活档案（重新建档也走探索包流程）", async () => {
    const a = await attach({ cityName: "Manila", countryCode: "PH", adminAreaId: "MNL" });
    const b = await attach({ cityName: "Manila", countryCode: "PH", adminAreaId: "METRO" });
    await mergeCities(a.cityId, b.cityId);
    const again = await attach({ cityName: "Manila", countryCode: "PH", adminAreaId: "MNL" });
    expect(again.created).toBe(false);
    expect(again.cityId).toBe(b.cityId);
  });

  it("拒绝自合并与成环", async () => {
    const a = await attach({ cityName: "Manila", countryCode: "PH", adminAreaId: "A" });
    const b = await attach({ cityName: "Manila", countryCode: "PH", adminAreaId: "B" });
    await expect(mergeCities(a.cityId, a.cityId)).rejects.toThrow();
    await mergeCities(a.cityId, b.cityId);
    await expect(mergeCities(a.cityId, b.cityId)).rejects.toThrow();
  });

  it("合并可恢复：清除指针后旧档案重新可解析", async () => {
    const a = await attach({ cityName: "Manila", countryCode: "PH", adminAreaId: "A" });
    const b = await attach({ cityName: "Manila", countryCode: "PH", adminAreaId: "B" });
    await mergeCities(a.cityId, b.cityId);

    const store = getCityStore();
    const retired = await store.getCity(a.cityId);
    expect(retired).not.toBeNull();
    const restored = {
      ...retired!,
      status: "active" as const,
      mergedInto: undefined,
      revision: retired!.revision + 1,
    };
    const written = await store.putCity(restored, retired!.revision);
    expect(written.ok).toBe(true);

    const lookup = await getPublicCity(a.cityId);
    expect(lookup?.city.cityId).toBe(a.cityId);
    expect(lookup?.redirected).toBe(false);
  });

  it("合并后，仍挂在旧 id 上的已发布探索包出现在存活城市（作品文档不需重写）", async () => {
    const { listCityPackages } = await import("@/lib/cities/link");
    const a = await attachAndPublish({ cityName: "Manila", countryCode: "PH", adminAreaId: "A" });
    const b = await attachAndPublish({ cityName: "Manila", countryCode: "PH", adminAreaId: "B" });

    await mergeCities(a.cityId, b.cityId);

    // a's work still stores the retired id; discovery must follow the pointer.
    const workA = (await env.registry.getWork(a.gameId))!;
    expect(workA.cityId).toBe(a.cityId);
    const listed = await listCityPackages(b.cityId, { cityStore: getCityStore(), registry: env.registry });
    expect(listed.map((p) => p.gameId).sort()).toEqual([a.gameId, b.gameId].sort());
  });
});

describe("并发与冲突", () => {
  it("ETag/revision 冲突不会覆盖他人更新", async () => {
    const created = await attach(MANILA);
    const store = getCityStore();
    const base = await store.getCity(created.cityId);
    expect(base).not.toBeNull();

    const first = await updateCityDisplay(created.cityId, { cityName: "马尼拉市" });
    expect(first.revision).toBe(base!.revision + 1);

    // A second writer still holding the OLD revision must be rejected, not
    // silently overwrite the first update.
    const stale = { ...base!, cityName: "马尼拉（旧）", revision: base!.revision + 1 };
    const rejected = await store.putCity(stale, base!.revision);
    expect(rejected.ok).toBe(false);
    expect(rejected.conflict).toBe(true);

    const after = await store.getCity(created.cityId);
    expect(after?.cityName).toBe("马尼拉市");
  });

  it("两个并发展示更新只有一个成功", async () => {
    const created = await attach(MANILA);
    const results = await Promise.allSettled([
      updateCityDisplay(created.cityId, { cityName: "A" }),
      updateCityDisplay(created.cityId, { cityName: "B" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
  });
});

describe("公开城市列表", () => {
  it("只有拥有已发布探索包的城市进入公开列表", async () => {
    const published = await attachAndPublish({ cityName: "Manila", countryCode: "PH" });
    const draftOnly = await attach({ cityName: "Cebu", countryCode: "PH" });

    const publicList = await listCitiesPublic();
    expect(publicList.map((entry) => entry.cityId)).toEqual([published.cityId]);
    expect(publicList[0].gameCount).toBe(1);

    // The creator picker still sees the city its draft created.
    const all = await listCitiesPublic({ scope: "picker", actorUserId: owner.id });
    expect(all.map((entry) => entry.cityId).sort()).toEqual([draftOnly.cityId, published.cityId].sort());
  });

  it("撤下后城市退出公开列表，但档案保留", async () => {
    const { applySimpleAction } = await import("@/lib/registry/service");
    const live = await attachAndPublish({ cityName: "Manila", countryCode: "PH" });
    expect(await listCitiesPublic()).toHaveLength(1);

    await applySimpleAction(actor(admin), live.gameId, "withdraw");
    expect(await listCitiesPublic()).toHaveLength(0);
    // Lifecycle boundary: a withdrawal must never delete the city profile.
    expect(await getCityStore().getCity(live.cityId)).not.toBeNull();
  });

  it("支持按名称与按国家过滤，合并档案不出现在列表", async () => {
    await attachAndPublish({ cityName: "Manila", countryCode: "PH" });
    const cebu = await attach({ cityName: "Cebu", countryCode: "PH" });
    const sg = await attach({ cityName: "Singapore", countryCode: "SG" });
    await mergeCities(sg.cityId, cebu.cityId);

    const all = await listCitiesPublic({ scope: "picker", actorUserId: owner.id });
    expect(all.map((entry) => entry.cityId).sort()).toEqual([cebu.cityId, "manila-ph"].sort());

    const ph = await listCitiesPublic({ scope: "picker", actorUserId: owner.id, country: "PH" });
    expect(ph.every((entry) => entry.countryCode === "PH")).toBe(true);

    const searched = await listCitiesPublic({ scope: "picker", actorUserId: owner.id, q: "cebu" });
    expect(searched).toHaveLength(1);
    expect(searched[0].cityId).toBe(cebu.cityId);
  });
});

describe("溯源与孤立档案", () => {
  it("正常流程下不存在没有探索包来源的城市", async () => {
    await attach(MANILA);
    await attach({ cityName: "Cebu", countryCode: "PH" });
    const report = await auditCityProvenance();
    expect(report.scanned).toBe(2);
    expect(report.backed).toBe(2);
    expect(report.orphans).toEqual([]);
  });

  it("解除关联后城市仍有来源记录（不视为凭空出现）", async () => {
    const created = await attach(MANILA);
    const cleared = await attachCityToWork(actor(owner), created.gameId, { cityId: null });
    expect(cleared.work.cityId).toBeUndefined();

    const report = await auditCityProvenance();
    // No work/link references it any more, so it IS reported — the point is
    // that it is detectable and still carries the pack that created it.
    expect(report.orphans).toHaveLength(1);
    expect(report.orphans[0].sourceGameId).toBe(created.gameId);
    expect(report.orphans[0].reason).toBe("source_work_not_linked");
    // Reported, never deleted: removal is an operator decision.
    expect(await getCityStore().getCity(created.cityId)).not.toBeNull();
  });
});
