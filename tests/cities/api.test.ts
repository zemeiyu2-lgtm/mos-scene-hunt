/**
 * HTTP surface for cities and work↔city association.
 *
 * Covers the things a route test can prove that a service test cannot:
 * authentication/CSRF ordering, the mandatory `gameId` on city creation, and
 * that no response ever carries internal storage detail.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as citiesGet, POST as citiesPost } from "@/app/api/cities/route";
import { GET as cityDetailGet } from "@/app/api/cities/[cityId]/route";
import { GET as workCityGet, POST as workCityPost } from "@/app/api/works/[gameId]/city/route";
import { getCityStore } from "@/lib/cities/store";
import { issueSession, SESSION_COOKIE } from "@/lib/auth/session";
import { publishWork } from "@/lib/registry/service";
import type { CityTestEnv } from "./setup";
import { actor, seedUser, seedWork, setupCityEnv } from "./setup";

let env: CityTestEnv;
let creatorCookie: string;
let adminCookie: string;
let creatorId: string;
let adminId: string;
let admin: Awaited<ReturnType<typeof seedUser>>;

function jsonRequest(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function cityCount(): Promise<number> {
  return (await getCityStore().listCities()).length;
}

beforeEach(async () => {
  env = await setupCityEnv();
  const creator = await seedUser(env.registry, "owner0001", "creator");
  admin = await seedUser(env.registry, "admin0001", "admin");
  creatorId = creator.id;
  adminId = admin.id;
  const creatorSession = await issueSession(env.registry, { userId: creator.id, role: "creator", ipHash: "ip", uaHash: "ua" });
  const adminSession = await issueSession(env.registry, { userId: admin.id, role: "admin", ipHash: "ip", uaHash: "ua" });
  creatorCookie = `${SESSION_COOKIE}=${creatorSession.token}`;
  adminCookie = `${SESSION_COOKIE}=${adminSession.token}`;
});

afterEach(async () => {
  await env.cleanup();
});

describe("POST /api/cities —— 必须先有探索包", () => {
  it("未登录返回 401", async () => {
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-api", city: { cityName: "Manila", countryCode: "PH" } }),
    );
    expect(response.status).toBe(401);
  });

  it("拒绝非 JSON content-type（CSRF 防护）", async () => {
    const response = await citiesPost(
      new Request("http://localhost/api/cities", {
        method: "POST",
        headers: { "content-type": "text/plain", cookie: creatorCookie },
        body: JSON.stringify({ gameId: "hunt-api", city: { cityName: "Manila", countryCode: "PH" } }),
      }),
    );
    expect(response.status).toBe(415);
  });

  it("缺少 gameId 时拒绝，且不产生城市档案", async () => {
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", { cityName: "Manila", countryCode: "PH" }, creatorCookie),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("game_id_required");
    expect(await cityCount()).toBe(0);
  });

  it("只提供城市名称绝不能创建城市", async () => {
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", {
        gameId: undefined,
        city: { cityName: "Cebu", countryCode: "PH" },
      }, creatorCookie),
    );
    expect(response.status).toBe(400);
    expect(await cityCount()).toBe(0);
  });

  it("gameId 不存在时拒绝，且不产生城市档案", async () => {
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", {
        gameId: "hunt-nowhere",
        city: { cityName: "Manila", countryCode: "PH" },
      }, creatorCookie),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("work_not_found");
    expect(await cityCount()).toBe(0);
  });

  it("不能替他人的探索包建档", async () => {
    await seedWork(env.registry, { gameId: "hunt-theirs", ownerUserId: adminId, state: "draft" });
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", {
        gameId: "hunt-theirs",
        city: { cityName: "Manila", countryCode: "PH" },
      }, creatorCookie),
    );
    expect(response.status).toBe(403);
    expect(await cityCount()).toBe(0);
    expect((await env.registry.getWork("hunt-theirs"))?.cityId).toBeUndefined();
  });

  it("真实探索包存在且有权限时创建并完成关联", async () => {
    await seedWork(env.registry, { gameId: "hunt-api", ownerUserId: creatorId, state: "draft" });
    const payload = {
      gameId: "hunt-api",
      city: { cityName: "Manila", countryCode: "PH", countryName: "Philippines" },
    };
    const first = await citiesPost(jsonRequest("http://localhost/api/cities", payload, creatorCookie));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.created).toBe(true);
    expect(firstBody.city.cityId).toBe("manila-ph");
    expect(firstBody.work.cityId).toBe("manila-ph");
    expect(JSON.stringify(firstBody)).not.toContain(env.root);

    // The association really landed on the pack document.
    expect((await env.registry.getWork("hunt-api"))?.cityId).toBe("manila-ph");

    const second = await citiesPost(jsonRequest("http://localhost/api/cities", payload, creatorCookie));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.reused).toBe(true);
    expect(secondBody.created).toBe(false);
    expect(secondBody.city.cityId).toBe("manila-ph");
    expect(await cityCount()).toBe(1);
  });

  it("多个探索包关联同一城市复用同一档案", async () => {
    await seedWork(env.registry, { gameId: "hunt-1", ownerUserId: creatorId, state: "draft" });
    await seedWork(env.registry, { gameId: "hunt-2", ownerUserId: creatorId, state: "draft" });
    const a = await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-1", city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
    );
    const b = await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-2", city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await b.json()).city.cityId).toBe((await a.json()).city.cityId);
    expect(await cityCount()).toBe(1);
  });

  it("非法国家码返回 400", async () => {
    await seedWork(env.registry, { gameId: "hunt-api", ownerUserId: creatorId, state: "draft" });
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", {
        gameId: "hunt-api",
        city: { cityName: "Manila", countryCode: "PHL" },
      }, creatorCookie),
    );
    expect(response.status).toBe(400);
    expect(await cityCount()).toBe(0);
  });
});

describe("GET /api/cities", () => {
  it("公开列表只包含有已发布探索包的城市", async () => {
    await seedWork(env.registry, { gameId: "hunt-draft", ownerUserId: creatorId, state: "draft" });
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-draft", city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
    );

    const before = await citiesGet(new Request("http://localhost/api/cities"));
    expect(before.status).toBe(200);
    expect((await before.json()).cities).toHaveLength(0);

    const picker = await citiesGet(
      new Request("http://localhost/api/cities?scope=all", { headers: { cookie: creatorCookie } }),
    );
    expect(picker.status).toBe(200);
    expect((await picker.json()).cities).toHaveLength(1);

    await seedWork(env.registry, { gameId: "hunt-live", ownerUserId: creatorId, state: "approved" });
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-live", city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
    );
    await publishWork(actor(admin), "hunt-live");

    const after = await citiesGet(new Request("http://localhost/api/cities"));
    const body = await after.json();
    expect(body.cities).toHaveLength(1);
    expect(body.cities[0].cityId).toBe("manila-ph");
    expect(body.cities[0].gameCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain(env.root);
    expect(body.cities[0].revision).toBeUndefined();
  });

  it("scope=all 需要登录，且降级为 picker 并标记 deprecated", async () => {
    const anonymous = await citiesGet(new Request("http://localhost/api/cities?scope=all"));
    expect(anonymous.status).toBe(401);

    const response = await citiesGet(
      new Request("http://localhost/api/cities?scope=all", { headers: { cookie: creatorCookie } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deprecated).toBe(true);
    expect(body.scope).toBe("picker");
  });

  it("picker 不泄露其他作者的草稿城市", async () => {
    // Author B creates a city through a draft pack.
    const other = await seedUser(env.registry, "creator-b");
    const otherSession = await issueSession(env.registry, {
      userId: other.id,
      role: "creator",
      ipHash: "ip",
      uaHash: "ua",
    });
    const otherCookie = `${SESSION_COOKIE}=${otherSession.token}`;
    await seedWork(env.registry, { gameId: "hunt-b", ownerUserId: other.id, state: "draft" });
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-b", city: { cityName: "Cebu", countryCode: "PH" } }, otherCookie),
    );

    // Author A sees nothing of B's draft city.
    const mine = await citiesGet(
      new Request("http://localhost/api/cities?scope=picker", { headers: { cookie: creatorCookie } }),
    );
    expect(mine.status).toBe(200);
    expect((await mine.json()).cities).toHaveLength(0);

    // B sees its own.
    const theirs = await citiesGet(
      new Request("http://localhost/api/cities?scope=picker", { headers: { cookie: otherCookie } }),
    );
    expect((await theirs.json()).cities.map((city: { cityId: string }) => city.cityId)).toEqual(["cebu-ph"]);
  });

  it("普通作者不能读取 admin scope", async () => {
    const response = await citiesGet(
      new Request("http://localhost/api/cities?scope=admin", { headers: { cookie: creatorCookie } }),
    );
    expect(response.status).toBe(403);
  });

  it("无法识别的 scope 返回 400 invalid_scope", async () => {
    const response = await citiesGet(new Request("http://localhost/api/cities?scope=everything"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_scope");
  });

  /*
   * `limit` is part of the response contract (the Game Center entry asks for
   * three rows, not the whole catalogue), so it must be honoured and validated
   * — silently ignoring it would make the entry look broken, and a bad value
   * must not be treated as "no limit".
   */
  it("limit 在筛选与排序之后截断，返回的是完整列表的前 N 行", async () => {
    // Four published cities — one MORE than the /games entry asks for — so a
    // pass-through (ignoring limit) would leak the fourth row.
    for (const [gameId, cityName] of [
      ["hunt-cebu", "Cebu"],
      ["hunt-manila", "Manila"],
      ["hunt-quezon", "Quezon City"],
      ["hunt-davao", "Davao"],
    ] as const) {
      await seedWork(env.registry, { gameId, ownerUserId: creatorId, state: "approved" });
      await citiesPost(
        jsonRequest("http://localhost/api/cities", { gameId, city: { cityName, countryCode: "PH" } }, creatorCookie),
      );
      await publishWork(actor(admin), gameId);
    }

    const full = await (await citiesGet(new Request("http://localhost/api/cities"))).json();
    expect(full.cities).toHaveLength(4);

    // The Game Center entry asks for exactly this shape: at most three rows.
    const limited = await (await citiesGet(new Request("http://localhost/api/cities?limit=3"))).json();
    expect(limited.cities).toHaveLength(3);
    // Same first rows as the full list: truncation never reorders.
    expect(limited.cities.map((c: { cityId: string }) => c.cityId)).toEqual(
      full.cities.slice(0, 3).map((c: { cityId: string }) => c.cityId),
    );
  });

  it("非法 limit 返回 400 invalid_limit，而不是被当成没有上限", async () => {
    for (const value of ["0", "-3", "abc", "2.5", "201"]) {
      const response = await citiesGet(new Request(`http://localhost/api/cities?limit=${value}`));
      expect(response.status, `limit=${value}`).toBe(400);
      expect((await response.json()).error).toBe("invalid_limit");
    }
  });
});

