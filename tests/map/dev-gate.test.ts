import { describe, expect, it } from "vitest";
import { isDevBenchEnabled } from "@/lib/map/dev-gate";

describe("isDevBenchEnabled (server gate for /dev/map-bench)", () => {
  it("denies the Vercel Production shape: NODE_ENV=production, no opt-in flag", () => {
    expect(isDevBenchEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("denies an empty environment", () => {
    expect(isDevBenchEnabled({})).toBe(false);
  });

  it("admits `next dev` without configuration", () => {
    expect(isDevBenchEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("admits an explicit MOS_DEV_BENCH=1 opt-in even in production mode", () => {
    expect(isDevBenchEnabled({ NODE_ENV: "production", MOS_DEV_BENCH: "1" })).toBe(true);
  });

  it("treats values other than exactly '1' as not opted in", () => {
    expect(isDevBenchEnabled({ NODE_ENV: "production", MOS_DEV_BENCH: "true" })).toBe(false);
    expect(isDevBenchEnabled({ NODE_ENV: "production", MOS_DEV_BENCH: "1 " })).toBe(false);
    expect(isDevBenchEnabled({ NODE_ENV: "production", MOS_DEV_BENCH: "" })).toBe(false);
  });
});
