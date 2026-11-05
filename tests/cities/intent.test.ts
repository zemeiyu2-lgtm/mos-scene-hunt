/**
 * Five-state city intent + the server-side publish gate.
 *
 * These tests are the contract for D1: the decision is a server fact, only
 * `pending` blocks publishing, and a failed association is never allowed to
 * masquerade as "skipped".
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyWorkEvent } from "@/lib/registry/state-machine";
import { publishWork, setCityIntent } from "@/lib/registry/service";
import { getRegistry } from "@/lib/registry/store";
import type { CityTestEnv } from "./setup";
import { actor, seedUser, seedWork, setupCityEnv } from "./setup";

let env: CityTestEnv;
let creator: Awaited<ReturnType<typeof seedUser>>;

const NOW = "2026-11-04T10:00:00.000Z";

beforeEach(async () => {
  env = await setupCityEnv();
  creator = await seedUser(env.registry, "creator-a");
});

afterEach(async () => {
  await env.cleanup();
});

describe("五态意图", () => {
  it("未决定：没有 cityId 也没有 cityIntent", async () => {
    const work = await seedWork(env.registry, { gameId: "hunt-1", ownerUserId: creator.id, state: "draft" });
    expect(work.cityId).toBeUndefined();
    expect(work.cityIntent).toBeUndefined();
  });

  it("select 写入 pending，不创建城市、不写 cityId", async () => {
    await seedWork(env.registry, { gameId: "hunt-2", ownerUserId: creator.id, state: "draft" });
    const updated = await setCityIntent(actor(creator), "hunt-2", {
      mode: "pending",
      cityId: "manila-ph",
      cityName: "Manila",
      countryCode: "PH",
      attempts: 0,
      lastError: null,
      at: NOW,
    });
    expect(updated.cityIntent?.mode).toBe("pending");
    expect(updated.cityId).toBeUndefined();
    const cities = await (await import("@/lib/cities/store")).getCityStore().listCities();
    expect(cities).toHaveLength(0);
  });

  it("同一决定重复提交不写库（幂等）", async () => {
    await seedWork(env.registry, { gameId: "hunt-3", ownerUserId: creator.id, state: "draft" });
    const intent = { mode: "pending" as const, cityId: "manila-ph", attempts: 0, at: NOW };
    const first = await setCityIntent(actor(creator), "hunt-3", intent);
    const second = await setCityIntent(actor(creator), "hunt-3", { ...intent, at: "2026-11-04T11:00:00.000Z" });
    // `changed: false` path keeps the stored revision untouched.
    expect(second.revision).toBe(first.revision);
  });

  it("skip 与 pending 是不同状态，不能互相推断", async () => {
    await seedWork(env.registry, { gameId: "hunt-4", ownerUserId: creator.id, state: "draft" });
    const skipped = await setCityIntent(actor(creator), "hunt-4", { mode: "skipped", attempts: 0, at: NOW });
    expect(skipped.cityIntent?.mode).toBe("skipped");
    expect(skipped.cityIntent?.cityId).toBeUndefined();
  });
});

describe("发布闸门", () => {
  it("pending 拦截发布，返回 city_link_pending 且不改状态", async () => {
    await seedWork(env.registry, {
      gameId: "hunt-5",
      ownerUserId: creator.id,
      state: "approved",
      withApprovedVersion: true,
    });
    await setCityIntent(actor(creator), "hunt-5", {
      mode: "pending",
      cityId: "manila-ph",
      attempts: 0,
      at: NOW,
    });
    await expect(publishWork(actor(adminOf(creator)), "hunt-5")).rejects.toMatchObject({
      status: 409,
      code: "city_link_pending",
    });
    const after = await getRegistry().getWork("hunt-5");
    expect(after?.state).toBe("approved");
    expect(after?.publishedVersionId).toBe("v1");
  });

  it("skipped 不拦截发布", async () => {
    await seedWork(env.registry, { gameId: "hunt-6", ownerUserId: creator.id, state: "approved", withApprovedVersion: true });
    await setCityIntent(actor(creator), "hunt-6", { mode: "skipped", attempts: 0, at: NOW });
    const published = await publishWork(actor(adminOf(creator)), "hunt-6");
    expect(published.state).toBe("published");
  });

  it("未决定不拦截发布", async () => {
    await seedWork(env.registry, { gameId: "hunt-7", ownerUserId: creator.id, state: "approved", withApprovedVersion: true });
    const published = await publishWork(actor(adminOf(creator)), "hunt-7");
    expect(published.state).toBe("published");
  });

  it("关联成功后意图被清除（已关联态）", async () => {
    const work = await seedWork(env.registry, { gameId: "hunt-8", ownerUserId: creator.id, state: "draft" });
    const withIntent = {
      ...work,
      cityIntent: { mode: "pending" as const, cityId: "manila-ph", attempts: 1, at: NOW },
    };
    const result = applyWorkEvent(withIntent, { type: "set_city", cityId: "manila-ph", actorUserId: creator.id, actorRole: "creator" }, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.work.cityId).toBe("manila-ph");
    expect(result.work.cityIntent).toBeUndefined();
  });
});

/** The gate is a server rule, so publishing is attempted by an admin actor. */
function adminOf(record: { id: string }) {
  return {
    id: record.id,
    email: "admin@example.com",
    passwordHash: "x",
    passwordSalt: "y",
    displayName: "admin",
    role: "admin" as const,
    status: "active" as const,
    createdAt: NOW,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  };
}
