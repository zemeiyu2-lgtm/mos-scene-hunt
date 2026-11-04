/**
 * Test environment for the city subsystem: temp registry + temp city store.
 *
 * Deliberately self-contained (no shared helper) so the city tests can seed
 * work documents directly instead of driving the whole publish pipeline.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getRegistry, resetRegistryForTests, type RegistryStore } from "@/lib/registry/store";
import { resetCityStoreForTests } from "@/lib/cities/store";
import {
  REGISTRY_SCHEMA_VERSION,
  type Role,
  type UserRecord,
  type WorkRecord,
  type WorkState,
} from "@/lib/registry/types";

export interface CityTestEnv {
  root: string;
  registry: RegistryStore;
  cleanup: () => Promise<void>;
}

export async function setupCityEnv(): Promise<CityTestEnv> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mos-cities-"));
  process.env.REGISTRY_STORE = "file";
  process.env.REGISTRY_DIR = path.join(root, "registry");
  process.env.CITIES_STORE = "file";
  process.env.CITIES_DIR = path.join(root, "cities");
  resetRegistryForTests();
  resetCityStoreForTests();
  const registry = getRegistry();
  return {
    root,
    registry,
    cleanup: async () => {
      resetRegistryForTests();
      resetCityStoreForTests();
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export function user(id: string, role: Role = "creator"): UserRecord {
  return {
    id,
    email: `${id}@example.com`,
    passwordHash: "x",
    passwordSalt: "y",
    displayName: id,
    role,
    status: "active",
    createdAt: "2026-11-01T00:00:00.000Z",
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  };
}

export async function seedUser(registry: RegistryStore, id: string, role: Role = "creator"): Promise<UserRecord> {
  const record = user(id, role);
  await registry.putUser(record);
  return record;
}

export interface SeedWorkInput {
  gameId: string;
  ownerUserId: string;
  state: WorkState;
  cityId?: string;
  /** Required for states where publish/restore needs an approved version. */
  withApprovedVersion?: boolean;
}

export async function seedWork(registry: RegistryStore, input: SeedWorkInput): Promise<WorkRecord> {
  const now = "2026-11-04T00:00:00.000Z";
  const version = {
    versionId: "v1",
    title: "Test hunt",
    sceneCount: 3,
    sizeBytes: 100,
    submittedBy: input.ownerUserId,
    createdAt: now,
    status: "approved" as const,
    publishedAt: null,
  };
  const withVersion = input.withApprovedVersion ?? ["approved", "published", "unlisted", "withdrawn"].includes(input.state);
  const work: WorkRecord = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    gameId: input.gameId,
    ownerUserId: input.ownerUserId,
    title: "Test hunt",
    language: "zh-CN",
    state: input.state,
    publishedVersionId: withVersion ? "v1" : null,
    latestVersionId: withVersion ? "v1" : null,
    versions: withVersion ? [version] : [],
    submissions: [],
    createdAt: now,
    updatedAt: now,
    revision: 0,
    ...(input.cityId ? { cityId: input.cityId } : {}),
  };
  const created = await registry.createWork(work);
  if (!created.ok) throw new Error(`seedWork 失败：${input.gameId}`);
  return work;
}

export function actor(record: UserRecord) {
  return { user: record, ipHash: "ip", uaHash: "ua" };
}
