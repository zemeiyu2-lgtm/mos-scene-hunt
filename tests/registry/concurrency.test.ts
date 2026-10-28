/**
 * Concurrency tests for the two places where a race would produce a wrong
 * authoritative answer:
 *
 *  1. two accounts claiming the same `gameId` at the same instant — exactly
 *     one may win, and the loser must not end up with a work document;
 *  2. the same author submitting two different packs concurrently — both
 *     versions must be recorded, neither submission silently lost.
 *
 * The filesystem adapter serialises per key with an in-process lock and
 * verifies the revision on write, so these are real assertions rather than
 * "hopefully the event loop serialises it".
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as publishPost } from "@/app/api/publish/route";
import { POST as adminWorkPost } from "@/app/api/admin/works/[gameId]/[action]/route";
import { getRegistry } from "@/lib/registry/store";
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

function scene(id: string): Scene {
  return {
    id,
    title: id,
    story: "s",
    location: { lat: 0.001, lng: 0.001, radius: 50 },
    nextSceneId: null,
    challenge: { type: "text", question: "q", answer: ["go"] },
    reward: { type: "keyword", title: "k", value: "k" },
  };
}

function game(id: string, title = "Hunt"): Game {
  return {
    id,
    language: "zh-CN",
    title,
    description: "d",
    version: "1.0.0",
    startLocation: { lat: 0, lng: 0 },
    entrySceneId: "a",
    scenes: [scene("a")],
  };
}

const publish = (pack: Game, cookie: string) =>
  publishPost(
    rawRequest("https://host.test/api/publish", {
      body: JSON.stringify(pack),
      cookie,
    }),
  );

const adminAction = (gameId: string, action: string, cookie: string) =>
  adminWorkPost(
    rawRequest(`https://host.test/api/admin/works/${gameId}/${action}`, {
      body: "{}",
      cookie,
    }),
    { params: Promise.resolve({ gameId, action }) },
  );

describe("concurrent claim of one game id", () => {
  it("lets exactly one account own the id and records one work", async () => {
    const a = await createUser({ email: "a@example.com" });
    const b = await createUser({ email: "b@example.com" });
    const cookieA = await sessionCookieFor(a);
    const cookieB = await sessionCookieFor(b);

    const [resA, resB] = await Promise.all([
      publish(game("contested", "From A"), cookieA),
      publish(game("contested", "From B"), cookieB),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 403]);

    const work = await getRegistry().getWork("contested");
    expect(work).not.toBeNull();
    expect(work!.versions).toHaveLength(1);
    // The loser's bytes must not be reachable through the winner's work.
    const winnerIsA = work!.ownerUserId === a.id;
    expect(work!.title).toBe(winnerIsA ? "From A" : "From B");
  });
});

describe("concurrent submissions by the same author", () => {
  it("records both versions without losing one", async () => {
    const owner = await createUser({ email: "owner@example.com" });
    const cookie = await sessionCookieFor(owner);

    const [first, second] = await Promise.all([
      publish(game("mine", "Edition 1"), cookie),
      publish(game("mine", "Edition 2"), cookie),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);

    const work = await getRegistry().getWork("mine");
    expect(work).not.toBeNull();
    expect(work!.ownerUserId).toBe(owner.id);
    expect(work!.versions).toHaveLength(2);
    expect(work!.submissions).toHaveLength(2);
    // Exactly one of the two is "latest"; both are still individually listed.
    expect(work!.latestVersionId).not.toBeNull();
    expect(work!.versions.map((v) => v.versionId)).toContain(work!.latestVersionId);
  });
});

describe("concurrent review decisions", () => {
  it("accepts one decision and refuses the second with a conflict", async () => {
    const owner = await createUser({ email: "owner@example.com" });
    const admin = await createUser({ email: "admin@example.com", role: "admin" });
    const ownerCookie = await sessionCookieFor(owner);
    const adminCookie = await sessionCookieFor(admin);

    await publish(game("reviewed"), ownerCookie);
    expect((await adminAction("reviewed", "claim", adminCookie)).status).toBe(200);

    const [a, b] = await Promise.all([
      adminWorkPost(
        rawRequest("https://host.test/api/admin/works/reviewed/decision", {
          body: JSON.stringify({ decision: "approve", reasonCodes: [], reasonText: "", checklist: {} }),
          cookie: adminCookie,
        }),
        { params: Promise.resolve({ gameId: "reviewed", action: "decision" }) },
      ),
      adminWorkPost(
        rawRequest("https://host.test/api/admin/works/reviewed/decision", {
          body: JSON.stringify({
            decision: "reject",
            reasonCodes: ["quality"],
            reasonText: "no",
            checklist: {},
          }),
          cookie: adminCookie,
        }),
        { params: Promise.resolve({ gameId: "reviewed", action: "decision" }) },
      ),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const work = await getRegistry().getWork("reviewed");
    // One review record only — two contradictory decisions must never both land.
    const decisions = work!.submissions[0];
    expect(decisions.review).not.toBeNull();
    expect(["approve", "reject"]).toContain(decisions.review!.decision);
  });
});
