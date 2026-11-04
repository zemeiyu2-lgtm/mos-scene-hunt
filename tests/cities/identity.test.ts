/**
 * City identity rules — pure functions, no I/O.
 *
 * These tests pin the conservative matching policy: exact normalised equality
 * only, country always participates, ambiguity creates rather than guesses.
 */

import { describe, expect, it } from "vitest";
import {
  adminKey,
  cityNameKeys,
  deriveCityId,
  findCityMatch,
  normalizeCityName,
} from "@/lib/cities/identity";
import { CITY_SCHEMA_VERSION, type CityProfile } from "@/lib/cities/types";

function city(overrides: Partial<CityProfile> & Pick<CityProfile, "cityId" | "cityName" | "countryCode">): CityProfile {
  return {
    schemaVersion: CITY_SCHEMA_VERSION,
    countryName: overrides.countryCode,
    localizedNames: {},
    aliases: [],
    status: "active",
    createdAt: "2026-11-04T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
    revision: 0,
    ...overrides,
  };
}

describe("normalizeCityName", () => {
  it("折叠大小写、空白、标点与变音符号", () => {
    expect(normalizeCityName("  St. Louis ")).toBe("st louis");
    expect(normalizeCityName("A Coruña")).toBe("a coruna");
    expect(normalizeCityName("MEXICO   CITY")).toBe("mexico city");
    expect(normalizeCityName("O'Fallon")).toBe("ofallon");
  });

  it("不改动中文名", () => {
    expect(normalizeCityName("马尼拉")).toBe("马尼拉");
    expect(normalizeCityName(" 马尼拉 ")).toBe("马尼拉");
  });
});

describe("cityNameKeys", () => {
  it("主名、多语言名与别名进入同一匹配集合", () => {
    const manila = city({
      cityId: "manila-ph",
      cityName: "马尼拉",
      countryCode: "PH",
      localizedNames: { en: "Manila", fil: "Maynila" },
      aliases: ["Manila City"],
    });
    const keys = cityNameKeys(manila);
    expect(keys.has("马尼拉")).toBe(true);
    expect(keys.has("manila")).toBe(true);
    expect(keys.has("maynila")).toBe(true);
    expect(keys.has("manila city")).toBe(true);
  });
});

describe("findCityMatch", () => {
  const manila = city({
    cityId: "manila-ph",
    cityName: "马尼拉",
    countryCode: "PH",
    localizedNames: { en: "Manila" },
    aliases: ["Maynila"],
  });
  const springfieldUsIl = city({
    cityId: "springfield-us",
    cityName: "Springfield",
    countryCode: "US",
    adminAreaId: "IL",
    adminAreaName: "Illinois",
  });
  const springfieldUsMa = city({
    cityId: "springfield-us-2",
    cityName: "Springfield",
    countryCode: "US",
    adminAreaId: "MA",
    adminAreaName: "Massachusetts",
  });

  it("不同语言的别名指向同一档案", () => {
    const match = findCityMatch([manila], { cityName: "Manila", countryCode: "PH" });
    expect(match.kind).toBe("match");
    if (match.kind === "match") expect(match.city.cityId).toBe("manila-ph");
  });

  it("同名的不同国家城市不会合并", () => {
    const match = findCityMatch([springfieldUsIl], { cityName: "Springfield", countryCode: "CA" });
    expect(match.kind).toBe("none");
  });

  it("同名同国但行政区不同不匹配", () => {
    const match = findCityMatch([springfieldUsIl], {
      cityName: "Springfield",
      countryCode: "US",
      adminAreaId: "MA",
    });
    expect(match.kind).toBe("none");
  });

  it("同名同国且行政区一致时匹配", () => {
    const match = findCityMatch([springfieldUsIl, springfieldUsMa], {
      cityName: "Springfield",
      countryCode: "US",
      adminAreaName: "Illinois",
    });
    expect(match.kind).toBe("match");
    if (match.kind === "match") expect(match.city.cityId).toBe("springfield-us");
  });

  it("缺少行政区且存在多个候选时判定为歧义，不猜", () => {
    const match = findCityMatch([springfieldUsIl, springfieldUsMa], {
      cityName: "Springfield",
      countryCode: "US",
    });
    expect(match.kind).toBe("ambiguous");
  });

  it("相似但不相同的名字不会被自动合并", () => {
    const match = findCityMatch([manila], { cityName: "Manilla", countryCode: "PH" });
    expect(match.kind).toBe("none");
  });

  it("adminKey 优先使用行政区代码", () => {
    expect(adminKey({ adminAreaId: "IL", adminAreaName: "Illinois" })).toBe("id:il");
    expect(adminKey({ adminAreaName: "Metro Manila" })).toBe("name:metro manila");
  });
});

describe("deriveCityId", () => {
  it("拉丁名生成可读 slug", () => {
    expect(deriveCityId({ cityName: "Manila", countryCode: "PH" })).toBe("manila-ph");
    expect(deriveCityId({ cityName: "Mexico City", countryCode: "MX" })).toBe("mexico-city-mx");
  });

  it("中文名优先使用英文名，仍然稳定", () => {
    expect(deriveCityId({ cityName: "马尼拉", countryCode: "PH", localizedNames: { en: "Manila" } })).toBe("manila-ph");
  });

  it("无拉丁名时退化为确定性哈希，不被随机化", () => {
    const first = deriveCityId({ cityName: "吉隆坡", countryCode: "MY" });
    const second = deriveCityId({ cityName: "吉隆坡", countryCode: "MY" });
    expect(first).toBe(second);
    expect(first).toMatch(/^city-[0-9a-f]{8}-my$/);
  });

  it("同城不同写法落到同一个候选 id", () => {
    expect(deriveCityId({ cityName: "St. Louis", countryCode: "US" })).toBe(
      deriveCityId({ cityName: "st louis", countryCode: "US" }),
    );
  });
});
