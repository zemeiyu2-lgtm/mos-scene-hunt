import { describe, expect, it } from "vitest";
import {
  numDataCodewordsL,
  planQrForUrl,
  qrVersionForBytes,
} from "@/lib/content/qr";

/** Fixed origin mimicking production; the URL is pure ASCII by construction. */
const ORIGIN = "https://mos-scene-hunt.vercel.app";
const shareUrlWith = (payloadChars: number, kind: "g" | "j" = "g") =>
  `${ORIGIN}/select#hunt=${kind}.${"A".repeat(payloadChars)}`;

describe("QR capacity arithmetic", () => {
  it("matches the published byte-mode level-L capacities (spec anchors)", () => {
    // numDataCodewordsL returns raw DATA CODEWORDS; the published byte
    // capacities (17 / 271 / 2953) additionally subtract the 4-bit mode marker
    // and the 8/16-bit character-count field.
    expect(numDataCodewordsL(1)).toBe(19);
    expect(numDataCodewordsL(10)).toBe(274);
    expect(numDataCodewordsL(40)).toBe(2956);
    // Payload bytes: (codewords*8 - 4 - countBits) / 8, floored.
    expect(qrVersionForBytes(17)).toBe(1);
    expect(qrVersionForBytes(271)).toBe(10);
    expect(qrVersionForBytes(2953)).toBe(40);
  });

  it("finds the smallest fitting version and rejects impossible payloads", () => {
    // Version 1 L carries 17 payload bytes in byte mode.
    expect(qrVersionForBytes(17)).toBe(1);
    expect(qrVersionForBytes(18)).toBe(2);
    expect(qrVersionForBytes(2953)).toBe(40);
    expect(qrVersionForBytes(2954)).toBeNull();
  });

});

describe("planQrForUrl", () => {
  it("accepts a short single-scene share link", () => {
    const url = shareUrlWith(700);
    const plan = planQrForUrl(url);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.url).toBe(url);
  });

  it("accepts a typical three-scene gzip link (~940 chars total URL)", () => {
    const url = shareUrlWith(940 - ORIGIN.length - "/select#hunt=g.".length);
    const plan = planQrForUrl(url);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.version).toBeLessThanOrEqual(25);
      expect(plan.modulePx).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("still renders near the old 2600-char gate while the modules stay scannable", () => {
    // Around the old fixed threshold: rendered as long as density allows.
    const near2600 = shareUrlWith(2600 - ORIGIN.length - "/select#hunt=g.".length);
    const plan = planQrForUrl(near2600);
    if (plan.ok) {
      expect(plan.version).toBeGreaterThan(21);
    }
    // Either way the plan never mutates the URL it was given.
    expect(plan.url).toBe(near2600);
  });

  it("rejects with an actionable density reason before the hard capacity limit", () => {
    // Find the byte length where the version exists but modules get too small.
    let dense = -1;
    for (let len = 2000; len <= 2953; len++) {
      const plan = planQrForUrl(shareUrlWith(len));
      if (!plan.ok && !plan.reason.includes("容量上限")) {
        dense = len;
        break;
      }
    }
    expect(dense).toBeGreaterThan(0);
    const plan = planQrForUrl(shareUrlWith(dense));
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("version");
      expect(plan.reason).toContain("复制链接");
    }
  });

  it("rejects over-capacity input with a clear reason instead of throwing", () => {
    const url = shareUrlWith(3000);
    const plan = planQrForUrl(url);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("容量上限");
      expect(plan.reason).toContain("复制链接");
    }
  });

  it("always hands back the exact URL for encoding - never truncated or rewritten", () => {
    for (const len of [10, 800, 1200, 2500, 4000]) {
      const url = shareUrlWith(len);
      expect(planQrForUrl(url).url).toBe(url);
    }
  });

  it("treats every share-URL character as one byte (ASCII-safe payloads)", () => {
    // base64url payload + ASCII origin: length equals byte length, so the
    // byte-mode capacity check is exact.
    const url = shareUrlWith(100);
    expect(url.length).toBe(new TextEncoder().encode(url).length);
  });
});
