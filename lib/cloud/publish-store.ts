/**
 * lib/cloud/publish-store - 发布通道的服务端存储门面（持久化版）。
 *
 * 这里**不再**把发布数据写进函数文件系统。Vercel 的函数文件系统是临时的：
 * 写进去的东西下一个请求可能就没了，重新部署更是必然丢失。正式发布数据
 * （包体、元数据、目录索引）一律落在 Vercel Blob，见 `lib/cloud/blob-store.ts`。
 *
 * 仓库内容层 `content/` 仍然保留，但角色变了：
 *   - 它是**随构建发布的官方内容**（静态示范游戏），只读；
 *   - 发布接口不会去写它（函数里也写不了），所以「发布」不会污染 Git 工作区。
 *
 * 本文件把「读哪个、写哪个、什么情况下算可下载」收在一处，route handler 与
 * 测试都只依赖这些函数，换存储实现时不需要改业务逻辑。
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  type IndexSnapshot,
  type PackPointer,
  type StoreIndex,
  pointerPathnameFor,
  readIndex,
  readPackMeta,
  readPublishedPack,
  updateIndexEntry,
  writePack,
} from "./blob-store";
import { type RawCatalogEntry, pointerToCatalogEntry } from "./catalog-source";

/** 索引读取结果的类型别名，供 route handler 使用。 */
export type { IndexSnapshot };

/** 与 `app/content/[file]` 路由使用同一套文件名约束，避免两边规则漂移。 */
const SAFE_PACK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

export function contentDir(root = process.cwd()): string {
  return path.join(root, "content");
}

export function isSafePackFile(file: unknown): file is string {
  return typeof file === "string" && SAFE_PACK_FILE.test(file) && !file.includes("..");
}

/* ------------------------------------------------------------------ */
/* 仓库内容层（只读）                                                   */
/* ------------------------------------------------------------------ */

/** 读取仓库内容层的目录条目。目录缺失或损坏时返回空数组 + 错误说明。 */
export async function readRepoCatalog(
  root = process.cwd(),
): Promise<{ entries: RawCatalogEntry[]; error?: string }> {
  const file = path.join(contentDir(root), "cloud", "catalog.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { entries: [] };
    return { entries: [], error: "服务器无法读取仓库内容目录。" };
  }
  try {
    const parsed = JSON.parse(raw) as { games?: unknown };
    const entries = Array.isArray(parsed.games) ? (parsed.games as RawCatalogEntry[]) : [];
    return { entries };
  } catch {
    return { entries: [], error: "仓库内容目录（content/cloud/catalog.json）不是合法 JSON。" };
  }
}

