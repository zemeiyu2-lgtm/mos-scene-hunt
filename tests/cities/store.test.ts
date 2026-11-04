/**
 * City store adapter: create-if-absent, revision-checked updates, idempotent
 * link upserts. The race-critical property is that the SECOND exclusive create
 * loses — that is what makes concurrent city creation converge on one profile.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileCityStore, type CityStore } from "@/lib/cities/store";
import { CITY_SCHEMA_VERSION, type CityProfile } from "@/lib/cities/types";

let root: string;
let store: CityStore;

const baseCity = (id = "manila-ph"): CityProfile => ({
  schemaVersion: CITY_SCHEMA_VERSION,
  cityId: id,
  countryCode: "PH",
  countryName: "Philippines",
  cityName: "Manila",
  localizedNames: { en: "Manila" },
  aliases: [],
  status: "active",
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
  revision: 0,
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mos-city-store-"));
  store = createFileCityStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("城市档案存储", () => {
  it("createCity 是「不存在才创建」", async () => {
    const first = await store.createCity(baseCity());
    expect(first.ok).toBe(true);
    const second = await store.createCity({ ...baseCity(), cityName: "Other" });
    expect(second.ok).toBe(false);
    expect(second.conflict).toBe(true);

    const stored = await store.getCity("manila-ph");
    expect(stored?.cityName).toBe("Manila");
    expect(await store.listCities()).toHaveLength(1);
  });

  it("并发 createCity 只有一个成功", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => store.createCity({ ...baseCity(), cityName: `Manila ${index}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await store.listCities()).toHaveLength(1);
  });

  it("putCity 需要匹配 revision", async () => {
    await store.createCity(baseCity());
    const stored = (await store.getCity("manila-ph"))!;

    const stale = await store.putCity({ ...stored, cityName: "Stale", revision: 1 }, 5);
    expect(stale.ok).toBe(false);

    const ok = await store.putCity({ ...stored, cityName: "Manila City", revision: 1 }, 0);
    expect(ok.ok).toBe(true);
    expect((await store.getCity("manila-ph"))?.cityName).toBe("Manila City");
  });

  it("损坏的档案不会被读取为有效城市", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "cities"), { recursive: true });
    await writeFile(path.join(root, "cities", "broken-xx.json"), "{ not json", "utf8");
    expect(await store.getCity("broken-xx")).toBeNull();
    expect(await store.listCities()).toHaveLength(0);
  });
});

describe("城市-作品索引存储", () => {
  const link = (gameId: string, visible = true) => ({
    schemaVersion: CITY_SCHEMA_VERSION,
    gameId,
    cityId: "manila-ph",
    title: "t",
    state: visible ? "published" : "withdrawn",
    visible,
    updatedAt: "2026-11-04T00:00:00.000Z",
  });

  it("putLink 以 gameId 为键幂等覆盖", async () => {
    await store.putLink(link("hunt-1"));
    await store.putLink(link("hunt-1"));
    expect(await store.listLinks()).toHaveLength(1);

    await store.putLink(link("hunt-1", false));
    const stored = await store.getLink("hunt-1");
    expect(stored?.visible).toBe(false);
    expect(await store.listLinks()).toHaveLength(1);
  });

  it("deleteLink 可重复调用", async () => {
    await store.putLink(link("hunt-2"));
    await store.deleteLink("hunt-2");
    await store.deleteLink("hunt-2");
    expect(await store.getLink("hunt-2")).toBeNull();
  });

  it("不同作品各自一条，互不覆盖", async () => {
    await store.putLink(link("hunt-a"));
    await store.putLink(link("hunt-b"));
    expect((await store.listLinks()).map((entry) => entry.gameId).sort()).toEqual(["hunt-a", "hunt-b"]);
  });
});
