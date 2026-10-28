/**
 * Registry persistence — one aggregate document per work, plus users,
 * sessions and an append-only audit stream.
 *
 * Two adapters behind one interface:
 *  - filesystem (default): atomic `write tmp -> rename`, per-key in-process
 *    lock, read-back verification. Correct on a single Node host.
 *  - Vercel Blob: same layout, `allowOverwrite` on mutable documents.
 *
 * Concurrency honesty (documented, not hidden):
 *  Blob has no compare-and-swap. `putWork` performs a read-verify-write inside
 *  a process-local lock, which serialises every writer in the SAME instance.
 *  Two DIFFERENT serverless instances can still interleave and lose one
 *  update; the `revision` field makes that detectable after the fact, and the
 *  filesystem adapter has no such gap. This is the same trade-off already
 *  accepted by `lib/publish/blob-store.ts`, and it is why the admin surface
 *  is designed for a small reviewer team rather than concurrent mass editing.
 */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, put, BlobNotFoundError } from "@vercel/blob";
import { GAME_ID_PATTERN } from "../publish/version";
import {
  REGISTRY_SCHEMA_VERSION,
  type AuditRecord,
  type SessionRecord,
  type UserRecord,
  type WorkRecord,
} from "./types";

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface StoreWriteResult {
  ok: boolean;
  /** True when the write was rejected because the stored document moved on. */
  conflict?: boolean;
}

export interface RegistryStore {
  /** Human label used on the admin system-status card. */
  readonly kind: "file" | "blob";

  getUser(userId: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  putUser(user: UserRecord): Promise<StoreWriteResult>;
  listUsers(): Promise<UserRecord[]>;

  getSession(tokenHash: string): Promise<SessionRecord | null>;
  putSession(session: SessionRecord): Promise<StoreWriteResult>;
  revokeSession(tokenHash: string, at: string): Promise<void>;

  getWork(gameId: string): Promise<WorkRecord | null>;
  listWorks(): Promise<WorkRecord[]>;
  /** Creates only when absent; `conflict` means someone claimed the id first. */
  createWork(work: WorkRecord): Promise<StoreWriteResult>;
  /** Writes only when the stored `revision` matches `expectedRevision`. */
  putWork(work: WorkRecord, expectedRevision: number): Promise<StoreWriteResult>;

  appendAudit(record: AuditRecord): Promise<void>;
  listAudit(limit: number): Promise<AuditRecord[]>;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                     */
/* ------------------------------------------------------------------ */

const locks = new Map<string, Promise<unknown>>();

/** Serialises work on one key inside this process (same pattern as lib/publish). */
function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  locks.set(key, settled);
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return run;
}

function assertGameId(gameId: string): void {
  if (!GAME_ID_PATTERN.test(gameId)) throw new Error(`gameId 不合法：${gameId}`);
}

function assertUserId(userId: string): void {
  if (!USER_ID_PATTERN.test(userId)) throw new Error(`userId 不合法：${userId}`);
}

function assertTokenHash(tokenHash: string): void {
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) throw new Error("tokenHash 形态非法");
}

/** Parses a work document and rejects anything structurally unusable. */
export function parseWork(raw: string, gameId: string): WorkRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const w = parsed as WorkRecord;
  if (w.schemaVersion !== REGISTRY_SCHEMA_VERSION) return null;
  if (w.gameId !== gameId) return null;
  if (typeof w.ownerUserId !== "string" || !w.ownerUserId) return null;
  if (typeof w.state !== "string") return null;
  if (!Array.isArray(w.versions) || !Array.isArray(w.submissions)) return null;
  if (typeof w.revision !== "number" || !Number.isFinite(w.revision)) return null;
  return w;
}

/* ------------------------------------------------------------------ */
/* Filesystem adapter                                                 */
/* ------------------------------------------------------------------ */

