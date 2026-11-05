import { describe, expect, it } from "vitest";
import { CLOUD_CATALOG } from "@/lib/cloud/catalog";
import type { ExploreSource } from "@/lib/explore/service";
import { listPublicExplorePacks, publicEntries } from "@/lib/explore/service";
import { availableCities } from "@/lib/explore/summary";
const ids = ["mos-ph-mnl-intramuros-01","mos-ph-mnl-rizal-park-01","mos-ph-mnl-arroceros-01","mos-ph-cebu-fort-san-pedro-01","mos-ph-cebu-tops-lookout-01","mos-ph-baguio-botanical-garden-01","mos-ph-baguio-burnham-park-01","mos-ph-davao-magsaysay-park-01","mos-ph-davao-peoples-park-01","mos-ph-davao-chinatown-01"];
const fixture = (id: string) => JSON.stringify({ id, title: "公开探索包 " + id, description: "用于目录读取测试。", language: "zh-CN", scenes: [{ id: "s1", title: "第一站", story: "现场观察", location: { lat: 1, lng: 1, radius: 15 } }] });
describe("Philippines ten-pack production catalogue", () => {
  it("publishes the ten existing immutable versions without changing their IDs", () => {
    const entries = CLOUD_CATALOG.games.filter((entry) => ids.includes(entry.id));
    expect(entries).toHaveLength(10);
    expect(entries.every((entry) => entry.status === "published")).toBe(true);
    expect(entries.every((entry) => /^[0-9a-f]{16}$/.test(entry.versionId ?? ""))).toBe(true);
    expect(publicEntries(CLOUD_CATALOG)).toHaveLength(11);
  });
  it("reads exact catalogue versions and derives only four cities from the ten public packs", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const source: ExploreSource = { catalog: CLOUD_CATALOG, readPackFile: async (file, versionId) => { calls.push([file, versionId]); return fixture(file.slice(0, -5)); } };
    const packs = await listPublicExplorePacks(source);
    const philippines = packs.filter((pack) => ids.includes(pack.gameId));
    expect(philippines).toHaveLength(10);
    expect(philippines.every((pack) => Boolean(pack.versionId))).toBe(true);
    expect(calls.filter(([file, version]) => ids.includes(file.slice(0, -5)) && Boolean(version))).toHaveLength(10);
    const cities = availableCities(philippines).map((city) => [city.cityId, city.count]).sort();
    expect(cities).toEqual([["baguio-ph", 2], ["cebu-city-ph", 2], ["davao-city-ph", 3], ["manila-ph", 3]]);
  });
});