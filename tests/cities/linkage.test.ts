/**
 * Work ↔ city association + publish-state linkage.
 *
 * The matrix under test (real state names, not an invented "pending review"):
 *
 *   draft / submitted / in_review / changes_requested / approved / rejected
 *        → not in the public city index
 *   published            → in the index
 *   unlisted             → OUT of the index, still readable by its link
 *   withdrawn            → out
 *   archived             → out
 *   restore → published  → back in
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCityToWork } from "@/lib/cities/service";
import { listCityPackages, rebuildCityLinks, syncWorkCityLink } from "@/lib/cities/link";
import { getCityStore } from "@/lib/cities/store";
import { applySimpleAction, publishWork, setWorkCity } from "@/lib/registry/service";
import { isPubliclyReadable } from "@/lib/registry/types";
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

/**
 * A city can no longer be conjured out of a name: seed a draft pack, attach,
 * keep the amount of content behind it explicit in every test.
 */
async function cityId(name = "Manila"): Promise<string> {
  seq += 1;
  const gameId = `seed-${String(seq).padStart(3, "0")}`;
  await seedWork(env.registry, { gameId, ownerUserId: owner.id, state: "draft" });
  const result = await attachCityToWork(actor(owner), gameId, {
    city: { cityName: name, countryCode: "PH" },
  });
  return result.city!.cityId;
}

describe("WorkRecord.cityId", () => {
  it("未发布作品可以由作者关联城市，并持久化到作品文档", async () => {
    await seedWork(env.registry, { gameId: "hunt-alpha", ownerUserId: owner.id, state: "approved" });
    const id = await cityId();

    const work = await setWorkCity(actor(owner), "hunt-alpha", id);
    expect(work.cityId).toBe(id);

    const reloaded = await env.registry.getWork("hunt-alpha");
    expect(reloaded?.cityId).toBe(id);
  });

  it("旧探索包没有 cityId 时照常发布与读取，且不产生索引条目", async () => {
    await seedWork(env.registry, { gameId: "hunt-legacy", ownerUserId: owner.id, state: "approved" });
    const published = await publishWork(actor(admin), "hunt-legacy");
    expect(published.state).toBe("published");
    expect(published.cityId).toBeUndefined();
    expect(isPubliclyReadable(published.state)).toBe(true);
    expect(await getCityStore().getLink("hunt-legacy")).toBeNull();
  });

  it("作者不能绕过服务器修改已发布作品的城市归属，管理员可以", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-live", ownerUserId: owner.id, state: "published", cityId: id });
    const other = await cityId("Cebu");

    await expect(setWorkCity(actor(owner), "hunt-live", other)).rejects.toMatchObject({
      status: 403,
      code: "city_change_forbidden",
    });

    const moved = await setWorkCity(actor(admin), "hunt-live", other);
    expect(moved.cityId).toBe(other);
  });

  it("不存在的城市不能形成关联", async () => {
    await seedWork(env.registry, { gameId: "hunt-bad", ownerUserId: owner.id, state: "approved" });
    await expect(setWorkCity(actor(owner), "hunt-bad", "nowhere-xx")).rejects.toMatchObject({
      status: 400,
      code: "city_not_found",
    });
    expect((await env.registry.getWork("hunt-bad"))?.cityId).toBeUndefined();
  });

  it("合并后的城市 id 写入时被解析为存活档案", async () => {
    const { mergeCities } = await import("@/lib/cities/service");
    seq += 1;
    await seedWork(env.registry, { gameId: `seed-a-${seq}`, ownerUserId: owner.id, state: "draft" });
    const a = await attachCityToWork(actor(owner), `seed-a-${seq}`, {
      city: { cityName: "Manila", countryCode: "PH", adminAreaId: "A" },
    });
    seq += 1;
    await seedWork(env.registry, { gameId: `seed-b-${seq}`, ownerUserId: owner.id, state: "draft" });
    const b = await attachCityToWork(actor(owner), `seed-b-${seq}`, {
      city: { cityName: "Manila", countryCode: "PH", adminAreaId: "B" },
    });
    await mergeCities(a.city!.cityId, b.city!.cityId);
    await seedWork(env.registry, { gameId: "hunt-merged", ownerUserId: owner.id, state: "approved" });

    const work = await setWorkCity(actor(owner), "hunt-merged", a.city!.cityId);
    expect(work.cityId).toBe(b.city!.cityId);
  });
});

