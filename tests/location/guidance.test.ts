/**
 * Platform-aware permission guidance (lib/location/guidance.ts).
 *
 * The regression this pins: every player used to be told to open "the site
 * settings in the address bar", which is a Chrome/Android-only path. An iPhone
 * player following that advice finds nothing, taps "重新请求定位" repeatedly and
 * concludes the game is broken (B-02 UX-02).
 */

import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  locationServiceGuide,
  permissionRecoveryGuide,
  usesSystemSettingsForLocation,
} from "@/lib/location/guidance";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/123.0 Mobile/15E148 Safari/605.1.15",
  ipadDesktopUa:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it("identifies iOS Safari and does not mistake it for Android Chrome", () => {
    expect(detectPlatform({ userAgent: UA.iphoneSafari })).toBe("ios-safari");
  });

  it("distinguishes iOS Chrome / Firefox from iOS Safari", () => {
    expect(detectPlatform({ userAgent: UA.iphoneChrome })).toBe("ios-chrome");
    expect(detectPlatform({ userAgent: UA.iphoneFirefox })).toBe("ios-firefox");
  });

  it("detects iPadOS 13+ from a desktop UA with touch points", () => {
    expect(
      detectPlatform({ userAgent: UA.ipadDesktopUa, platform: "MacIntel", maxTouchPoints: 5 }),
    ).toBe("ios-safari");
    // A real Mac (no touch) must stay desktop.
    expect(
      detectPlatform({ userAgent: UA.ipadDesktopUa, platform: "MacIntel", maxTouchPoints: 0 }),
    ).toBe("desktop");
  });

  it("identifies Android Chrome and other Android browsers", () => {
    expect(detectPlatform({ userAgent: UA.androidChrome })).toBe("android-chrome");
    expect(detectPlatform({ userAgent: UA.androidSamsung })).toBe("android-other");
  });

  it("falls back to desktop, and to unknown without a UA", () => {
    expect(detectPlatform({ userAgent: UA.desktopChrome })).toBe("desktop");
    expect(detectPlatform({ userAgent: "" })).toBe("unknown");
  });
});

describe("permissionRecoveryGuide", () => {
  it("sends iOS players to the system Settings app, never to the address bar", () => {
    for (const platform of ["ios-safari", "ios-chrome", "ios-firefox", "ios-other"] as const) {
      const guide = permissionRecoveryGuide(platform);
      const text = [guide.title, guide.note ?? "", ...guide.steps].join(" ");
      expect(text).toContain("设置");
      expect(text).not.toContain("地址栏");
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
    }
    expect(usesSystemSettingsForLocation("ios-safari")).toBe(true);
    expect(usesSystemSettingsForLocation("android-chrome")).toBe(false);
  });

  it("keeps the address-bar path for Android Chrome and desktop", () => {
    expect(permissionRecoveryGuide("android-chrome").steps.join(" ")).toContain("地址栏");
    expect(permissionRecoveryGuide("desktop").steps.join(" ")).toContain("地址栏");
  });

  it("gives an unknown platform a path that covers both worlds", () => {
    const guide = permissionRecoveryGuide("unknown");
    const text = guide.steps.join(" ");
    expect(text).toContain("站点设置");
    expect(text).toContain("设置");
  });

  it("never promises an automatic prompt (browsers cannot re-prompt after denial)", () => {
    for (const platform of ["ios-safari", "ios-chrome", "android-chrome", "unknown"] as const) {
      const text = permissionRecoveryGuide(platform).steps.join(" ");
      expect(text).not.toContain("自动弹出");
    }
    expect(permissionRecoveryGuide("ios-safari").note).toContain("不会再次自动弹出");
  });
});

describe("locationServiceGuide", () => {
  it("points at the platform's own location switch", () => {
    expect(locationServiceGuide("ios-safari").steps.join(" ")).toContain("隐私与安全性");
    expect(locationServiceGuide("android-chrome").steps.join(" ")).toContain("位置信息");
    expect(locationServiceGuide("desktop").steps.join(" ")).toContain("位置");
  });
});
