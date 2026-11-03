import { describe, expect, it } from "vitest";

import {
  GEOAPIFY_STYLES,
  classifyGeoapifyFailure,
  describeGeoapifyBlock,
  geoapifyTileUrl,
  getGeoapifyConfig,
} from "@/lib/map/geoapify";

describe("getGeoapifyConfig", () => {
  it("returns null without a key — never a placeholder key", () => {
    expect(getGeoapifyConfig("", null)).toBeNull();
    expect(getGeoapifyConfig(null, null)).toBeNull();
    expect(getGeoapifyConfig("   ", null)).toBeNull();
  });

  it("normalises the style id", () => {
    expect(getGeoapifyConfig("key", "positron")?.style).toBe("positron");
    expect(getGeoapifyConfig("key", "bogus")?.style).toBe("osm-bright");
    expect(GEOAPIFY_STYLES.length).toBeGreaterThanOrEqual(4);
  });
});

describe("geoapifyTileUrl", () => {
  it("matches the documented raster endpoint", () => {
    expect(geoapifyTileUrl("osm-bright", "k1")).toBe(
      "https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=k1",
    );
  });
});

describe("classifyGeoapifyFailure", () => {
  it("maps real observed status codes to user-facing causes", () => {
    // Observed live: GET style.json without key → 401 {"message":"Invalid apiKey"}
    expect(classifyGeoapifyFailure(401, '{"statusCode":401,"message":"Invalid apiKey"}')).toBe(
      "invalid-key",
    );
    expect(classifyGeoapifyFailure(403, "")).toBe("plan-restricted");
    expect(classifyGeoapifyFailure(402, "")).toBe("plan-restricted");
    expect(classifyGeoapifyFailure(429, "")).toBe("quota-exceeded");
    expect(classifyGeoapifyFailure(503, "")).toBe("service-error");
    expect(classifyGeoapifyFailure(200, "")).toBeNull();
  });

  it("describes every block reason", () => {
    for (const reason of ["missing-key", "invalid-key", "quota-exceeded", "plan-restricted", "service-error", null]) {
      expect(describeGeoapifyBlock(reason).length).toBeGreaterThan(4);
    }
  });
});
