import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@/lib/game/types";
import { createGameShareUrl, readSharedGameFromUrl } from "@/lib/content/share";

const game: Game = {
  id: "share-test",
  version: "1.0.0",
  title: "分享测试",
  description: "验证游戏分享链接可以往返还原内容。",
  language: "zh-CN",
  startLocation: { lat: 14.58, lng: 120.98 },
  entrySceneId: "start",
  scenes: [
    {
      id: "start",
      title: "起点",
      story: "从这里开始。",
      location: { lat: 14.58, lng: 120.98, radius: 25 },
      nextSceneId: null,
      challenge: { type: "keyword", question: "请输入关键词", answer: "同行" },
      reward: { type: "keyword", title: "线索", value: "同行" },
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { origin: "https://mos-scene-hunt.test", hash: "" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setSharedUrl(url: string) {
  window.location.hash = new URL(url).hash;
}

describe("self-contained game sharing", () => {
  it("creates a share URL that restores the same validated game", async () => {
    const url = await createGameShareUrl(game);
    expect(url).toContain("/select#hunt=");

    setSharedUrl(url);
    const restored = await readSharedGameFromUrl();

    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(game.id);
    expect(restored?.title).toBe(game.title);
    expect(restored?.scenes).toEqual(game.scenes);
  });

  it("returns null for a missing or malformed share payload", async () => {
    window.location.hash = "";
    await expect(readSharedGameFromUrl()).resolves.toBeNull();

    window.location.hash = "#hunt=not-a-valid-payload";
    await expect(readSharedGameFromUrl()).resolves.toBeNull();
  });

  it("uses the uncompressed fallback when CompressionStream is unavailable", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    vi.stubGlobal("DecompressionStream", undefined);

    const url = await createGameShareUrl(game);
    expect(url).toContain("#hunt=j.");

    setSharedUrl(url);
    const restored = await readSharedGameFromUrl();

    expect(restored?.id).toBe(game.id);
    expect(restored?.title).toBe(game.title);
  });
});
