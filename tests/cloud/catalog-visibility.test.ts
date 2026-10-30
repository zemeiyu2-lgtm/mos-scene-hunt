/**
 * 「后台发布 → 游戏中心可见」闭环契约测试。
 *
 * 此前这条链路只有注释和一次手工验证，没有回归保护。这里直接调用真实路由
 * handler（catalog.json 路由 + /api/games/[gameId]），跑完整的
 * 提交 → 认领 → 审核通过 → 发布 → 撤下/隐藏 流程，断言：
 *
 *  1. 只有 state === "published" 的作品才会出现在玩家目录里；
 *  2. 目录条目与读端点必须一致——目录说要下载的地址，读端点必须真能读到；
 *  3. unlisted 可以直链游玩，但不得被目录广告；
 *  4. 新提交（未审核）不改变玩家已经看到的内容；
 *  5. 目录里 repo 内置包与 registry 作品合并后 id 不重复。
 *
 * 这些用例同时防止 `packFile: ""` + `source: "registry"` 这组字段契约被悄悄改回。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as catalogGet } from "@/app/content/cloud/catalog.json/route";
import { GET as gamesGet } from "@/app/api/games/[gameId]/route";
import { POST as publishPost } from "@/app/api/publish/route";
import { POST as adminWorkPost } from "@/app/api/admin/works/[gameId]/[action]/route";
import { packUrl, publishedGames, type CloudGameEntry } from "@/lib/cloud";
import type { Game, Scene } from "@/lib/game/types";
import {
  createUser,
  rawRequest,
  sessionCookieFor,
  setupRegistryEnv,
  type TestEnv,
} from "../helpers/registry";

let env: TestEnv;

beforeEach(async () => {
  env = await setupRegistryEnv();
});

afterEach(async () => {
  await env.cleanup();
});

/* ----------------------------- fixtures ----------------------------- */

function scene(id: string): Scene {
  return {
    id,
    title: id.toUpperCase(),
    story: `story ${id}`,
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "text", question: "q", answer: ["go"] },
    reward: { type: "keyword", title: `kw-${id}`, value: `kw-${id}` },
  };
}

function game(id: string, sceneCount = 1, title = "Catalog Hunt"): Game {
  const scenes = Array.from({ length: sceneCount }, (_, i) => scene(String.fromCharCode(97 + i)));
  for (let i = 0; i < scenes.length - 1; i += 1) scenes[i].nextSceneId = scenes[i + 1].id;
  return {
    id,
    language: "zh-CN",
    title,
    description: "catalog fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: scenes[0].id,
    scenes,
  };
}

const publish = (body: string, cookie?: string) =>
  publishPost(
    rawRequest("https://host.test/api/publish", {
      body,
      cookie,
      contentType: "application/json",
    }),
  );

const adminAction = (gameId: string, action: string, cookie: string, body: unknown = {}) =>
  adminWorkPost(
    rawRequest(`https://host.test/api/admin/works/${gameId}/${action}`, {
      body: JSON.stringify(body),
      cookie,
    }),
    { params: Promise.resolve({ gameId, action }) },
  );

const getGame = (gameId: string) =>
  gamesGet(new Request(`https://host.test/api/games/${gameId}`), {
    params: Promise.resolve({ gameId }),
  });

interface CatalogBody {
  version: string;
  updatedAt: string;
  games: CloudGameEntry[];
}

async function readCatalog(): Promise<CatalogBody> {
  const response = await catalogGet();
  expect(response.status).toBe(200);
  return (await response.json()) as CatalogBody;
}

async function seedUsers() {
  const owner = await createUser({ email: "owner@example.com", role: "creator" });
  const admin = await createUser({ email: "admin@example.com", role: "admin" });
  return {
    ownerCookie: await sessionCookieFor(owner),
    adminCookie: await sessionCookieFor(admin),
  };
}

/** submit -> claim -> approve -> publish，返回 versionId。 */
async function publishPack(
  fixture: { ownerCookie: string; adminCookie: string },
  pack: Game,
): Promise<string> {
  const submitted = await publish(JSON.stringify(pack), fixture.ownerCookie);
  expect(submitted.status).toBe(201);
  const { versionId } = (await submitted.json()) as { versionId: string };
  expect((await adminAction(pack.id, "claim", fixture.adminCookie)).status).toBe(200);
  const decided = await adminAction(pack.id, "decision", fixture.adminCookie, {
    decision: "approve",
    reasonCodes: [],
    reasonText: "",
    checklist: { played: true },
  });
  expect(decided.status).toBe(200);
  expect((await adminAction(pack.id, "publish", fixture.adminCookie)).status).toBe(200);
  return versionId;
}