describe("GET /api/cities/[cityId]", () => {
  it("R2：没有公开探索包的城市返回 404，未知 id 也返回 404", async () => {
    // Draft only: the profile exists (the author's own draft created it), but a
    // stranger may not see a city page with nothing to open.
    await seedWork(env.registry, { gameId: "hunt-api", ownerUserId: creatorId, state: "draft" });
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-api", city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
    );
    const draftOnly = await cityDetailGet(new Request("http://localhost/api/cities/manila-ph"), {
      params: Promise.resolve({ cityId: "manila-ph" }),
    });
    expect(draftOnly.status).toBe(404);
    expect((await draftOnly.json()).error).toBe("city_not_public");

    const missing = await cityDetailGet(new Request("http://localhost/api/cities/nowhere-xx"), {
      params: Promise.resolve({ cityId: "nowhere-xx" }),
    });
    expect(missing.status).toBe(404);
  });

  it("有公开探索包时返回 200，只含公开包", async () => {
    await seedWork(env.registry, { gameId: "hunt-live", ownerUserId: creatorId, state: "approved" });
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-live", city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
    );
    await publishWork(actor(admin), "hunt-live");

    const ok = await cityDetailGet(new Request("http://localhost/api/cities/manila-ph"), {
      params: Promise.resolve({ cityId: "manila-ph" }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.city.cityId).toBe("manila-ph");
    expect(body.city.gameCount).toBe(1);
    expect(body.packages.map((entry: { gameId: string }) => entry.gameId)).toEqual(["hunt-live"]);
    expect(body.redirected).toBe(false);
  });
});