describe("发布状态联动", () => {
  it("draft 不进入公开索引", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-draft", ownerUserId: owner.id, state: "draft" });
    await setWorkCity(actor(owner), "hunt-draft", id);
    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(0);
  });

  it("published 进入公开索引", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-pub", ownerUserId: owner.id, state: "approved" });
    await setWorkCity(actor(owner), "hunt-pub", id);
    await publishWork(actor(admin), "hunt-pub");

    const listed = await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry });
    expect(listed.map((p) => p.gameId)).toEqual(["hunt-pub"]);
    expect(listed[0].title).toBe("Test hunt");
  });

  it("unlisted 移出公开索引，但有效链接仍可玩", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-unlist", ownerUserId: owner.id, state: "published", cityId: id });
    await syncWorkCityLink((await env.registry.getWork("hunt-unlist"))!, { cityStore: getCityStore(), registry: env.registry });
    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(1);

    const unlisted = await applySimpleAction(actor(admin), "hunt-unlist", "unlist");
    expect(unlisted.state).toBe("unlisted");
    // still readable by direct link is a registry-level guarantee:
    expect(isPubliclyReadable(unlisted.state)).toBe(true);
    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(0);
  });

  it("withdrawn 与 archived 都移出索引", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-wd", ownerUserId: owner.id, state: "published", cityId: id });
    await syncWorkCityLink((await env.registry.getWork("hunt-wd"))!, { cityStore: getCityStore(), registry: env.registry });

    await applySimpleAction(actor(admin), "hunt-wd", "withdraw");
    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(0);

    await applySimpleAction(actor(admin), "hunt-wd", "archive");
    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(0);
  });

  it("恢复发布后重新进入索引", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-restore", ownerUserId: owner.id, state: "published", cityId: id });
    await syncWorkCityLink((await env.registry.getWork("hunt-restore"))!, { cityStore: getCityStore(), registry: env.registry });

    await applySimpleAction(actor(admin), "hunt-restore", "withdraw");
    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(0);

    const restored = await applySimpleAction(actor(admin), "hunt-restore", "restore");
    expect(restored.state).toBe("published");
    const listed = await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry });
    expect(listed.map((p) => p.gameId)).toEqual(["hunt-restore"]);
  });

  it("重复执行状态更新不会产生重复索引记录", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-dup", ownerUserId: owner.id, state: "published", cityId: id });
    const work = (await env.registry.getWork("hunt-dup"))!;
    await syncWorkCityLink(work, { cityStore: getCityStore(), registry: env.registry });
    await syncWorkCityLink(work, { cityStore: getCityStore(), registry: env.registry });
    await publishWork(actor(admin), "hunt-dup");

    const links = (await getCityStore().listLinks()).filter((entry) => entry.gameId === "hunt-dup");
    expect(links).toHaveLength(1);
    const listed = await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry });
    expect(listed).toHaveLength(1);
  });
});

