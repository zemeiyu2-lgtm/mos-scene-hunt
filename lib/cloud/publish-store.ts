/**
 * lib/cloud/publish-store - 发布通道的服务端存储（只在 Node 环境使用）。
 *
 * 存三类东西：
 *   content/cloud/publish-store/<digest>.json   已通过校验的待落库游戏包（按内容摘要命名，天然去重）
 *   content/cloud/publish-store/<digest>.meta.json  授权记录（谁、何时、哪个 id），便于审计
 *   content/cloud/publish-store/catalog-entries.json 待合并进线上目录的**草稿**条目
 *
 * 为什么不用 Blob / 数据库：本机与当前部署都没有对应凭据，而线上只有只读文件系统。
 * 把已批准的包写进 Vercel 的临时文件系统会在下次部署后丢失，所以写盘只用于
 * 「本机/自托管 Node 进程内的过渡存储」，并由 GET 以令牌取回；
 * 真正的持久化是维护者用 `npm run cloud:publish` 落进 `content/` 并提交。
 *
 * 目录条目一律以 `draft` 落库：发布接口无法区分「谁」提交了什么，只有维护者在
 * 落库时显式把 status 改成 published，才可能出现在玩家可见的云端目录里。
 */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PUBLISH_STORE_CATALOG,
  PUBLISH_STORE_DIR,
  type AcceptedPackage,
  type CatalogDraft,
  type ExistingCatalogEntry,
} from "./publish-server";

function storeDir(root = process.cwd()): string {
  return path.join(root, PUBLISH_STORE_DIR);
}

function packagePath(digest: string, root = process.cwd()): string {
  return path.join(storeDir(root), `${digest}.json`);
}

function metaPath(digest: string, root = process.cwd()): string {
  return path.join(storeDir(root), `${digest}.meta.json`);
}

export interface StoredPackageMeta {
  digest: string;
  gameId: string;
  packFile: string;
  title: string;
  sceneCount: number;
  receivedAt: string;
  /** 提交时的提醒条数，落库时供维护者复核。 */
  warningCount: number;
  /** 该包在目录里应出现的状态。接口永远写 draft，维护者落库时改成 published。 */
  status: "draft";
}

/** 读取已批准的游戏包原文。找不到返回 null（由调用方决定 404 语义）。 */
export async function readStoredPackage(digest: string, root = process.cwd()): Promise<string | null> {
  try {
    return await readFile(packagePath(digest, root), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export async function readStoredMeta(digest: string, root = process.cwd()): Promise<StoredPackageMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(digest, root), "utf8")) as StoredPackageMeta;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export interface StoreResult {
  /** 本次是否新建了存储条目（false = 同内容已存在，幂等）。 */
  created: boolean;
  meta: StoredPackageMeta;
}

/**
 * 保存已批准的游戏包。
 *
 * 以摘要为文件名，所以「同内容重复提交」不会产生第二份，也不会互相覆盖。
 */
export async function storeAcceptedPackage(
  accepted: AcceptedPackage,
  root = process.cwd(),
  now: Date = new Date(),
): Promise<StoreResult> {
  const digest = accepted.digest;
  const existing = await readStoredMeta(digest, root);
  await mkdir(storeDir(root), { recursive: true });

  // 先写包体再写 meta：读的一方只认 meta，避免出现「有 meta、没包体」的窗口。
  const bodyExists = (await readStoredPackage(digest, root)) !== null;
  if (!bodyExists) {
    await writeAtomic(packagePath(digest, root), accepted.canonicalJson);
  }

  const meta: StoredPackageMeta = {
    digest,
    gameId: accepted.game.id,
    packFile: accepted.packFile,
    title: accepted.game.title,
    sceneCount: accepted.game.scenes.length,
    receivedAt: existing?.receivedAt ?? now.toISOString(),
    warningCount: accepted.warnings.length,
    status: "draft",
  };
  if (!existing) {
    await writeAtomic(metaPath(digest, root), JSON.stringify(meta, null, 2));
  }
  return { created: !existing, meta };
}

/** 读取发布存储里的目录草稿（不存在时返回空数组）。 */
export async function readStoredCatalogDrafts(root = process.cwd()): Promise<CatalogDraft[]> {
  try {
    const raw = await readFile(path.join(root, PUBLISH_STORE_CATALOG), "utf8");
    const parsed = JSON.parse(raw) as { games?: unknown };
    return Array.isArray(parsed.games) ? (parsed.games as CatalogDraft[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * 把草稿条目合并进发布存储的目录草稿文件。
 *
 * 同 id 覆盖旧草稿是刻意的：一个 id 在线上目录里只能有一条记录，否则玩家会看到
 * 两个同名游戏。覆盖前由 classifyDuplicate 在接口层挡住「顶掉别人 id」的情况。
 */
export async function upsertCatalogDraft(
  draft: CatalogDraft,
  root = process.cwd(),
): Promise<{ entries: CatalogDraft[]; updated: boolean }> {
  const drafts = await readStoredCatalogDrafts(root);
  const index = drafts.findIndex((item) => item.id === draft.id);
  const updated = index >= 0;
  const next = updated ? drafts.map((item, i) => (i === index ? draft : item)) : [...drafts, draft];
  await mkdir(storeDir(root), { recursive: true });
  await writeAtomic(
    path.join(root, PUBLISH_STORE_CATALOG),
    JSON.stringify({ version: "1.0", updatedAt: new Date().toISOString().slice(0, 10), games: next }, null, 2) + "\n",
  );
  return { entries: next, updated };
}

/** 读取线上目录（只读），供重复发布判定使用。损坏时按空目录处理并报告。 */
export async function readLiveCatalog(
  root = process.cwd(),
): Promise<{ entries: ExistingCatalogEntry[]; error?: string }> {
  const file = path.join(root, "content", "cloud", "catalog.json");
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { games?: unknown };
    const entries = Array.isArray(parsed.games) ? (parsed.games as ExistingCatalogEntry[]) : [];
    return { entries };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { entries: [], error: "线上目录不存在（content/cloud/catalog.json）。" };
    }
    return { entries: [], error: "线上目录不是合法 JSON：" + (err instanceof Error ? err.message : String(err)) };
  }
}

/** 同 id 的已存内容摘要（用于「完全相同的包重复提交」判定）。 */
export async function findStoredDigestForGame(
  gameId: string,
  root = process.cwd(),
): Promise<string | null> {
  const metas = await listStoredMetas(root);
  const mine = metas.filter((meta) => meta.gameId === gameId);
  if (mine.length === 0) return null;
  mine.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
  return mine[0].digest;
}

/**
 * 列出发布存储里的全部授权记录。
 *
 * 直接扫描目录而不是维护一份索引：索引会与目录文件不同步，而这里的条目数量
 * 取决于维护者手工发布的次数，规模很小。
 */
export async function listStoredMetas(root = process.cwd()): Promise<StoredPackageMeta[]> {
  let names: string[] = [];
  try {
    names = await readdir(storeDir(root));
  } catch {
    return [];
  }
  const metas: StoredPackageMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".meta.json")) continue;
    const digest = name.slice(0, -".meta.json".length);
    if (!/^[0-9a-f]{64}$/.test(digest)) continue;
    const meta = await readStoredMeta(digest, root);
    if (meta) metas.push(meta);
  }
  return metas;
}

/**
 * 原子写：先写 .tmp 再 rename。
 *
 * 并发提交时，rename 在 POSIX / Windows 上都是原子的，读者不会看到半个文件。
 */
async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}