describe("POST /api/works/[gameId]/city", () => {
  it("未登录返回 401", async () => {
    await seedWork(env.registry, { gameId: "hunt-api", ownerUserId: creatorId, state: "approved" });
    const response = await workCityPost(jsonRequest("http://localhost/api/works/hunt-api/city", { cityId: null }), {
      params: Promise.resolve({ gameId: "hunt-api" }),
    });
    expect(response.status).toBe(401);
  });

  it("作者可以给未发布作品创建并关联城市，读回一致", async () => {
    await seedWork(env.registry, { gameId: "hunt-api", ownerUserId: creatorId, state: "approved" });

    const post = await workCityPost(
      jsonRequest("http://localhost/api/works/hunt-api/city", { city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
      { params: Promise.resolve({ gameId: "hunt-api" }) },
    );
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.cityId).toBe("manila-ph");
    expect(body.created).toBe(true);

    const get = await workCityGet(
      new Request("http://localhost/api/works/hunt-api/city", { headers: { cookie: creatorCookie } }),
      { params: Promise.resolve({ gameId: "hunt-api" }) },
    );
    expect(get.status).toBe(200);
    expect((await get.json()).cityId).toBe("manila-ph");
  });

  it("已发布作品：作者 403，管理员 200", async () => {
    await seedWork(env.registry, { gameId: "hunt-live", ownerUserId: creatorId, state: "published", cityId: "manila-ph" });
    await seedWork(env.registry, { gameId: "hunt-seed", ownerUserId: creatorId, state: "draft" });
    // The profile must exist before it can be attached, and it can only come
    // from a real pack.
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { gameId: "hunt-seed", city: { cityName: "Cebu", countryCode: "PH" } }, creatorCookie),
    );

    const denied = await workCityPost(
      jsonRequest("http://localhost/api/works/hunt-live/city", { cityId: "cebu-ph" }, creatorCookie),
      { params: Promise.resolve({ gameId: "hunt-live" }) },
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe("city_change_forbidden");

    const allowed = await workCityPost(
      jsonRequest("http://localhost/api/works/hunt-live/city", { cityId: "cebu-ph" }, adminCookie),
      { params: Promise.resolve({ gameId: "hunt-live" }) },
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).cityId).toBe("cebu-ph");
  });

  it("非作者读取被拒绝", async () => {
    await seedWork(env.registry, { gameId: "hunt-other", ownerUserId: "someoneelse01", state: "approved" });
    const response = await workCityGet(
      new Request("http://localhost/api/works/hunt-other/city", { headers: { cookie: creatorCookie } }),
      { params: Promise.resolve({ gameId: "hunt-other" }) },
    );
    expect(response.status).toBe(403);
  });

  it("未知作品不产生任何城市档案", async () => {
    const response = await workCityPost(
      jsonRequest("http://localhost/api/works/hunt-ghost/city", { city: { cityName: "Manila", countryCode: "PH" } }, creatorCookie),
      { params: Promise.resolve({ gameId: "hunt-ghost" }) },
    );
    expect(response.status).toBe(404);
    expect(await cityCount()).toBe(0);
  });
});
