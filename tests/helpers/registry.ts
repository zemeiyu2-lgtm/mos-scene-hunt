/**
 * Shared test fixtures for the registry-backed API.
 *
 * Each test run gets its own temp directory for both the registry and the
 * published-version store, and the registry adapter cache is reset — otherwise
 * a module-level singleton would leak one test's data into the next.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { issueSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getRegistry, resetRegistryForTests } from "@/lib/registry/store";
import type { Role, UserRecord } from "@/lib/registry/types";

export const TEST_PASSWORD = "correct-horse-battery";

export interface TestEnv {
  root: string;
  cleanup: () => Promise<void>;
}

export async function setupRegistryEnv(): Promise<TestEnv> {
  const root = await mkdtemp(path.join(tmpdir(), "mos-admin-test-"));
  process.env.REGISTRY_DIR = path.join(root, "registry");
  process.env.PUBLISHED_GAMES_DIR = path.join(root, "published");
  delete process.env.REGISTRY_STORE;
  delete process.env.PUBLISHED_GAMES_STORE;
  resetRegistryForTests();
  return {
    root,
    cleanup: async () => {
      delete process.env.REGISTRY_DIR;
      delete process.env.PUBLISHED_GAMES_DIR;
      resetRegistryForTests();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function createUser(options: {
  email: string;
  role?: Role;
  password?: string;
  displayName?: string;
}): Promise<UserRecord> {
  const password = options.password ?? TEST_PASSWORD;
  const fields = await hashPassword(password);
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: randomUUID(),
    email: options.email.trim().toLowerCase(),
    passwordHash: fields.passwordHash,
    passwordSalt: fields.passwordSalt,
    displayName: options.displayName ?? options.email.split("@")[0],
    role: options.role ?? "creator",
    status: "active",
    createdAt: now,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  };
  await getRegistry().putUser(user);
  return user;
}

/** Issues a real session record and returns the cookie header value. */
export async function sessionCookieFor(user: UserRecord): Promise<string> {
  const { token } = await issueSession(getRegistry(), {
    userId: user.id,
    role: user.role,
    ipHash: "test-ip",
    uaHash: "test-ua",
  });
  return `${SESSION_COOKIE}=${token}`;
}

export function jsonRequest(
  url: string,
  options: { method?: string; body?: unknown; cookie?: string; contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "Content-Type": options.contentType ?? "application/json",
  };
  if (options.cookie) headers.cookie = options.cookie;
  const method = options.method ?? "POST";
  return new Request(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export function rawRequest(
  url: string,
  options: { method?: string; body?: string; cookie?: string; contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "Content-Type": options.contentType ?? "application/json",
  };
  if (options.cookie) headers.cookie = options.cookie;
  return new Request(url, { method: options.method ?? "POST", headers, body: options.body });
}