/* ------------------------------ tests ------------------------------ */

describe("catalog: repo baseline", () => {
  it("empty registry yields an empty catalogue (built-in showcase list intentionally empty)", async () => {
    // 决策变更（3331715）：内置精选不进目录，游戏中心只展示 registry 中
    // state=published 的官方示范；内置包数据文件仍在仓库，需要重新上架时
    // 把条目加回 route 的 repoCatalog.games 即可。这里钉住「不偷偷回退」。
    const catalog = await readCatalog();
    expect(catalog.games).toEqual([]);
  });

  it("does not advertise anything that is not published", async () => {
    const catalog = await readCatalog();
    expect(catalog.games.every((g) => g.status === "published")).toBe(true);
    expect(publishedGames(catalog).map((g) => g.id)).toEqual(catalog.games.map((g) => g.id));
  });
});

describe("catalog: publish makes a work visible", () => {
  it("submitted-but-unreviewed content is invisible to players", async () => {
    const fixture = await seedUsers();
    const response = await publish(JSON.stringify(game("pending-hunt")), fixture.ownerCookie);
    expect(response.status).toBe(201);

    const catalog = await readCatalog();
    expect(catalog.games.some((g) => g.id === "pending-hunt")).toBe(false);
    expect((await getGame("pending-hunt")).status).toBe(404);
  });

  it("approved-but-not-published content is still invisible", async () => {
    const fixture = await seedUsers();
    await publish(JSON.stringify(game("reviewed-hunt")), fixture.ownerCookie);
    expect((await adminAction("reviewed-hunt", "claim", fixture.adminCookie)).status).toBe(200);
    expect(
      (
        await adminAction("reviewed-hunt", "decision", fixture.adminCookie, {
          decision: "approve",
          reasonCodes: [],
          reasonText: "",
          checklist: { played: true },
        })
      ).status,
    ).toBe(200);

    expect((await readCatalog()).games.some((g) => g.id === "reviewed-hunt")).toBe(false);
    expect((await getGame("reviewed-hunt")).status).toBe(404);
  });

  it("publishing adds a registry entry whose packUrl really resolves", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("visible-hunt", 2, "Visible Hunt"));

    const catalog = await readCatalog();
    const entry = catalog.games.find((g) => g.id === "visible-hunt");
    expect(entry).toBeDefined();
    expect(entry!.source).toBe("registry");
    expect(entry!.status).toBe("published");
    expect(entry!.sceneCount).toBe(2);
    // 空 packFile 是刻意的：字节由读端点提供，不落在 /content 静态目录
    expect(entry!.packFile).toBe("");
    expect(packUrl(entry!)).toBe("/api/games/visible-hunt");

    // 目录给的地址必须真的能读到同一个作品——否则下载按钮会 404
    const response = await getGame(entry!.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Game;
    expect(body.id).toBe("visible-hunt");
    expect(body.scenes).toHaveLength(2);
  });

  it("republishing a work still yields exactly one catalogue entry", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("rizal-park-discovery", 1, "First Version"));
    // 同一 id 再发一版：目录里仍只能有一条（最新已发布版本）
    await publishPack(fixture, game("rizal-park-discovery", 2, "Second Version"));

    const catalog = await readCatalog();
    const matches = catalog.games.filter((g) => g.id === "rizal-park-discovery");
    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe("registry");
    // 字节由审核感知读端点提供，不指向静态目录
    expect(packUrl(matches[0])).toBe("/api/games/rizal-park-discovery");
  });
});

