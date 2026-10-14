import { afterEach, describe, expect, it, vi } from "vitest";
import { BSOP_CLASSIC_TEMPLATE } from "@/lib/game/templates";
import { loadGame } from "@/lib/content";
import { createGameShareUrl, MAX_QR_URL_LENGTH, readSharedGameFromUrl } from "@/lib/content/share";
import { validateGame } from "@/lib/game/types";

const fakeWindow = {
  location: {
    origin: "https://scene-hunt.example",
    hash: "",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  fakeWindow.location.hash = "";
});

describe("self-contained game sharing", () => {
  it("encodes a game into a QR-compatible share URL and restores it through the real content loader", async () => {
    vi.stubGlobal("window", fakeWindow);
    const game = structuredClone(BSOP_CLASSIC_TEMPLATE);
    game.title = "分享测试：神学院的八个秘密";

    const url = await createGameShareUrl(game);
    expect(url.startsWith("https://scene-hunt.example/select#hunt=")).toBe(true);
    // Keep the built-in eight-scene template within the UI's QR-generation limit.
    // If future content changes push this above the limit, CI should flag the regression.
    expect(url.length).toBeLessThanOrEqual(MAX_QR_URL_LENGTH);

    fakeWindow.location.hash = url.slice(url.indexOf("#"));
    const restored = await readSharedGameFromUrl();

    expect(restored).toEqual(validateGame(game).game);
    expect(restored?.title).toBe("分享测试：神学院的八个秘密");

    // The receiver must get the game from the URL even when a different game ID
    // is requested; this proves the real app loader honors self-contained links.
    const loaded = await loadGame("some-other-game");
    expect(loaded.source).toBe("shared");
    expect(loaded.game).toEqual(validateGame(game).game);
  });

  it("uses the uncompressed fallback when CompressionStream is unavailable", async () => {
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("CompressionStream", undefined);
    vi.stubGlobal("DecompressionStream", undefined);

    const game = structuredClone(BSOP_CLASSIC_TEMPLATE);
    game.title = "无压缩环境分享测试";

    const url = await createGameShareUrl(game);
    expect(url).toContain("#hunt=j.");

    fakeWindow.location.hash = url.slice(url.indexOf("#"));
    await expect(readSharedGameFromUrl()).resolves.toEqual(validateGame(game).game);
  });

  it("returns null for unrelated or malformed share fragments", async () => {
    vi.stubGlobal("window", fakeWindow);

    fakeWindow.location.hash = "#ordinary-anchor";
    await expect(readSharedGameFromUrl()).resolves.toBeNull();

    fakeWindow.location.hash = "#hunt=g.not-valid-base64-json";
    await expect(readSharedGameFromUrl()).resolves.toBeNull();
  });

  it("returns null when no browser window exists", async () => {
    vi.stubGlobal("window", undefined);
    await expect(readSharedGameFromUrl()).resolves.toBeNull();
    await expect(createGameShareUrl(BSOP_CLASSIC_TEMPLATE)).rejects.toThrow("分享链接只能在浏览器中生成");
  });
});


describe("QR URL capacity", () => {
  it("allows a larger but still practical QR URL budget", () => {
    expect(MAX_QR_URL_LENGTH).toBe(2900);
    expect(MAX_QR_URL_LENGTH).toBeGreaterThan(2600);
  });
});
