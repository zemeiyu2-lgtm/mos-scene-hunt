// @vitest-environment jsdom
/**
 * 本机存储面板的界面契约。
 *
 * These tests exist because the panel is what the author actually reads before
 * deciding to delete something, and a wrong sentence here costs real data:
 *
 *   - it must name the pack and say the published game is untouched;
 *   - it must never print a quota it did not get from the browser;
 *   - "删除本地副本" must only remove that one key, and must not send any
 *     request that could delete or unpublish anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { LocalPackPanel } from "@/components/local-pack-panel";
import type { Game } from "@/lib/game/types";

const KEY_PREFIX = "mos-scene-hunt:authoring:";

function makeGame(id: string, title: string): Game {
  return {
    id,
    language: "zh-CN",
    title,
    description: "面板测试",
    version: "0.1.0",
    startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
    huntArea: {
      center: { lat: 14.58305, lng: 120.97936 },
      radiusMeters: 300,
      shape: "circle",
      name: "区域",
    },
    entrySceneId: "s1",
    scenes: [
      {
        id: "s1",
        title: "第一站",
        story: "故事",
        location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "第一站" },
        nextSceneId: null,
        challenge: { type: "choice", question: "选哪个？", options: ["甲", "乙"], answer: 0 },
        reward: { type: "keyword", title: "线索", value: "线索" },
      },
    ],
  };
}

/** A published-looking response: headers only, body cancelled. */
function publishedResponse(versionId: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "X-Game-Version": versionId }),
    body: { cancel: () => Promise.resolve() },
  } as unknown as Response;
}

const notFoundResponse = {
  ok: false,
  status: 404,
  headers: new Headers(),
  body: { cancel: () => Promise.resolve() },
} as unknown as Response;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(KEY_PREFIX + "local-one", JSON.stringify(makeGame("local-one", "本机游戏甲")));
  window.localStorage.setItem(KEY_PREFIX + "local-two", JSON.stringify(makeGame("local-two", "本机游戏乙")));
  globalThis.fetch = vi.fn(async () => notFoundResponse) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("存储面板", () => {
  it("列出本机游戏包数量、名称与各自大小", async () => {
    render(<LocalPackPanel />);
    await waitFor(() =>
      expect(screen.getByText(/本地游戏包：2 个，占用约/)).toBeTruthy(),
    );
    expect(screen.getByText("本机游戏甲")).toBeTruthy();
    expect(screen.getByText("本机游戏乙")).toBeTruthy();
    // Per-pack size is shown in the same line as the scene count.
    expect(screen.getAllByText(/个体验点 · 约\s[\d.]+\s(KB|MB|B)/).length).toBe(2);
  });

  it("浏览器不给容量估算时不编造额度，只说明无法估算", async () => {
    render(<LocalPackPanel />);
    await waitFor(() => expect(screen.getByText(/没有提供容量估算接口/)).toBeTruthy());
    expect(screen.queryByText(/浏览器额度（估算）/)).toBeNull();
  });

  it("查询线上状态：已发布与未发布分开显示", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("local-one") ? publishedResponse("0123456789abcdef") : notFoundResponse,
    ) as unknown as typeof fetch;

    render(<LocalPackPanel />);
    await waitFor(() => expect(screen.getByText("线上已发布")).toBeTruthy());
    expect(screen.getByText("线上未发布")).toBeTruthy();
  });

  it("网络不可用时显示「线上状态未知」，而不是猜测", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    render(<LocalPackPanel />);
    await waitFor(() => expect(screen.getAllByText("线上状态未知").length).toBe(2));
  });

  it("确认框写明游戏名、只删本机、线上不受影响（已发布的情形）", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("local-one") ? publishedResponse("0123456789abcdef") : notFoundResponse,
    ) as unknown as typeof fetch;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LocalPackPanel />);
    await waitFor(() => expect(screen.getByText("线上已发布")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("本机游戏甲")).toBeTruthy());

    const firstCard = screen.getByText("本机游戏甲").closest("div.rounded-xl") as HTMLElement;
    within(firstCard).getByRole("button", { name: "删除本地副本" }).click();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const text = confirmSpy.mock.calls[0][0] as string;
    expect(text).toContain("本机游戏甲");
    expect(text).toContain("只会删除这台设备当前浏览器里的副本");
    expect(text).toContain("这个游戏已发布到线上");
    expect(text).toContain("线上版本、分享链接和二维码都不会受影响");
  });

  it("线上状态未知时，确认框仍然声明线上不受影响", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LocalPackPanel />);
    await waitFor(() => expect(screen.getAllByText("线上状态未知").length).toBe(2));

    const firstCard = screen.getByText("本机游戏甲").closest("div.rounded-xl") as HTMLElement;
    within(firstCard).getByRole("button", { name: "删除本地副本" }).click();

    const text = confirmSpy.mock.calls[0][0] as string;
    expect(text).toContain("无法确认它是否已发布到线上");
    expect(text).toContain("线上版本、分享链接和二维码也不会受影响");
  });

  it("取消确认时不删除任何东西", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LocalPackPanel />);
    await waitFor(() => expect(screen.getByText("本机游戏甲")).toBeTruthy());
    const card = screen.getByText("本机游戏甲").closest("div.rounded-xl") as HTMLElement;
    within(card).getByRole("button", { name: "删除本地副本" }).click();
    expect(window.localStorage.getItem(KEY_PREFIX + "local-one")).not.toBeNull();
  });

  it("确认后只删这一份，列表与占用立刻刷新，且不发出任何写请求", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchSpy = vi.fn(async () => notFoundResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<LocalPackPanel />);
    await waitFor(() => expect(screen.getByText("本机游戏甲")).toBeTruthy());

    const card = screen.getByText("本机游戏甲").closest("div.rounded-xl") as HTMLElement;
    within(card).getByRole("button", { name: "删除本地副本" }).click();

    await waitFor(() => expect(screen.queryByText("本机游戏甲")).toBeNull());
    expect(screen.getByText("本机游戏乙")).toBeTruthy();
    expect(window.localStorage.getItem(KEY_PREFIX + "local-one")).toBeNull();
    expect(window.localStorage.getItem(KEY_PREFIX + "local-two")).not.toBeNull();
    await waitFor(() => expect(screen.getByText(/本地游戏包：1 个/)).toBeTruthy());

    // Every request this panel makes is a read of /api/games/<id>.
    const calls = fetchSpy.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
    for (const [input, init] of calls) {
      expect(String(input)).toMatch(/^\/api\/games\//);
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("删除结果会被回报给调用方（编辑器据此丢掉草稿）", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDeleted = vi.fn();
    render(<LocalPackPanel onDeleted={onDeleted} />);
    await waitFor(() => expect(screen.getByText("本机游戏甲")).toBeTruthy());

    const card = screen.getByText("本机游戏甲").closest("div.rounded-xl") as HTMLElement;
    within(card).getByRole("button", { name: "删除本地副本" }).click();

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onDeleted.mock.calls[0][0]).toMatchObject({ ok: true, id: "local-one" });
  });
});
