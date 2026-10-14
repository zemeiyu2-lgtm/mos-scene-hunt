import { afterEach, describe, expect, it, vi } from "vitest";
import { BSOP_CLASSIC_TEMPLATE } from "@/lib/game/templates";
import { createGameShareUrl, readSharedGameFromUrl } from "@/lib/content/share";
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
  it("encodes a game into a share URL and restores the same validated game", async () => {
    vi.stubGlobal("window", fakeWindow);
    const game = structuredClone(BSOP_CLASSIC_TEMPLATE);
    game.title = "分享测试：神学院的八个秘密";

    const url = await createGameShareUrl(game);
    expect(url.startsWith("https://scene-hunt.example/select#hunt=")).toBe(true);

    fakeWindow.location.hash = url.slice(url.indexOf("#"));
    const restored = await readSharedGameFromUrl();

    expect(restored).toEqual(validateGame(game).game);
    expect(restored?.title).toBe("分享测试：神学院的八个秘密");
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
