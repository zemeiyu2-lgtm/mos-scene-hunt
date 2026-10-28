/**
 * End-to-end contract tests for submit -> review -> publish -> withdraw.
 *
 * Route handlers are invoked directly with standard `Request` objects against
 * a temporary registry + store, so the HTTP contract is exercised for real
 * (status codes, cookies, cache headers) without booting a server.
 *
 * The assertions map one-to-one onto the acceptance list in the design doc:
 * anonymous writes are refused, ownership cannot be forged, unreviewed content
 * is unreadable, and publishing is a separate authorised act.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as publishPost } from "@/app/api/publish/route";
import { GET as gamesGet } from "@/app/api/games/[gameId]/route";
import { POST as adminWorkPost } from "@/app/api/admin/works/[gameId]/[action]/route";
import { GET as previewGet } from "@/app/api/admin/preview/[gameId]/[versionId]/route";
import { validateGame } from "@/lib/game/types";
import { deriveVersionId } from "@/lib/publish/version";
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

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: id.toUpperCase(),
    story: `story ${id}`,
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "text", question: "q", answer: ["go"] },
    reward: { type: "keyword", title: `kw-${id}`, value: `kw-${id}` },
    ...overrides,
  };
}

function game(id: string, overrides: Partial<Game> = {}): Game {
  return {
    id,
    language: "zh-CN",
    title: "Published Hunt",
    description: "api fixture",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "a",
    scenes: [scene("a")],
    ...overrides,
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

const getLatest = (gameId: string) =>
  gamesGet(new Request(`https://host.test/api/games/${gameId}`), {
    params: Promise.resolve({ gameId }),
  });

const getVersion = (gameId: string, v: string) =>
  gamesGet(new Request(`https://host.test/api/games/${gameId}?v=${v}`), {
    params: Promise.resolve({ gameId }),
  });

const adminAction = (gameId: string, action: string, cookie: string, body: unknown = {}) =>
  adminWorkPost(
    rawRequest(`https://host.test/api/admin/works/${gameId}/${action}`, {
      body: JSON.stringify(body),
      cookie,
    }),
    { params: Promise.resolve({ gameId, action }) },
  );

const preview = (gameId: string, versionId: string, cookie?: string) =>
  previewGet(
    new Request(`https://host.test/api/admin/preview/${gameId}/${versionId}`, {
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ gameId, versionId }) },
  );

interface Fixture {
  ownerCookie: string;
  otherCookie: string;
  adminCookie: string;
}

async function seedUsers(): Promise<Fixture> {
  const owner = await createUser({ email: "owner@example.com", role: "creator" });
  const other = await createUser({ email: "other@example.com", role: "creator" });
  const admin = await createUser({ email: "admin@example.com", role: "admin" });
  return {
    ownerCookie: await sessionCookieFor(owner),
    otherCookie: await sessionCookieFor(other),
    adminCookie: await sessionCookieFor(admin),
  };
}

/** submit -> claim -> approve -> publish, returning the versionId. */
async function publishPack(fixture: Fixture, pack: Game): Promise<string> {
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

describe("anonymous access", () => {
  it("refuses to publish without a session", async () => {
    const response = await publish(JSON.stringify(game("demo-hunt")));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthenticated");
  });

  it("refuses admin actions without a session", async () => {
    const response = await adminAction("demo-hunt", "publish", "");
    expect(response.status).toBe(401);
  });

  it("serves no unpublished game to the public", async () => {
    expect((await getLatest("never-published")).status).toBe(404);
  });
});

describe("submission", () => {
  it("accepts a valid pack and returns no public link", async () => {
    const fixture = await seedUsers();
    const response = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.gameId).toBe("demo-hunt");
    expect(body.reviewStatus).toBe("pending");
    expect(body.workState).toBe("submitted");
    // The old contract returned playPath; that link would have been live
    // immediately, which is exactly the behaviour being removed.
    expect(body.playPath).toBeUndefined();
    expect(body.versionId).toBe(await deriveVersionId(game("demo-hunt")));
  });

  it("keeps an unreviewed version unreadable through every public path", async () => {
    const fixture = await seedUsers();
    const submitted = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    const { versionId } = (await submitted.json()) as { versionId: string };

    expect((await getLatest("demo-hunt")).status).toBe(404);
    expect((await getVersion("demo-hunt", versionId)).status).toBe(404);
  });

  it("refuses an id already owned by another account", async () => {
    const fixture = await seedUsers();
    await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);

    const hijack = await publish(
      JSON.stringify(game("demo-hunt", { title: "Hijacked" })),
      fixture.otherCookie,
    );
    expect(hijack.status).toBe(403);
    const body = (await hijack.json()) as { error: string };
    expect(body.error).toBe("game_id_taken");
  });

  it("treats identical content as an idempotent resubmission", async () => {
    const fixture = await seedUsers();
    const first = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    expect(first.status).toBe(201);
    const repeat = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    expect(repeat.status).toBe(200);
    const body = (await repeat.json()) as { reviewStatus: string };
    expect(body.reviewStatus).toBe("already_submitted");
  });

  it("guards the input contract before touching storage", async () => {
    const fixture = await seedUsers();
    expect((await publish("not json", fixture.ownerCookie)).status).toBe(400);
    expect((await publish("[1,2]", fixture.ownerCookie)).status).toBe(400);
    expect(
      (await publish(JSON.stringify(game("Bad Id")), fixture.ownerCookie)).status,
    ).toBe(400);
    expect(
      (
        await publishPost(
          rawRequest("https://host.test/api/publish", {
            body: '{"id":"demo-hunt"}',
            cookie: fixture.ownerCookie,
            contentType: "text/plain",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await publish("x".repeat(256 * 1024 + 1), fixture.ownerCookie)).status,
    ).toBe(413);
  });

  it("rejects a pack that fails validateGame", async () => {
    const fixture = await seedUsers();
    const broken = game("demo-hunt", { title: "" } as Partial<Game>);
    const response = await publish(JSON.stringify(broken), fixture.ownerCookie);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; detail: string };
    expect(body.error).toBe("invalid_pack");
    expect(body.detail).toContain("$.title");
  });
});

describe("review and publish", () => {
  it("does not publish merely because the review passed", async () => {
    const fixture = await seedUsers();
    await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    expect((await adminAction("demo-hunt", "claim", fixture.adminCookie)).status).toBe(200);
    expect(
      (
        await adminAction("demo-hunt", "decision", fixture.adminCookie, {
          decision: "approve",
          reasonCodes: [],
          reasonText: "",
          checklist: {},
        })
      ).status,
    ).toBe(200);

    // Approved but not published: still invisible to players.
    expect((await getLatest("demo-hunt")).status).toBe(404);

    expect((await adminAction("demo-hunt", "publish", fixture.adminCookie)).status).toBe(200);
    const live = await getLatest("demo-hunt");
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toContain("max-age=10");
    // The served body still satisfies the same validator every other path uses.
    const liveBody = await live.clone().json();
    expect(() => validateGame(liveBody)).not.toThrow();
  });

  it("keeps the old link on the old bytes after a newer version is published", async () => {
    const fixture = await seedUsers();
    const firstVersion = await publishPack(fixture, game("demo-hunt"));

    const second = await publish(
      JSON.stringify(game("demo-hunt", { title: "Second Edition" })),
      fixture.ownerCookie,
    );
    const secondVersion = ((await second.json()) as { versionId: string }).versionId;

    expect((await getLatest("demo-hunt")).status).toBe(200);
    // Before the second version is published, "latest" must still be the first.
    const stillFirst = await getLatest("demo-hunt");
    expect(((await stillFirst.json()) as Game).title).toBe("Published Hunt");

    await adminAction("demo-hunt", "claim", fixture.adminCookie);
    await adminAction("demo-hunt", "decision", fixture.adminCookie, {
      decision: "approve",
      reasonCodes: [],
      reasonText: "",
      checklist: {},
    });
    await adminAction("demo-hunt", "publish", fixture.adminCookie);

    const latestNow = await getLatest("demo-hunt");
    expect(((await latestNow.json()) as Game).title).toBe("Second Edition");

    // The QR code already printed for v1 must keep working, byte for byte.
    const history = await getVersion("demo-hunt", firstVersion);
    expect(history.status).toBe(200);
    expect(((await history.json()) as Game).title).toBe("Published Hunt");
    expect(history.headers.get("cache-control")).toContain("immutable");
    expect(history.headers.get("x-game-version")).toBe(firstVersion);
    expect(secondVersion).not.toBe(firstVersion);
  });

  it("requires a reason to request changes, and shows it to nobody public", async () => {
    const fixture = await seedUsers();
    await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    await adminAction("demo-hunt", "claim", fixture.adminCookie);

    const noReason = await adminAction("demo-hunt", "decision", fixture.adminCookie, {
      decision: "request_changes",
      reasonCodes: [],
      reasonText: "",
      checklist: {},
    });
    expect(noReason.status).toBe(409);
    expect(((await noReason.json()) as { error: string }).error).toBe("reason_required");

    const withReason = await adminAction("demo-hunt", "decision", fixture.adminCookie, {
      decision: "request_changes",
      reasonCodes: ["location_implausible"],
      reasonText: "第二个点进不去。",
      checklist: {},
    });
    expect(withReason.status).toBe(200);
    expect((await getLatest("demo-hunt")).status).toBe(404);
  });

  it("refuses publish before approval", async () => {
    const fixture = await seedUsers();
    await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    const response = await adminAction("demo-hunt", "publish", fixture.adminCookie);
    expect(response.status).toBe(409);
  });
});

describe("role boundaries", () => {
  it("forbids a creator from calling admin endpoints", async () => {
    const fixture = await seedUsers();
    await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    const response = await adminAction("demo-hunt", "publish", fixture.ownerCookie);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe("forbidden");
  });

  it("lets a reviewer decide but not publish", async () => {
    const fixture = await seedUsers();
    const reviewer = await createUser({ email: "rev@example.com", role: "reviewer" });
    const reviewerCookie = await sessionCookieFor(reviewer);

    await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    expect((await adminAction("demo-hunt", "claim", reviewerCookie)).status).toBe(200);
    expect(
      (
        await adminAction("demo-hunt", "decision", reviewerCookie, {
          decision: "approve",
          reasonCodes: [],
          reasonText: "",
          checklist: {},
        })
      ).status,
    ).toBe(200);
    // Reviewing is not publishing: a reviewer cannot make it live.
    expect((await adminAction("demo-hunt", "publish", reviewerCookie)).status).toBe(403);
  });

  it("accepts the production `__Host-` cookie name", async () => {
    // Regression guard: the guards once read only the unprefixed name, so every
    // admin endpoint answered 401 in a production build while the (test-env)
    // suites stayed green. The token here is real; only the name differs.
    const fixture = await seedUsers();
    const token = fixture.adminCookie.split("=").slice(1).join("=");
    const prefixed = `__Host-mos_sess=${token}`;

    // 404 (no such work) proves authentication succeeded; 401 would not.
    const response = await adminAction("no-such-work", "publish", prefixed);
    expect(response.status).toBe(404);
  });
});

describe("private preview", () => {
  it("serves unreviewed bytes to the owner and to staff only", async () => {
    const fixture = await seedUsers();
    const submitted = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    const { versionId } = (await submitted.json()) as { versionId: string };

    expect((await preview("demo-hunt", versionId, fixture.ownerCookie)).status).toBe(200);
    expect((await preview("demo-hunt", versionId, fixture.adminCookie)).status).toBe(200);
    // Another creator gets 404, not 403: existence must not be probeable.
    expect((await preview("demo-hunt", versionId, fixture.otherCookie)).status).toBe(404);
    expect((await preview("demo-hunt", versionId)).status).toBe(401);
  });

  it("marks preview responses as uncacheable", async () => {
    const fixture = await seedUsers();
    const submitted = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    const { versionId } = (await submitted.json()) as { versionId: string };
    const response = await preview("demo-hunt", versionId, fixture.ownerCookie);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("withdraw and restore", () => {
  it("makes the work unreadable, then readable again after restore", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("demo-hunt"));
    expect((await getLatest("demo-hunt")).status).toBe(200);

    expect((await adminAction("demo-hunt", "withdraw", fixture.adminCookie)).status).toBe(200);
    expect((await getLatest("demo-hunt")).status).toBe(404);

    expect((await adminAction("demo-hunt", "restore", fixture.adminCookie)).status).toBe(200);
    const restored = await getLatest("demo-hunt");
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as Game).title).toBe("Published Hunt");
  });

  it("keeps an unlisted work playable by link", async () => {
    const fixture = await seedUsers();
    await publishPack(fixture, game("demo-hunt"));
    expect((await adminAction("demo-hunt", "unlist", fixture.adminCookie)).status).toBe(200);
    expect((await getLatest("demo-hunt")).status).toBe(200);
  });
});

describe("storage integrity", () => {
  it("refuses to overwrite a tampered version object with 409", async () => {
    const fixture = await seedUsers();
    const versionId = await publishPack(fixture, game("demo-hunt"));
    const versionFile = path.join(env.root, "published", "demo-hunt", "versions", `${versionId}.json`);
    await writeFile(versionFile, '{"id":"demo-hunt","tampered":true}', "utf8");

    // A different pack under the same content hash cannot occur, so simulate
    // the collision directly: re-submitting identical bytes must conflict
    // because the stored bytes no longer match.
    const republish = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
    expect(republish.status).toBe(409);
    expect(((await republish.json()) as { error: string }).error).toBe("version_conflict");

    // Public read still serves what is stored, never a silent rewrite.
    const read = await getVersion("demo-hunt", versionId);
    expect(((await read.json()) as { tampered: boolean }).tampered).toBe(true);
  });

  it("returns a generic 500 without leaking paths when storage fails", async () => {
    const fixture = await seedUsers();
    const blocker = path.join(env.root, "blocked-root");
    await writeFile(blocker, "not a directory", "utf8");
    const previous = process.env.PUBLISHED_GAMES_DIR;
    process.env.PUBLISHED_GAMES_DIR = blocker;
    try {
      const response = await publish(JSON.stringify(game("demo-hunt")), fixture.ownerCookie);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string; detail?: string };
      expect(body.error).toBe("internal_error");
      expect(body.detail).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(env.root);
    } finally {
      process.env.PUBLISHED_GAMES_DIR = previous;
    }
  });
});
