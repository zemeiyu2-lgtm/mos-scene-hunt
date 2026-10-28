/**
 * State machine tests.
 *
 * These are the rules that keep published content safe, so they are tested
 * without a server, a filesystem or a clock: every case passes an explicit
 * `now` and asserts on the returned object.
 */

import { describe, expect, it } from "vitest";
import {
  allowedEventsFor,
  applyWorkEvent,
  canClaimGameId,
  findRestorableVersion,
  resolvePublishTarget,
} from "@/lib/registry/state-machine";
import { REGISTRY_SCHEMA_VERSION, type WorkRecord } from "@/lib/registry/types";

const OWNER = "user-owner";
const OTHER = "user-other";
const REVIEWER = "user-reviewer";

function work(overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    gameId: "demo-hunt",
    ownerUserId: OWNER,
    title: "Demo",
    language: "zh-CN",
    state: "draft",
    publishedVersionId: null,
    latestVersionId: null,
    versions: [],
    submissions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 0,
    ...overrides,
  };
}

const T1 = "2026-01-02T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";
const T3 = "2026-01-04T00:00:00.000Z";

const submit = (base: WorkRecord, versionId: string, now = T1, actor = OWNER) =>
  applyWorkEvent(
    base,
    {
      type: "submit",
      versionId,
      title: "Demo",
      sceneCount: 3,
      sizeBytes: 1024,
      actorUserId: actor,
      noteFromAuthor: null,
    },
    { now, submissionId: `sub-${versionId}` },
  );

/** draft -> submitted -> in_review -> approved -> published */
function publishedWork(): WorkRecord {
  const s1 = submit(work(), "aaaaaaaaaaaaaaaa");
  if (!s1.ok) throw new Error(s1.message);
  const claim = applyWorkEvent(s1.work, { type: "claim_review", actorUserId: REVIEWER }, { now: T1 });
  if (!claim.ok) throw new Error(claim.message);
  const decided = applyWorkEvent(
    claim.work,
    {
      type: "decide",
      decision: "approve",
      reasonCodes: [],
      reasonText: "",
      checklist: {},
      actorUserId: REVIEWER,
    },
    { now: T2 },
  );
  if (!decided.ok) throw new Error(decided.message);
  const published = applyWorkEvent(
    decided.work,
    { type: "publish", actorUserId: "user-admin" },
    { now: T3 },
  );
  if (!published.ok) throw new Error(published.message);
  return published.work;
}

describe("claiming a game id", () => {
  it("allows an unclaimed id and the same owner, refuses another account", () => {
    expect(canClaimGameId(null, OWNER)).toBe(true);
    expect(canClaimGameId(work(), OWNER)).toBe(true);
    expect(canClaimGameId(work(), OTHER)).toBe(false);
  });

  it("refuses a submit from a non-owner with game_id_taken", () => {
    const result = submit(work({ state: "published" }), "bbbbbbbbbbbbbbbb", T1, OTHER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("game_id_taken");
  });
});

describe("submit", () => {
  it("never moves the published pointer", () => {
    const live = publishedWork();
    expect(live.publishedVersionId).toBe("aaaaaaaaaaaaaaaa");

    const next = submit(live, "bbbbbbbbbbbbbbbb", T3);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    // The whole point: a new submission must not change what players see.
    expect(next.work.publishedVersionId).toBe("aaaaaaaaaaaaaaaa");
    expect(next.work.latestVersionId).toBe("bbbbbbbbbbbbbbbb");
    // Nor may it take the work offline while the update waits for review.
    expect(next.work.state).toBe("published");
  });

  it("treats an already-submitted version as a duplicate", () => {
    const first = submit(work(), "aaaaaaaaaaaaaaaa");
    expect(first.ok).toBe(true);
    const again = submit(work({ versions: first.ok ? first.work.versions : [] }), "aaaaaaaaaaaaaaaa", T2);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("duplicate_version");
  });

  it("refuses archived works until restored", () => {
    const archived = work({ state: "archived" });
    const result = submit(archived, "cccccccccccccccc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("work_archived");
  });

  it("bumps revision and does not mutate the input", () => {
    const base = work();
    const frozen = JSON.stringify(base);
    const result = submit(base, "aaaaaaaaaaaaaaaa");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.work.revision).toBe(base.revision + 1);
    expect(JSON.stringify(base)).toBe(frozen);
  });
});

describe("review", () => {
  it("only claims a submitted work", () => {
    const draft = work();
    const claim = applyWorkEvent(draft, { type: "claim_review", actorUserId: REVIEWER }, { now: T1 });
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.code).toBe("invalid_state");
  });

  it("marks the submission and version in review", () => {
    const s1 = submit(work(), "aaaaaaaaaaaaaaaa");
    if (!s1.ok) throw new Error(s1.message);
    const claim = applyWorkEvent(s1.work, { type: "claim_review", actorUserId: REVIEWER }, { now: T1 });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.work.state).toBe("in_review");
    expect(claim.work.submissions[0].status).toBe("in_review");
    expect(claim.work.submissions[0].assignedReviewerId).toBe(REVIEWER);
  });

  it("requires a reason code for anything but approve", () => {
    const s1 = submit(work(), "aaaaaaaaaaaaaaaa");
    if (!s1.ok) throw new Error(s1.message);
    const claim = applyWorkEvent(s1.work, { type: "claim_review", actorUserId: REVIEWER }, { now: T1 });
    if (!claim.ok) throw new Error(claim.message);

    const rejected = applyWorkEvent(
      claim.work,
      {
        type: "decide",
        decision: "request_changes",
        reasonCodes: [],
        reasonText: "",
        checklist: {},
        actorUserId: REVIEWER,
      },
      { now: T2 },
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe("reason_required");
  });

  it("moves to changes_requested and records the reason", () => {
    const s1 = submit(work(), "aaaaaaaaaaaaaaaa");
    if (!s1.ok) throw new Error(s1.message);
    const claim = applyWorkEvent(s1.work, { type: "claim_review", actorUserId: REVIEWER }, { now: T1 });
    if (!claim.ok) throw new Error(claim.message);
    const decided = applyWorkEvent(
      claim.work,
      {
        type: "decide",
        decision: "request_changes",
        reasonCodes: ["location_implausible"],
        reasonText: "第二个点进不去。",
        checklist: { played: true },
        actorUserId: REVIEWER,
      },
      { now: T2 },
    );
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.work.state).toBe("changes_requested");
    expect(decided.work.submissions[0].review?.reasonCodes).toEqual(["location_implausible"]);
    expect(decided.work.versions[0].status).toBe("rejected");
  });
});

