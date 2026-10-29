/**
 * Registry data model — the single source of truth for works, versions,
 * submissions, reviews and audit records.
 *
 * Design constraints taken from `docs/后台总体设计与分阶段实施方案` §4.2:
 *
 *  1. Review metadata NEVER enters the game pack. A pack stays
 *     `{format, formatVersion, game, assets?}` so old clients and offline
 *     play keep working; ownership/review/publish state lives here only.
 *  2. A `gameId` is claimed once. After a work document exists, only its
 *     owner may submit further versions. This is what closes the current
 *     hijack hole (anonymous publish keyed on a client-chosen game.id).
 *  3. Public reads resolve `publishedVersionId`, never `latestVersionId`.
 *     "Latest submitted" and "currently published" are different facts.
 *
 * Storage shape: ONE aggregate document per work (`works/<gameId>.json`)
 * holding its versions and submissions inline. That keeps a state change to
 * a single atomic object write instead of a multi-object transaction, which
 * matters because the Blob adapter has no compare-and-swap. Queue listing is
 * a scan over work documents — acceptable while the catalogue is small, and
 * documented as the scaling boundary.
 */

export const REGISTRY_SCHEMA_VERSION = 1;

export type Role = "creator" | "reviewer" | "admin";

/** Effective permission of a role; ordered so `>=` comparisons are meaningful. */
export const ROLE_RANK: Record<Role, number> = {
  creator: 1,
  reviewer: 2,
  admin: 3,
};

export function isRole(value: unknown): value is Role {
  return value === "creator" || value === "reviewer" || value === "admin";
}

/* ------------------------------------------------------------------ */
/* User + session                                                     */
/* ------------------------------------------------------------------ */

export interface UserRecord {
  id: string;
  email: string;
  /** scrypt hash, hex. Never the password itself. */
  passwordHash: string;
  /** Per-user salt, hex. */
  passwordSalt: string;
  displayName: string;
  role: Role;
  status: "active" | "suspended";
  createdAt: string;
  lastLoginAt: string | null;
  /** Consecutive failed logins; reset on success. Drives the lockout window. */
  failedLoginCount: number;
  lockedUntil: string | null;
  /**
   * Credential generation. Bumped on every password change; sessions issued
   * under an older generation are dead even if their revocation flag was
   * never written (a partial failure or timeout must not leave a usable
   * session behind). Absent on records created before this field existed and
   * treated as 0, so existing users are not logged out by the upgrade.
   */
  credentialEpoch?: number;
}

/** Everything a client or a page is allowed to see about a user. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: "active" | "suspended";
  createdAt: string;
  lastLoginAt: string | null;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export interface SessionRecord {
  /** sha256(token) — the raw bearer token is never stored. */
  tokenHash: string;
  userId: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /**
   * Credential generation this session was issued under. A session whose
   * epoch does not match its user's current epoch is treated as revoked
   * (see `verifySession`), which is what makes "password changed" defeat a
   * revocation pass that failed or was cut short. Absent = 0.
   */
  credentialEpoch?: number;
  /** Truncated hashes only; raw IP/UA are not persisted. */
  ipHash: string;
  uaHash: string;
}

/* ------------------------------------------------------------------ */
/* Work / version / submission / review                               */
/* ------------------------------------------------------------------ */

/**
 * Work lifecycle. `rejected` and `published` are both reachable review
 * outcomes; only `published`/`unlisted` make a version publicly readable.
 */
export type WorkState =
  | "draft"
  | "submitted"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "published"
  | "unlisted"
  | "withdrawn"
  | "archived";

/** Public readability is exactly this predicate — used by the read API too. */
export function isPubliclyReadable(state: WorkState): boolean {
  return state === "published" || state === "unlisted";
}

export type VersionStatus = "pending" | "approved" | "rejected" | "superseded";

export interface VersionRecord {
  /** Content hash from `deriveVersionId` — immutable identity of the bytes. */
  versionId: string;
  title: string;
  sceneCount: number;
  sizeBytes: number;
  submittedBy: string;
  createdAt: string;
  status: VersionStatus;
  /** Set when this version was published at some point (audit value). */
  publishedAt: string | null;
}

export type SubmissionStatus = "pending" | "in_review" | "approved" | "rejected";

export type ReviewDecision = "approve" | "request_changes" | "reject";

export interface ReviewRecord {
  reviewerId: string;
  decision: ReviewDecision;
  /** Structured reason codes; required for anything but approve. */
  reasonCodes: string[];
  reasonText: string;
  checklist: Record<string, boolean>;
  decidedAt: string;
}

export interface SubmissionRecord {
  id: string;
  versionId: string;
  submittedBy: string;
  submittedAt: string;
  noteFromAuthor: string | null;
  status: SubmissionStatus;
  assignedReviewerId: string | null;
  review: ReviewRecord | null;
}

export interface WorkRecord {
  schemaVersion: number;
  /** Equals `game.id`; claimed on first submission and then immutable. */
  gameId: string;
  ownerUserId: string;
  title: string;
  language: string;
  state: WorkState;
  /** The ONLY version the public read path may serve. */
  publishedVersionId: string | null;
  /** Newest submitted version, possibly unreviewed. Never used for public reads. */
  latestVersionId: string | null;
  versions: VersionRecord[];
  submissions: SubmissionRecord[];
  createdAt: string;
  updatedAt: string;
  /** Bumped on every successful write; used for optimistic concurrency. */
  revision: number;
}

/* ------------------------------------------------------------------ */
/* Audit                                                              */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_change"
  | "auth.password_change_failed"
  | "user.create"
  | "user.role_change"
  | "user.status_change"
  | "work.submit"
  | "work.claim_review"
  | "review.decide"
  | "work.publish"
  | "work.withdraw"
  | "work.unlist"
  | "work.restore"
  | "work.archive"
  | "work.transfer_owner"
  | "work.import_legacy";

export interface AuditRecord {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: AuditAction;
  targetType: "user" | "work" | "version" | "submission";
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipHash: string;
  uaHash: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Narrow inputs                                                      */
/* ------------------------------------------------------------------ */

/** A submission as it arrives from the publish endpoint. */
export interface SubmitInput {
  gameId: string;
  versionId: string;
  title: string;
  language: string;
  sceneCount: number;
  sizeBytes: number;
  noteFromAuthor: string | null;
  actorUserId: string;
}
