import { beforeEach, describe, expect, it, vi } from "vitest";
import { BSOP_CLASSIC_TEMPLATE } from "@/lib/game/templates";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  get: vi.fn(),
}));

import { put, get } from "@vercel/blob";
import { POST } from "@/app/api/shares/route";
import { GET } from "@/app/api/shares/[id]/route";

const shareId = "AbCdEf0123456789";
const game = {
  ...structuredClone(BSOP_CLASSIC_TEMPLATE),
  id: "share-api-test",
  title: "短链接接口测试游戏",
  scenes: [
    {
      ...structuredClone(BSOP_CLASSIC_TEMPLATE.scenes[0]),
      id: "only-scene",
      nextSceneId: null,
    },
  ],
  entrySceneId: "only-scene",
};

describe("cloud share API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates and stores a game, then returns a short path", async () => {
    const response = await POST(
      new Request("https://example.test/api/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ game }),
      }),
    );

    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(result.path).toBe(`/s/${result.id}`);
    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(
      `shares/${result.id}.json`,
      expect.stringContaining("短链接接口测试游戏"),
      expect.objectContaining({ access: "private", addRandomSuffix: false }),
    );
  });

  it("rejects a request without a game and does not write to storage", async () => {
    const response = await POST(
      new Request("https://example.test/api/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it("loads and validates a stored game for a valid share id", async () => {
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([JSON.stringify(game)]).stream(),
    } as Awaited<ReturnType<typeof get>>);

    const response = await GET(new Request("https://example.test/api/shares/" + shareId), {
      params: Promise.resolve({ id: shareId }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).game.title).toBe("短链接接口测试游戏");
    expect(get).toHaveBeenCalledWith(`shares/${shareId}.json`, { access: "private" });
  });

  it("returns 404 for malformed share ids without reading storage", async () => {
    const response = await GET(new Request("https://example.test/api/shares/bad"), {
      params: Promise.resolve({ id: "bad" }),
    });

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
});