export function createFileRegistry(root: string): RegistryStore {
  const dirs = {
    users: path.join(root, "users"),
    sessions: path.join(root, "sessions"),
    works: path.join(root, "works"),
    audit: path.join(root, "audit"),
  };

  const ensure = async (dir: string): Promise<void> => {
    await mkdir(dir, { recursive: true });
  };

  const readJson = async (file: string): Promise<string | null> => {
    try {
      return await readFile(file, "utf8");
    } catch {
      return null;
    }
  };

  /** Atomic write + read-back verification; a silent torn write is not acceptable. */
  const writeJsonAtomic = async (file: string, body: string): Promise<void> => {
    await ensure(path.dirname(file));
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, file);
    const back = await readFile(file, "utf8");
    if (back !== body) throw new Error(`写入校验失败：${path.basename(file)}`);
  };

  const readDirJson = async <T>(dir: string, parse: (raw: string) => T | null): Promise<T[]> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out: T[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readJson(path.join(dir, name));
      if (raw === null) continue;
      const parsed = parse(raw);
      if (parsed) out.push(parsed);
    }
    return out;
  };

  return {
    kind: "file",

    async getUser(userId) {
      if (!USER_ID_PATTERN.test(userId)) return null;
      const raw = await readJson(path.join(dirs.users, `${userId}.json`));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as UserRecord;
      } catch {
        return null;
      }
    },

    async getUserByEmail(email) {
      const target = email.trim().toLowerCase();
      const users = await readDirJson<UserRecord>(dirs.users, (raw) => {
        try {
          return JSON.parse(raw) as UserRecord;
        } catch {
          return null;
        }
      });
      return users.find((u) => u.email === target) ?? null;
    },

    async putUser(user) {
      assertUserId(user.id);
      return withKeyLock(`user:${user.id}`, async () => {
        await writeJsonAtomic(path.join(dirs.users, `${user.id}.json`), JSON.stringify(user, null, 2));
        return { ok: true };
      });
    },

    async listUsers() {
      const users = await readDirJson<UserRecord>(dirs.users, (raw) => {
        try {
          return JSON.parse(raw) as UserRecord;
        } catch {
          return null;
        }
      });
      return users.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },

    async getSession(tokenHash) {
      if (!TOKEN_HASH_PATTERN.test(tokenHash)) return null;
      const raw = await readJson(path.join(dirs.sessions, `${tokenHash}.json`));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SessionRecord;
      } catch {
        return null;
      }
    },

    async putSession(session) {
      assertTokenHash(session.tokenHash);
      await writeJsonAtomic(
        path.join(dirs.sessions, `${session.tokenHash}.json`),
        JSON.stringify(session, null, 2),
      );
      return { ok: true };
    },

    async revokeSession(tokenHash, at) {
      if (!TOKEN_HASH_PATTERN.test(tokenHash)) return;
      const raw = await readJson(path.join(dirs.sessions, `${tokenHash}.json`));
      if (!raw) return;
      try {
        const session = JSON.parse(raw) as SessionRecord;
        session.revokedAt = at;
        await writeJsonAtomic(
          path.join(dirs.sessions, `${tokenHash}.json`),
          JSON.stringify(session, null, 2),
        );
      } catch {
        /* a corrupt session record is already unusable */
      }
    },

    async getWork(gameId) {
      if (!GAME_ID_PATTERN.test(gameId)) return null;
      const raw = await readJson(path.join(dirs.works, `${gameId}.json`));
      return raw === null ? null : parseWork(raw, gameId);
    },

    async listWorks() {
      const works = await readDirJson<WorkRecord>(dirs.works, (raw) => {
        try {
          const id = (JSON.parse(raw) as WorkRecord).gameId;
          return GAME_ID_PATTERN.test(id ?? "") ? parseWork(raw, id) : null;
        } catch {
          return null;
        }
      });
      return works.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },

    async createWork(work) {
      assertGameId(work.gameId);
      return withKeyLock(`work:${work.gameId}`, async () => {
        const existing = await readJson(path.join(dirs.works, `${work.gameId}.json`));
        if (existing !== null) return { ok: false, conflict: true };
        await writeJsonAtomic(
          path.join(dirs.works, `${work.gameId}.json`),
          JSON.stringify(work, null, 2),
        );
        return { ok: true };
      });
    },

    async putWork(work, expectedRevision) {
      assertGameId(work.gameId);
      return withKeyLock(`work:${work.gameId}`, async () => {
        const raw = await readJson(path.join(dirs.works, `${work.gameId}.json`));
        if (raw === null) return { ok: false, conflict: true };
        const current = parseWork(raw, work.gameId);
        if (!current || current.revision !== expectedRevision) {
          return { ok: false, conflict: true };
        }
        await writeJsonAtomic(
          path.join(dirs.works, `${work.gameId}.json`),
          JSON.stringify(work, null, 2),
        );
        return { ok: true };
      });
    },

    async appendAudit(record) {
      // One object per record: append-only by construction (never rewritten),
      // and ordering is recovered from the filename timestamp.
      const name = `${record.createdAt.replace(/[:.]/g, "-")}-${record.id}.json`;
      await writeJsonAtomic(path.join(dirs.audit, name), JSON.stringify(record, null, 2));
    },

    async listAudit(limit) {
      let names: string[];
      try {
        names = await readdir(dirs.audit);
      } catch {
        return [];
      }
      const picked = names.filter((n) => n.endsWith(".json")).sort().slice(-limit);
      const out: AuditRecord[] = [];
      for (const name of picked) {
        const raw = await readJson(path.join(dirs.audit, name));
        if (!raw) continue;
        try {
          out.push(JSON.parse(raw) as AuditRecord);
        } catch {
          /* skip corrupt audit line rather than fail the page */
        }
      }
      return out.reverse();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vercel Blob adapter                                                */
/* ------------------------------------------------------------------ */

const BLOB_NOT_FOUND_MESSAGE = /not found|does not exist/i;

export function createBlobRegistry(prefix: string): RegistryStore {
  const base = prefix.replace(/^\/+|\/+$/g, "");
  const at = (key: string) => `${base}/${key}`;

  const readText = async (key: string, fresh = true): Promise<string | null> => {
    try {
      const result = await get(at(key), { access: "private", useCache: !fresh });
      if (!result || result.statusCode !== 200) return null;
      return await new Response(result.stream).text();
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      const message = error instanceof Error ? error.message : String(error);
      if (BLOB_NOT_FOUND_MESSAGE.test(message)) return null;
      throw error;
    }
  };

  const writeText = async (key: string, body: string, overwrite: boolean): Promise<void> => {
    await put(at(key), body, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 0,
      allowOverwrite: overwrite,
    });
  };

  const listKeys = async (keyPrefix: string): Promise<string[]> => {
    const out: string[] = [];
    let cursor: string | undefined;
    // Pagination is explicit: a silently truncated listing would hide works.
    for (;;) {
      const page = await list({ prefix: at(keyPrefix), cursor, limit: 1000 });
      for (const blob of page.blobs) out.push(blob.pathname);
      if (!page.hasMore || !page.cursor) break;
      cursor = page.cursor;
    }
    return out;
  };

  return {
    kind: "blob",

    async getUser(userId) {
      if (!USER_ID_PATTERN.test(userId)) return null;
      const raw = await readText(`users/${userId}.json`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as UserRecord;
      } catch {
        return null;
      }
    },

    async getUserByEmail(email) {
      const target = email.trim().toLowerCase();
      const users = await this.listUsers();
      return users.find((u) => u.email === target) ?? null;
    },

    async putUser(user) {
      assertUserId(user.id);
      return withKeyLock(`user:${user.id}`, async () => {
        await writeText(`users/${user.id}.json`, JSON.stringify(user, null, 2), true);
        return { ok: true };
      });
    },

    async listUsers() {
      const keys = await listKeys("users/");
      const out: UserRecord[] = [];
      for (const key of keys) {
        if (!key.endsWith(".json")) continue;
        const raw = await readText(key.slice(base.length + 1), false);
        if (!raw) continue;
        try {
          out.push(JSON.parse(raw) as UserRecord);
        } catch {
          /* skip */
        }
      }
      return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },

    async getSession(tokenHash) {
      if (!TOKEN_HASH_PATTERN.test(tokenHash)) return null;
      const raw = await readText(`sessions/${tokenHash}.json`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SessionRecord;
      } catch {
        return null;
      }
    },

    async putSession(session) {
      assertTokenHash(session.tokenHash);
      await writeText(`sessions/${session.tokenHash}.json`, JSON.stringify(session, null, 2), true);
      return { ok: true };
    },

    async revokeSession(tokenHash, at) {
      if (!TOKEN_HASH_PATTERN.test(tokenHash)) return;
      const raw = await readText(`sessions/${tokenHash}.json`);
      if (!raw) return;
      try {
        const session = JSON.parse(raw) as SessionRecord;
        session.revokedAt = at;
        await writeText(
          `sessions/${tokenHash}.json`,
          JSON.stringify(session, null, 2),
          true,
        );
      } catch {
        /* ignore */
      }
    },

    async getWork(gameId) {
      if (!GAME_ID_PATTERN.test(gameId)) return null;
      const raw = await readText(`works/${gameId}.json`);
      return raw === null ? null : parseWork(raw, gameId);
    },

    async listWorks() {
      const keys = await listKeys("works/");
      const out: WorkRecord[] = [];
      for (const key of keys) {
        const name = key.split("/").pop() ?? "";
        if (!name.endsWith(".json")) continue;
        const gameId = name.slice(0, -5);
        if (!GAME_ID_PATTERN.test(gameId)) continue;
        const raw = await readText(`works/${gameId}.json`, false);
        if (!raw) continue;
        const parsed = parseWork(raw, gameId);
        if (parsed) out.push(parsed);
      }
      return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },

    async createWork(work) {
      assertGameId(work.gameId);
      return withKeyLock(`work:${work.gameId}`, async () => {
        const existing = await readText(`works/${work.gameId}.json`);
        if (existing !== null) return { ok: false, conflict: true };
        await writeText(`works/${work.gameId}.json`, JSON.stringify(work, null, 2), false);
        return { ok: true };
      });
    },

    async putWork(work, expectedRevision) {
      assertGameId(work.gameId);
      return withKeyLock(`work:${work.gameId}`, async () => {
        const raw = await readText(`works/${work.gameId}.json`);
        if (raw === null) return { ok: false, conflict: true };
        const current = parseWork(raw, work.gameId);
        if (!current || current.revision !== expectedRevision) {
          return { ok: false, conflict: true };
        }
        await writeText(`works/${work.gameId}.json`, JSON.stringify(work, null, 2), true);
        return { ok: true };
      });
    },

    async appendAudit(record) {
      const name = `audit/${record.createdAt.replace(/[:.]/g, "-")}-${record.id}.json`;
      await writeText(name, JSON.stringify(record, null, 2), false);
    },

    async listAudit(limit) {
      const keys = await listKeys("audit/");
      const sorted = keys.filter((k) => k.endsWith(".json")).sort().slice(-limit);
      const out: AuditRecord[] = [];
      for (const key of sorted) {
        const raw = await readText(key.slice(base.length + 1), false);
        if (!raw) continue;
        try {
          out.push(JSON.parse(raw) as AuditRecord);
        } catch {
          /* skip */
        }
      }
      return out.reverse();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Selection                                                          */
/* ------------------------------------------------------------------ */

let cached: RegistryStore | null = null;

/**
 * `REGISTRY_STORE=blob` selects Vercel Blob (persistent, shared across
 * serverless instances). Anything else uses `REGISTRY_DIR` (default
 * `.registry/`, git-ignored) — the zero-credential local mode used by tests
 * and by `npm run dev`.
 */
export function getRegistry(): RegistryStore {
  if (cached) return cached;
  const kind = process.env.REGISTRY_STORE?.trim().toLowerCase();
  if (kind === "blob") {
    const prefix = process.env.REGISTRY_BLOB_PREFIX?.trim() || "registry";
    cached = createBlobRegistry(prefix);
  } else {
    const dir =
      process.env.REGISTRY_DIR?.trim() || path.join(process.cwd(), ".registry");
    cached = createFileRegistry(dir);
  }
  return cached;
}

/** Test seam: forget the cached adapter after changing env or temp dirs. */
export function resetRegistryForTests(): void {
  cached = null;
}