describe("一致性与修复", () => {
  it("索引写入失败时状态仍然生效，之后可重建修复", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-fail", ownerUserId: owner.id, state: "approved" });
    await setWorkCity(actor(owner), "hunt-fail", id);

    const real = getCityStore();
    const failing = {
      ...real,
      putLink: async () => {
        throw new Error("blob unavailable");
      },
    };

    const work = (await env.registry.getWork("hunt-fail"))!;
    expect(await syncWorkCityLink(work, { cityStore: failing, registry: env.registry })).toBe("failed");

    // A missing profile is the other failure mode: the publish must still
    // succeed, and the association must not be silently dropped.
    const { unlink } = await import("node:fs/promises");
    const path = await import("node:path");
    await unlink(path.join(process.env.CITIES_DIR!, "cities", `${id}.json`));

    const published = await publishWork(actor(admin), "hunt-fail");
    expect(published.state).toBe("published");
    expect(published.cityId).toBe(id);
    expect((await real.getLink("hunt-fail"))?.visible ?? false).toBe(false);

    // Repair: restore the profile and rebuild the derived index.
    const recreated = await attachCityToWork(actor(admin), "hunt-fail", {
      city: { cityName: "Manila", countryCode: "PH" },
    });
    expect(recreated.city!.cityId).toBe(id);
    expect(recreated.created).toBe(true);

    const report = await rebuildCityLinks({ cityStore: real, registry: env.registry });
    expect(report.written).toBeGreaterThanOrEqual(1);
    expect(report.failed).toHaveLength(0);

    const listed = await listCityPackages(id, { cityStore: real, registry: env.registry });
    expect(listed.map((p) => p.gameId)).toEqual(["hunt-fail"]);
  });

  it("索引被写错时可重建为 Registry 的真实状态", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-truth", ownerUserId: owner.id, state: "published", cityId: id });
    // Deliberately corrupt: visible link for a work that is actually withdrawn.
    await getCityStore().putLink({
      schemaVersion: 1,
      gameId: "hunt-truth",
      cityId: id,
      title: "stale",
      state: "published",
      visible: true,
      updatedAt: "2026-11-04T00:00:00.000Z",
    });
    const stored = (await env.registry.getWork("hunt-truth"))!;
    await env.registry.putWork({ ...stored, state: "withdrawn", revision: stored.revision + 1 }, stored.revision);

    const report = await rebuildCityLinks({ cityStore: getCityStore(), registry: env.registry });
    // The seed pack behind `cityId()` is already consistent; the corrupted
    // entry is the one that must be rewritten.
    expect(report.failed).toHaveLength(0);
    expect(report.missingCity).toHaveLength(0);

    const link = await getCityStore().getLink("hunt-truth");
    expect(link?.visible).toBe(false);
    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(0);
  });

  it("重建会清除孤儿索引，并报告缺失的城市档案", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-orphan", ownerUserId: owner.id, state: "published", cityId: id });
    await getCityStore().putLink({
      schemaVersion: 1,
      gameId: "hunt-gone",
      cityId: id,
      title: "orphan",
      state: "published",
      visible: true,
      updatedAt: "2026-11-04T00:00:00.000Z",
    });

    const report = await rebuildCityLinks({ cityStore: getCityStore(), registry: env.registry });
    expect(report.deleted).toBe(1);
    expect(await getCityStore().getLink("hunt-gone")).toBeNull();

    // A work pointing at a nonexistent city is reported, never silently dropped.
    const work = (await env.registry.getWork("hunt-orphan"))!;
    const removed = await getCityStore().getCity(id);
    await env.registry.putWork(
      { ...work, cityId: "missing-city", revision: work.revision + 1 },
      work.revision,
    );
    expect(removed).not.toBeNull();
    const second = await rebuildCityLinks({ cityStore: getCityStore(), registry: env.registry });
    expect(second.missingCity.map((entry) => entry.gameId)).toContain("hunt-orphan");
  });

  it("陈旧索引不会让非法状态的作品出现在公开列表", async () => {
    const id = await cityId();
    await seedWork(env.registry, { gameId: "hunt-stale", ownerUserId: owner.id, state: "published", cityId: id });
    await getCityStore().putLink({
      schemaVersion: 1,
      gameId: "hunt-stale",
      cityId: id,
      title: "Test hunt",
      state: "published",
      visible: true,
      updatedAt: "2026-11-04T00:00:00.000Z",
    });
    // Registry moved on without the index being updated.
    const work = (await env.registry.getWork("hunt-stale"))!;
    await env.registry.putWork({ ...work, state: "unlisted", revision: work.revision + 1 }, work.revision);

    expect(await listCityPackages(id, { cityStore: getCityStore(), registry: env.registry })).toHaveLength(0);
  });
});