describe("publish", () => {
  it("refuses to publish anything not approved", () => {
    const s1 = submit(work(), "aaaaaaaaaaaaaaaa");
    if (!s1.ok) throw new Error(s1.message);
    const result = applyWorkEvent(s1.work, { type: "publish", actorUserId: "user-admin" }, { now: T2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_state");
  });

  it("promotes the approved version and marks the previous one superseded", () => {
    const live = publishedWork();
    expect(live.state).toBe("published");
    expect(live.publishedVersionId).toBe("aaaaaaaaaaaaaaaa");

    const second = submit(live, "bbbbbbbbbbbbbbbb", T3);
    if (!second.ok) throw new Error(second.message);
    const claim = applyWorkEvent(second.work, { type: "claim_review", actorUserId: REVIEWER }, { now: T3 });
    if (!claim.ok) throw new Error(claim.message);
    const decided = applyWorkEvent(
      claim.work,
      {
        type: "decide",
        decision: "approve",
        reasonCodes: [],
        reasonText: "",
        checklist: {},
        actorUserId: REVIEWER,
      },
      { now: T3 },
    );
    if (!decided.ok) throw new Error(decided.message);

    const published = applyWorkEvent(
      decided.work,
      { type: "publish", actorUserId: "user-admin" },
      { now: T3 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.work.publishedVersionId).toBe("bbbbbbbbbbbbbbbb");
    const previous = published.work.versions.find((v) => v.versionId === "aaaaaaaaaaaaaaaa");
    expect(previous?.status).toBe("superseded");
  });

  it("resolvePublishTarget picks the approved version, not merely the newest", () => {
    const live = publishedWork();
    const withPending = submit(live, "cccccccccccccccc", T3);
    if (!withPending.ok) throw new Error(withPending.message);
    // Newest is ccc… but it is pending; the target must stay the approved one.
    expect(resolvePublishTarget(withPending.work)?.versionId).toBe("aaaaaaaaaaaaaaaa");
  });
});

describe("withdraw / unlist / restore / archive", () => {
  it("withdraw hides the work but keeps the version data", () => {
    const live = publishedWork();
    const withdrawn = applyWorkEvent(
      live,
      { type: "withdraw", actorUserId: "user-admin" },
      { now: T3 },
    );
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(withdrawn.work.state).toBe("withdrawn");
    // Data retained: this is a state flip, never a delete.
    expect(withdrawn.work.publishedVersionId).toBe("aaaaaaaaaaaaaaaa");
    expect(withdrawn.work.versions).toHaveLength(1);
  });

  it("unlist keeps the link playable but removes it from the catalogue", () => {
    const live = publishedWork();
    const unlisted = applyWorkEvent(live, { type: "unlist", actorUserId: "user-admin" }, { now: T3 });
    expect(unlisted.ok).toBe(true);
    if (!unlisted.ok) return;
    expect(unlisted.work.state).toBe("unlisted");
    expect(unlisted.work.publishedVersionId).toBe("aaaaaaaaaaaaaaaa");
  });

  it("restore repoints at a restorable approved version", () => {
    const live = publishedWork();
    const withdrawn = applyWorkEvent(live, { type: "withdraw", actorUserId: "x" }, { now: T3 });
    if (!withdrawn.ok) throw new Error(withdrawn.message);
    const restored = applyWorkEvent(withdrawn.work, { type: "restore", actorUserId: "x" }, { now: T3 });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.work.state).toBe("published");
    expect(restored.work.publishedVersionId).toBe("aaaaaaaaaaaaaaaa");
  });

  it("refuses to archive a work that is mid-review", () => {
    const s1 = submit(work(), "aaaaaaaaaaaaaaaa");
    if (!s1.ok) throw new Error(s1.message);
    const claim = applyWorkEvent(s1.work, { type: "claim_review", actorUserId: REVIEWER }, { now: T1 });
    if (!claim.ok) throw new Error(claim.message);
    const archived = applyWorkEvent(claim.work, { type: "archive", actorUserId: "x" }, { now: T2 });
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.code).toBe("invalid_state");
  });

  it("findRestorableVersion tolerates a dangling publishedVersionId", () => {
    const live = publishedWork();
    const broken: WorkRecord = { ...live, publishedVersionId: "deadbeefdeadbeef" };
    expect(findRestorableVersion(broken)?.versionId).toBe("aaaaaaaaaaaaaaaa");
  });
});

describe("transition table", () => {
  it("offers only meaningful actions per state", () => {
    expect(allowedEventsFor("in_review")).toEqual(["decide"]);
    expect(allowedEventsFor("archived")).toEqual(["restore"]);
    expect(allowedEventsFor("published")).toContain("withdraw");
    expect(allowedEventsFor("draft")).toContain("submit");
  });
});