/** 读取仓库内容层里的包体。不存在返回 null。 */
export async function readRepoPack(packFile: string, root = process.cwd()): Promise<string | null> {
  if (!isSafePackFile(packFile)) return null;
  try {
    return await readFile(path.join(contentDir(root), packFile), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * 仓库里的包体是否可用：文件存在 + 能解析 + 包内 id 与条目一致。
 *
 * 第三条不是多余的：目录写错（复制粘贴别人的条目）时，玩家点了下载才会拿到
 * 一个不是他要的游戏。宁可目录少一条，也不要给一个错链接。
 */
export async function repoPackUsable(entry: RawCatalogEntry, root = process.cwd()): Promise<boolean> {
  if (!isSafePackFile(entry.packFile)) return false;
  const file = path.join(contentDir(root), entry.packFile);
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const parsed = JSON.parse(await readFile(file, "utf8")) as { id?: unknown };
    return parsed?.id === entry.id;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 已发布索引                                                          */
/* ------------------------------------------------------------------ */

/** 读取「已发布」索引。存储未接入时返回空索引（目录仍然要能用）。 */
export async function readPublishedIndex(): Promise<StoreIndex> {
  return readIndex();
}

/** 把索引转成目录条目。 */
export function indexToCatalogEntries(index: StoreIndex, drafts: RawCatalogEntry[] = []): RawCatalogEntry[] {
  const byId = new Map<string, RawCatalogEntry>();
  for (const draft of drafts) byId.set(draft.id, draft);
  return Object.entries(index.games).map(([gameId, pointer]) => {
    const extra = byId.get(gameId);
    return pointerToCatalogEntry(gameId, pointer, {
      author: typeof extra?.author === "string" ? extra.author : undefined,
      description: typeof extra?.description === "string" ? extra.description : undefined,
      language: typeof extra?.language === "string" ? extra.language : undefined,
      estimatedMinutes: typeof extra?.estimatedMinutes === "number" ? extra.estimatedMinutes : undefined,
      difficulty: typeof extra?.difficulty === "string" ? extra.difficulty : undefined,
    });
  });
}

/** Blob 里的包体是否可用：存在 + 摘要吻合 + 包内 id 与条目一致。 */
export async function blobPackUsable(entry: RawCatalogEntry): Promise<boolean> {
  const digest = typeof entry.digest === "string" ? entry.digest : "";
  if (!/^[0-9a-f]{64}$/.test(digest)) return false;
  try {
    const text = await readPublishedPack(entry.id, digest);
    if (text === null) return false;
    const parsed = JSON.parse(text) as { id?: unknown };
    return parsed?.id === entry.id;
  } catch {
    // 存储瞬时故障时不要把条目当作可下载：给玩家一个会失败的按钮更糟。
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 发布写入                                                            */
/* ------------------------------------------------------------------ */

export interface PublishWriteInput {
  gameId: string;
  digest: string;
  body: string;
  title: string;
  sceneCount: number;
  warningCount: number;
  /** 草稿目录条目（玩家不可见，供维护者核对）。 */
  draft: Record<string, unknown> & { id: string; digest: string };
  /**
   * 是否同时发布到玩家目录。
   *
   * 默认 false（只进草稿）。置为 true 需要服务端显式开启「直接发布」开关，
   * 语义见 `lib/cloud/publish-server.verifyPublisherAuth`。
   */
  publishNow: boolean;
}

export interface PublishWriteResult {
  created: boolean;
  /** 玩家目录里的状态。 */
  catalogStatus: "draft" | "published";
  pointer: PackPointer;
  repeated: boolean;
}

/**
 * 写入一次发布。
 *
 * 顺序刻意如此：
 *   1. 先写不可变的包体与元数据（按摘要寻址，失败也只是留下垃圾）；
 *   2. 再写草稿目录（给维护者看）；
 *   3. 只有 publishNow 时才改已发布索引（这一步才影响玩家）。
 *
 * 任何一步抛错，前面的写入都保持有效但不改变「玩家看得见什么」——因为索引
 * 是最后写的，也是唯一被目录读取的可变状态。
 */
export async function writePublishedGame(input: PublishWriteInput, now: Date = new Date()): Promise<PublishWriteResult> {
  const existingMeta = await readPackMeta(input.gameId, input.digest);
  const pointer: PackPointer = {
    digest: input.digest,
    pathname: pointerPathnameFor(input.gameId, input.digest),
    // receivedAt 在重复提交时保持不变，publishAt 只在真正发布/更新时刷新。
    receivedAt: existingMeta?.receivedAt ?? now.toISOString(),
    publishedAt: existingMeta?.publishedAt ?? now.toISOString(),
    sceneCount: input.sceneCount,
    title: input.title,
    warningCount: input.warningCount,
  };

  const { created } = await writePack(input.gameId, input.digest, input.body, pointer);

  const previous = (await readIndex()).games[input.gameId];
  const repeated = previous?.digest === input.digest;

  if (!input.publishNow) {
    return { created, catalogStatus: "draft", pointer, repeated };
  }

  const publishedPointer: PackPointer = {
    ...pointer,
    publishedAt: repeated ? previous.publishedAt : now.toISOString(),
  };
  await updateIndexEntry(input.gameId, () => publishedPointer);

  // 元数据里的 publishedAt 同步成真实发布时间，便于审计。
  if (publishedPointer.publishedAt !== pointer.publishedAt) {
    await writePack(input.gameId, input.digest, input.body, publishedPointer);
  }

  return { created, catalogStatus: "published", pointer: publishedPointer, repeated };
}

/**
 * 读取「当前已发布版本」的包体（按 id）。
 *
 * 下载链路用它兜底：玩家请求 `/content/<id>.json` 时，如果仓库里没有这个文件，
 * 就按索引找当前已发布的那一版。
 */
export async function readPublishedPackById(gameId: string): Promise<{ text: string; pointer: PackPointer } | null> {
  const index = await readIndex();
  const pointer = index.games[gameId];
  if (!pointer) return null;
  const text = await readPublishedPack(gameId, pointer.digest);
  if (text === null) return null;
  return { text, pointer };
}
