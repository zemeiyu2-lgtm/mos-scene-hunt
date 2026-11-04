/**
 * HTTP surface for cities and work↔city association.
 *
 * Covers the two things a route test can prove that a service test cannot:
 * authentication/CSRF ordering, and that the response never carries internal
 * storage detail.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as citiesGet, POST as citiesPost } from "@/app/api/cities/route";
import { GET as cityDetailGet } from "@/app/api/cities/[cityId]/route";
import { GET as workCityGet, POST as workCityPost } from "@/app/api/works/[gameId]/city/route";
import { issueSession, SESSION_COOKIE } from "@/lib/auth/session";
import type { CityTestEnv } from "./setup";
import { seedUser, seedWork, setupCityEnv } from "./setup";

let env: CityTestEnv;
let creatorCookie: string;
let adminCookie: string;
let creatorId: string;

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

beforeEach(async () => {
  env = await setupCityEnv();
  const creator = await seedUser(env.registry, "owner0001", "creator");
  const admin = await seedUser(env.registry, "admin0001", "admin");
  creatorId = creator.id;
  const creatorSession = await issueSession(env.registry, { userId: creator.id, role: "creator", ipHash: "ip", uaHash: "ua" });
  const adminSession = await issueSession(env.registry, { userId: admin.id, role: "admin", ipHash: "ip", uaHash: "ua" });
  creatorCookie = `${SESSION_COOKIE}=${creatorSession.token}`;
  adminCookie = `${SESSION_COOKIE}=${adminSession.token}`;
});

afterEach(async () => {
  await env.cleanup();
});

describe("POST /api/cities", () => {
  it("未登录返回 401", async () => {
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", { cityName: "Manila", countryCode: "PH" }),
    );
    expect(response.status).toBe(401);
  });

  it("拒绝非 JSON content-type（CSRF 防护）", async () => {
    const response = await citiesPost(
      new Request("http://localhost/api/cities", {
        method: "POST",
        headers: { "content-type": "text/plain", cookie: creatorCookie },
        body: JSON.stringify({ cityName: "Manila", countryCode: "PH" }),
      }),
    );
    expect(response.status).toBe(415);
  });

  it("创建返回 201，重复请求返回 200 且同一 cityId", async () => {
    const payload = { cityName: "Manila", countryCode: "PH", countryName: "Philippines" };
    const first = await citiesPost(jsonRequest("http://localhost/api/cities", payload, creatorCookie));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.created).toBe(true);
    expect(firstBody.city.cityId).toBe("manila-ph");
    expect(JSON.stringify(firstBody)).not.toContain(env.root);

    const second = await citiesPost(jsonRequest("http://localhost/api/cities", payload, creatorCookie));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.reused).toBe(true);
    expect(secondBody.city.cityId).toBe(firstBody.city.cityId);
  });

  it("非法国家码返回 400", async () => {
    const response = await citiesPost(
      jsonRequest("http://localhost/api/cities", { cityName: "Manila", countryCode: "PHL" }, creatorCookie),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/cities", () => {
  it("公开可读，返回轻量索引且不暴露存储细节", async () => {
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { cityName: "Manila", countryCode: "PH" }, creatorCookie),
    );
    const response = await citiesGet(new Request("http://localhost/api/cities"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cities).toHaveLength(1);
    expect(body.cities[0].cityId).toBe("manila-ph");
    expect(JSON.stringify(body)).not.toContain(env.root);
    expect(body.cities[0].revision).toBeUndefined();
  });
});

describe("GET /api/cities/[cityId]", () => {
  it("存在返回 200，未知 id 返回 404", async () => {
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { cityName: "Manila", countryCode: "PH" }, creatorCookie),
    );
    const ok = await cityDetailGet(new Request("http://localhost/api/cities/manila-ph"), {
      params: Promise.resolve({ cityId: "manila-ph" }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.city.cityId).toBe("manila-ph");
    expect(body.packages).toEqual([]);
    expect(body.redirected).toBe(false);

    const missing = await cityDetailGet(new Request("http://localhost/api/cities/nowhere-xx"), {
      params: Promise.resolve({ cityId: "nowhere-xx" }),
    });
    expect(missing.status).toBe(404);
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

  it("作者可以给未发布作品关联城市，读回一致", async () => {
    await seedWork(env.registry, { gameId: "hunt-api", ownerUserId: creatorId, state: "approved" });
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { cityName: "Manila", countryCode: "PH" }, creatorCookie),
    );

    const post = await workCityPost(
      jsonRequest("http://localhost/api/works/hunt-api/city", { cityId: "manila-ph" }, creatorCookie),
      { params: Promise.resolve({ gameId: "hunt-api" }) },
    );
    expect(post.status).toBe(200);
    expect((await post.json()).cityId).toBe("manila-ph");

    const get = await workCityGet(
      new Request("http://localhost/api/works/hunt-api/city", { headers: { cookie: creatorCookie } }),
      { params: Promise.resolve({ gameId: "hunt-api" }) },
    );
    expect(get.status).toBe(200);
    expect((await get.json()).cityId).toBe("manila-ph");
  });

  it("已发布作品：作者 403，管理员 200", async () => {
    await seedWork(env.registry, { gameId: "hunt-live", ownerUserId: creatorId, state: "published", cityId: "manila-ph" });
    await citiesPost(
      jsonRequest("http://localhost/api/cities", { cityName: "Cebu", countryCode: "PH" }, creatorCookie),
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
});
