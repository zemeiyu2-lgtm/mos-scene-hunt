/**
 * "No city without a pack" — the failure paths.
 *
 * The happy path is covered in service.test.ts. What matters here is what the
 * store looks like AFTER something goes wrong: a rejected request must leave no
 * profile, and a half-finished association must be recoverable by retrying.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCityToWork, auditCityProvenance, listCitiesPublic } from "@/lib/cities/service";
import { getCityStore } from "@/lib/cities/store";
import { getRegistry } from "@/lib/registry/store";
import type { CityTestEnv } from "./setup";
import { actor, seedUser, seedWork, setupCityEnv } from "./setup";

let env: CityTestEnv;
let owner: Awaited<ReturnType<typeof seedUser>>;

const MANILA = { cityName: "Manila", countryCode: "PH" };

beforeEach(async () => {
  env = await setupCityEnv();
  owner = await seedUser(env.registry, "owner0001", "creator");
});

afterEach(async () => {
  await env.cleanup();
});

/** Make every work write fail, the way a Blob outage would. */
function breakWorkWrites(): () => void {
  const registry = getRegistry() as unknown as {
    putWork: (...args: unknown[]) => Promise<{ ok: boolean; conflict?: boolean }>;
  };
  const original = registry.putWork;
  registry.putWork = async () => ({ ok: false, conflict: true });
  return () => {
    registry.putWork = original;
  };
}

describe("关联失败时的补偿", () => {
  it("作品写入失败 → 新建的城市档案被回滚，不留孤立档案", async () => {
    await seedWork(env.registry, { gameId: "hunt-fail", ownerUserId: owner.id, state: "draft" });
    const restore = breakWorkWrites();
    try {
      await expect(
        attachCityToWork(actor(owner), "hunt-fail", { city: MANILA }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }

    expect(await getCityStore().listCities()).toHaveLength(0);
    expect((await env.registry.getWork("hunt-fail"))?.cityId).toBeUndefined();
    expect((await auditCityProvenance()).orphans).toEqual([]);
  });

  it("失败后重试可以恢复，且最终只有一个城市档案", async () => {
    await seedWork(env.registry, { gameId: "hunt-retry", ownerUserId: owner.id, state: "draft" });

    const restore = breakWorkWrites();
    try {
      await expect(
        attachCityToWork(actor(owner), "hunt-retry", { city: MANILA }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect(await getCityStore().listCities()).toHaveLength(0);

    const retried = await attachCityToWork(actor(owner), "hunt-retry", { city: MANILA });
    expect(retried.created).toBe(true);
    expect(retried.work.cityId).toBe("manila-ph");
    expect(await getCityStore().listCities()).toHaveLength(1);
    expect((await auditCityProvenance()).orphans).toEqual([]);
  });

  it("已存在的城市不会因为另一个作品关联失败而被删除", async () => {
    await seedWork(env.registry, { gameId: "hunt-good", ownerUserId: owner.id, state: "draft" });
    const first = await attachCityToWork(actor(owner), "hunt-good", { city: MANILA });
    expect(first.created).toBe(true);

    await seedWork(env.registry, { gameId: "hunt-bad", ownerUserId: owner.id, state: "draft" });
    const restore = breakWorkWrites();
    try {
      await expect(
        attachCityToWork(actor(owner), "hunt-bad", { city: MANILA }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }

    // The profile is reused, not created, so there is nothing to roll back —
    // and the pack that legitimately owns it must not lose it.
    const store = getCityStore();
    expect(await store.listCities()).toHaveLength(1);
    expect((await store.getCity("manila-ph"))?.sourceGameId).toBe("hunt-good");
    expect((await env.registry.getWork("hunt-good"))?.cityId).toBe("manila-ph");
    expect((await env.registry.getWork("hunt-bad"))?.cityId).toBeUndefined();
  });

  it("无权请求完全不触碰城市存储", async () => {
    const stranger = await seedUser(env.registry, "stranger01", "creator");
    await seedWork(env.registry, { gameId: "hunt-owned", ownerUserId: owner.id, state: "draft" });

    await expect(
      attachCityToWork(actor(stranger), "hunt-owned", { city: MANILA }),
    ).rejects.toMatchObject({ status: 403 });

    expect(await getCityStore().listCities()).toHaveLength(0);
    expect(await getCityStore().listLinks()).toHaveLength(0);
    expect(await listCitiesPublic({ scope: "admin" })).toHaveLength(0);
  });
});