describe("catalog: withdraw / unlist", () => {
  it("withdrawn works disappear from the catalogue and the read endpoint", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("withdrawn-hunt"));
    expect((await readCatalog()).games.some((g) => g.id === "withdrawn-hunt")).toBe(true);

    expect((await adminAction("withdrawn-hunt", "withdraw", fixture.adminCookie)).status).toBe(200);

    expect((await readCatalog()).games.some((g) => g.id === "withdrawn-hunt")).toBe(false);
    expect((await getGame("withdrawn-hunt")).status).toBe(404);
  });

  it("unlisted works stay playable by link but are never advertised", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("unlisted-hunt"));

    expect((await adminAction("unlisted-hunt", "unlist", fixture.adminCookie)).status).toBe(200);

    expect((await readCatalog()).games.some((g) => g.id === "unlisted-hunt")).toBe(false);
    // 直链仍然可玩：unlisted 只是不广告，不是撤下
    expect((await getGame("unlisted-hunt")).status).toBe(200);
  });

  it("restore brings the work back to the catalogue", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("restored-hunt"));
    await adminAction("restored-hunt", "withdraw", fixture.adminCookie);
    expect((await adminAction("restored-hunt", "restore", fixture.adminCookie)).status).toBe(200);

    const catalog = await readCatalog();
    expect(catalog.games.some((g) => g.id === "restored-hunt")).toBe(true);
    expect((await getGame("restored-hunt")).status).toBe(200);
  });
});

describe("catalog: repeat publish and in-flight submissions", () => {
  it("a second submission does not change what players see until it is published", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("evolving-hunt", 1, "V1"));

    const second = await publish(JSON.stringify(game("evolving-hunt", 2, "V2")), fixture.ownerCookie);
    // 内容不同 → 新版本进入待审队列
    expect([200, 201]).toContain(second.status);

    const catalog = await readCatalog();
    const entry = catalog.games.find((g) => g.id === "evolving-hunt")!;
    expect(entry.sceneCount).toBe(1);
    const stillV1 = (await (await getGame("evolving-hunt")).json()) as Game;
    expect(stillV1.scenes).toHaveLength(1);
    expect(stillV1.title).toBe("V1");
  });

  it("re-publishing identical bytes is idempotent and keeps one catalogue entry", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("idempotent-hunt"));
    const repeat = await publish(JSON.stringify(game("idempotent-hunt")), fixture.ownerCookie);
    expect(repeat.status).toBe(200);
    const body = (await repeat.json()) as { reviewStatus: string };
    expect(body.reviewStatus).toBe("already_submitted");

    const matches = (await readCatalog()).games.filter((g) => g.id === "idempotent-hunt");
    expect(matches).toHaveLength(1);
  });
});

describe("lib/cloud packUrl hardening", () => {
  const entry = (overrides: Partial<CloudGameEntry>): CloudGameEntry => ({
    id: "safe-id",
    title: "t",
    author: "a",
    description: "d",
    language: "zh-CN",
    sceneCount: 1,
    status: "published",
    packFile: "safe-id.json",
    ...overrides,
  });

  it("rejects traversal in a repo packFile", () => {
    expect(() => packUrl(entry({ source: "repo", packFile: "../secret.json" }))).toThrow();
    expect(() => packUrl(entry({ source: "repo", packFile: "a/b.json" }))).toThrow();
  });

  it("rejects an unsafe registry id instead of interpolating it", () => {
    expect(() => packUrl(entry({ source: "registry", id: "a/b" }))).toThrow();
    // `..` 与 `.` 都是合法正则字符串但会被 URL 归一化成另一条路径
    expect(() => packUrl(entry({ source: "registry", id: ".." }))).toThrow();
    expect(() => packUrl(entry({ source: "registry", id: "." }))).toThrow();
    expect(() => packUrl(entry({ source: "registry", id: "Upper" }))).toThrow();
  });

  it("encodes the id it does accept", () => {
    expect(packUrl(entry({ source: "registry", id: "ok.id_1-2" }))).toBe("/api/games/ok.id_1-2");
  });

  it("filters by exactly `published`", () => {
    const catalog = {
      version: "1",
      updatedAt: "",
      games: [
        entry({ id: "p1", status: "published" }),
        entry({ id: "d1", status: "draft" }),
        entry({ id: "u1", status: "unlisted" }),
        entry({ id: "a1", status: "archived" }),
      ],
    };
    expect(publishedGames(catalog).map((g) => g.id)).toEqual(["p1"]);
  });
});

/* 说明：目录在 registry 读取失败时必须降级而不是 500，
   该用例需要替换模块导出，单独放在 catalog-degrade.test.ts 中。 */
