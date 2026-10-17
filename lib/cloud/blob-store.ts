/**
 * lib/cloud/blob-store - 发布通道的**持久化**存储后端。
 *
 * 事实前提（2026-10-17 起）：
 *   - Vercel 的函数文件系统是临时的、只读的（`/var/task`），写入不会保留到下一个
 *     请求，更不会跨部署保留。所以「正式发布的游戏包、发布元数据、目录」**不能**
 *     存在函数文件系统里。
 *   - 本模块把这三样东西放进 Vercel Blob（对象存储），发布 / 目录查询 / 下载三条
 *     链路都读同一个 store，不存在「写在一个地方、读另一个地方」。
 *
 * 命名空间（全部在同一个 store 里，互不覆盖）：
 *   games/<id>/<digest>.json      已批准的包体，按内容摘要寻址 → 天然幂等、不可变
 *   games/<id>/<digest>.meta.json 该版本元数据（谁、何时、多少站、提醒条数）
 *   indexes/games.json            每个 id 的当前已发布版本（指针文件，唯一可变）
 *   drafts/catalog.json           申请中（draft）的目录条目，玩家看不到
 *
 * 为什么不把「当前版本」直接写进包体：包体按摘要命名是**不可变**的，这是完整性
 * 校验的前提（令牌里钉住 digest，读回来必须逐字节吻合）。可变的是指针文件。
 *
 * 并发与失败安全：
 *   - 指针文件用 `ifMatch` 做条件写入。两个请求同时「首次发布」时，后到的那个
 *     会遇到 412（前置条件失败），重试一次读到对方的指针后再合并，不会互相覆盖。
 *   - 包体与元数据都是「先写内容、后写指针」。指针写失败时，多出来的是一份没人
 *     引用的包体（无害的垃圾），而不会出现「指针指向不存在的包」。
 *   - 任何一步失败都不删除既有数据，也不切断已发布游戏的可下载性。
 *
 * 没有配置 Blob 时（本机开发、未接入 store 的部署）：发布接口返回 503 失败关闭，
 * 不会退化成「写到临时盘然后假装成功」。
 *
 * 本文件只在 Node 运行时被 route handler 引用；密钥只从环境变量读取，永不外泄。
 */

import { activeBlobBackend, type BlobBackend } from "./blob-backend";

/** store 内的根目录。加前缀便于同一个 store 以后放别的应用数据。 */
export const BLOB_ROOT = "scene-hunt";
export const PACK_PREFIX = `${BLOB_ROOT}/games`;
export const INDEX_PATHNAME = `${BLOB_ROOT}/indexes/games.json`;
export const DRAFT_PATHNAME = `${BLOB_ROOT}/drafts/catalog.json`;

/**
 * 写入约定：私有访问 + 不走随机后缀（具体选项由 `blob-backend` 落到 SDK 参数）。
 *
 * - `access: "private"`：包体里有题目答案和现场坐标，不该是公开可猜的 URL。
 *   下载一律经我们自己的接口按凭据/公开目录转发，不把裸 Blob URL 暴露给玩家。
 * - `addRandomSuffix: false`：路径由我们自己决定（摘要 / 固定索引位置），前缀一变
 *   幂等性就没了。
 */
export interface PackPointer {
  /** 内容摘要（sha256 hex）。 */
  digest: string;
  /** 包体在 store 里的路径。 */
  pathname: string;
  /** 发布这一版的时间（ISO）。更新版本时变化，用于「玩家看到的是哪一版」。 */
  publishedAt: string;
  /** 第一次收到这个 digest 的时间（ISO），重复提交时保持不变。 */
  receivedAt: string;
  sceneCount: number;
  title: string;
  warningCount: number;
}

export interface StoreIndex {
  version: 1;
  /** id → 当前已发布版本。 */
  games: Record<string, PackPointer>;
  updatedAt: string;
}

/** 已发布索引的对外类型别名（route handler 与测试都用这个名字）。 */
export type IndexSnapshot = StoreIndex;

export interface DraftEntry {
  id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  estimatedMinutes?: number;
  difficulty?: "easy" | "medium" | "hard";
  sceneCount: number;
  status: "draft";
  packFile: string;
  digest: string;
  receivedAt: string;
}

export interface DraftCatalog {
  version: 1;
  updatedAt: string;
  games: DraftEntry[];
}

/* ------------------------------------------------------------------ */
/* 配置与错误                                                          */
/* ------------------------------------------------------------------ */

export type BlobConfig =
  | { configured: true; /** 进程内存后端（仅本机联调）；数据不持久化。 */ ephemeral?: boolean }
  | { configured: false; reason: string };

/**
 * Blob 是否可用。
 *
 * 只检查「凭证是否存在」，**不打印也不比对凭证内容**。两种受支持的形态：
 *   - `BLOB_READ_WRITE_TOKEN`：Vercel 控制台接入 Blob store 时自动注入；
 *   - `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`：新版 OIDC 方式。
 * 两者都没有时视为未接入，发布通道失败关闭。
 *
 * 唯一的例外是本机联调（`MOS_CLOUD_BLOB_MEMORY=1` 且不在 Vercel 上，见
 * `blob-backend.activeBlobBackend`），此时后端是进程内存，没有凭据也「可用」。
 * 这个分支在任何 Vercel 部署里都不可达（`VERCEL` 恒为 `1`）。
 */
export function readBlobConfig(env: Record<string, string | undefined> = process.env): BlobConfig {
  const token = (env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  const oidc = (env.VERCEL_OIDC_TOKEN ?? "").trim();
  const storeId = (env.BLOB_STORE_ID ?? "").trim();
  if (token) return { configured: true };
  if (oidc && storeId) return { configured: true };
  if (env.MOS_CLOUD_BLOB_MEMORY === "1" && env.VERCEL !== "1") {
    return { configured: true, ephemeral: true };
  }
  return {
    configured: false,
    reason: "服务端未接入 Blob 存储（缺少 BLOB_READ_WRITE_TOKEN 或 VERCEL_OIDC_TOKEN + BLOB_STORE_ID）。",
  };
}

/** 存储层错误：带上「是可重试的并发冲突，还是真故障」，由路由层决定状态码。 */
export class BlobStoreError extends Error {
  /**
   * - `not-found`：对象不存在
   * - `conflict`：并发条件写入失败，重试可能成功
   * - `corrupt`：**对象存在但内容不可解析**。这不是「没有数据」，而是「数据坏了」，
   *   绝不能当成空索引继续写——那样会用一个只含新游戏的指针覆盖掉整份索引。
   *   只能上报，必须人工处理。
   * - `unavailable`：凭据/网络/服务不可用
   * - `unknown`：其它
   */
  readonly kind: "not-found" | "conflict" | "corrupt" | "unavailable" | "unknown";
  constructor(kind: BlobStoreError["kind"], message: string, cause?: unknown) {
    super(message);
    this.name = "BlobStoreError";
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * 把后端异常归类。
 *
 * 归类而不是原样上抛的理由：route handler 需要对不同故障给出不同状态码
 * （404 不等于 500，并发冲突要重试而不是报错）。
 *
 * 注意这里**不用 `instanceof BlobBackendError`**：同一个类在打包/模块重置后可能
 * 存在多个副本（服务端与客户端各一份、测试里 resetModules 之后又一份），
 * `instanceof` 会突然变成 false，把一次「可重试的并发冲突」误判成未知故障。
 * 结构化判定（name + kind 字段）不受这种影响。
 */
function classify(error: unknown): BlobStoreError {
  if (error instanceof BlobStoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const name = (error as { name?: string } | null)?.name ?? "";
  const kind = (error as { kind?: unknown } | null)?.kind;

  if (
    name === "BlobBackendError" &&
    (kind === "not-found" ||
      kind === "conflict" ||
      kind === "corrupt" ||
      kind === "unavailable" ||
      kind === "unknown")
  ) {
    return new BlobStoreError(kind, message, error);
  }
  if (name === "BlobNotFoundError") {
    return new BlobStoreError("not-found", "存储里找不到该对象。", error);
  }
  if (name === "BlobPreconditionFailedError") {
    return new BlobStoreError("conflict", "对象已被其他写入修改（条件写入失败）。", error);
  }
  if (name === "BlobAccessError" || name === "BlobStoreNotFoundError" || name === "BlobStoreSuspendedError") {
    return new BlobStoreError("unavailable", "Blob 存储不可用或凭据无效：" + message, error);
  }
  return new BlobStoreError("unknown", "Blob 存储操作失败：" + message, error);
}

/* ------------------------------------------------------------------ */
/* 后端选择                                                            */
/* ------------------------------------------------------------------ */

let activeBackend: BlobBackend | null = null;

/**
 * 替换存储后端。
 *
 * 生产代码从不调用它（默认就是 `vercelBlobBackend()`）。测试用它注入内存实现，
 * 从而能真实覆盖条件写入、并发冲突、存储故障这些分支，而不会碰到真实 store。
 * 传 null 复位到默认实现。
 */
export function setBlobBackend(backend: BlobBackend | null): void {
  activeBackend = backend;
}

function backend(): BlobBackend {
  if (!activeBackend) activeBackend = activeBlobBackend();
  return activeBackend;
}

function packPathname(gameId: string, digest: string): string {
  return `${PACK_PREFIX}/${gameId}/${digest}.json`;
}

function metaPathname(gameId: string, digest: string): string {
  return `${PACK_PREFIX}/${gameId}/${digest}.meta.json`;
}

export function pointerPathnameFor(gameId: string, digest: string): string {
  return packPathname(gameId, digest);
}

/* ------------------------------------------------------------------ */
/* 底层读写                                                            */
/* ------------------------------------------------------------------ */

/** 读一个对象的文本内容；不存在返回 null（不抛）。 */
async function readText(pathname: string): Promise<string | null> {
  const found = await readTextWithEtag(pathname);
  return found ? found.text : null;
}

/**
 * 读一个对象，同时拿到它的 ETag（条件写入要用）。
 *
 * `ifMatch` 需要的是 ETag，所以读的时候一并取回，避免为了拿 ETag 再发一次请求。
 */
async function readTextWithEtag(pathname: string): Promise<{ text: string; etag: string } | null> {
  try {
    return await backend().read(pathname);
  } catch (error) {
    const classified = classify(error);
    if (classified.kind === "not-found") return null;
    throw classified;
  }
}

/**
 * 写一个对象的文本内容。
 *
 * 覆盖语义必须由调用方**显式**声明，没有默认值可依赖：
 *   - `mode: "create"`：原子创建。对象已存在时写入失败（后端归类为 conflict），
 *     调用方重读后再决定。这是「两个请求同时首次创建索引」唯一可信的机制——
 *     单纯「先读发现没有、再写」必然有窗口期。
 *   - `mode: "overwrite"`：允许覆盖（包体、元数据这类内容确定的对象）。
 *   - `mode: "if-match"`：条件覆盖，ETag 必须是 `etag`，否则失败。
 *
 * 为什么要分开：以前这里固定 `allowOverwrite: true`，于是「首次创建索引」实际
 * 变成了「无条件覆盖」——两个并发首次发布会互相把对方那条抹掉。
 */
type WriteMode = { mode: "create" } | { mode: "overwrite" } | { mode: "if-match"; etag: string };

async function writeText(pathname: string, text: string, writeMode: WriteMode): Promise<void> {
  try {
    const options: { contentType: string; allowOverwrite: boolean; ifMatch?: string } = {
      contentType: "application/json; charset=utf-8",
      allowOverwrite: writeMode.mode !== "create",
    };
    // 只在真的拿到 ETag 时才带上 ifMatch。`ifMatch: undefined` 在部分 SDK/序列化
    // 路径上会被当成「带了这个字段」，从而变成莫名其妙的 412。
    if (writeMode.mode === "if-match" && writeMode.etag) options.ifMatch = writeMode.etag;
    await backend().write(pathname, text, options);
  } catch (error) {
    throw classify(error);
  }
}

/* ------------------------------------------------------------------ */
/* 包体                                                                */
/* ------------------------------------------------------------------ */

export interface StoredPack {
  text: string;
  meta: PackPointer | null;
}

/** 读回已发布的包体。不存在返回 null。 */
export async function readPublishedPack(gameId: string, digest: string): Promise<string | null> {
  return readText(packPathname(gameId, digest));
}

/** 读某一版的元数据（审计用）。不存在返回 null。 */
export async function readPackMeta(gameId: string, digest: string): Promise<PackPointer | null> {
  const raw = await readText(metaPathname(gameId, digest));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { pointer?: PackPointer };
    return parsed.pointer ?? null;
  } catch {
    return null;
  }
}

/**
 * 写入包体与元数据。
 *
 * 两者都是不可变对象（按摘要命名），所以重复写同一摘要得到同一份内容，
 * 不会产生「第二份」也不会互相覆盖。
 */
export async function writePack(
  gameId: string,
  digest: string,
  body: string,
  pointer: PackPointer,
): Promise<{ created: boolean }> {
  const existing = await readPublishedPack(gameId, digest);
  if (existing === null) {
    // 原子创建：并发发布同一个游戏时，后到的那个会撞上「已存在」。按摘要寻址意味着
    // 同名对象内容必然相同，所以冲突等于「别人已经写好了同一份内容」，不是错误，
    // 只需要重新读一次确认它确实存在。
    try {
      await writeText(packPathname(gameId, digest), body, { mode: "create" });
    } catch (error) {
      const classified = error instanceof BlobStoreError ? error : classify(error);
      if (classified.kind !== "conflict") throw classified;
      const raced = await readPublishedPack(gameId, digest);
      if (raced === null) throw classified;
      return { created: false };
    }
  }
  // 元数据总是重写：即使包体已存在，也要保证「receivedAt」在多次重复提交后
  // 保持第一次的时间（pointer 由调用方传入已有的 receivedAt）。
  await writeText(metaPathname(gameId, digest), JSON.stringify({ version: 1, pointer }, null, 2), {
    mode: "overwrite",
  });
  return { created: existing === null };
}

/* ------------------------------------------------------------------ */
/* 已发布索引（唯一可变的指针文件）                                     */
/* ------------------------------------------------------------------ */

/** 索引不存在时的初始值。只有「对象确实不存在」时才可以用它。 */
function emptyIndex(): StoreIndex {
  return { version: 1, games: {}, updatedAt: "" };
}

/**
 * 解析索引文本。
 *
 * 关键区别（Issue #61 P1）：
 *   - **不存在** → 空索引，可以安全地创建；
 *   - **存在但解析不出来** → `corrupt`，**必须失败关闭**。
 *
 * 以前这里把「损坏」也当成空索引返回，后果是：下一次发布会读到空索引、
 * 合并进它自己这一条、然后覆盖写回 `indexes/games.json`——其它所有已发布游戏
 * 都从目录里消失（包体还在，但没有人指向它们）。这是静默的数据丢失，
 * 比直接报错严重得多。
 */
function parseIndexText(text: string): StoreIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new BlobStoreError(
      "corrupt",
      "已发布索引不是合法 JSON，为避免覆盖既有数据已停止写入。需要人工修复 scene-hunt/indexes/games.json。",
      error,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as StoreIndex).games !== "object" ||
    (parsed as StoreIndex).games === null ||
    Array.isArray((parsed as StoreIndex).games)
  ) {
    throw new BlobStoreError(
      "corrupt",
      "已发布索引结构不合法（缺少 games 对象），为避免覆盖既有数据已停止写入。需要人工修复 scene-hunt/indexes/games.json。",
    );
  }
  const index = parsed as StoreIndex;
  return {
    version: 1,
    games: index.games,
    updatedAt: typeof index.updatedAt === "string" ? index.updatedAt : "",
  };
}

/**
 * 读已发布索引。
 *
 * @throws BlobStoreError(`corrupt`) 索引存在但内容不可解析 —— 调用方必须失败关闭，
 *         不得退化成空索引继续写。
 */
export async function readIndex(): Promise<StoreIndex> {
  const found = await readTextWithEtag(INDEX_PATHNAME);
  if (!found) return emptyIndex();
  return parseIndexText(found.text);
}

export interface IndexWriteResult {
  index: StoreIndex;
  /** 是否发生过一次并发冲突后的重试。 */
  retried: boolean;
}

/**
 * 更新索引里的一个 id（乐观并发 + 条件写入）。
 *
 * `mutate` 是纯函数：拿到当前索引，返回「新的这一条指针」或 null（表示不更新）。
 *
 * 两种写入路径，分别对应「索引已存在」和「索引还不存在」：
 *   - **已存在**：读 → 改 → 带 ETag 条件覆盖。别人先改了就会 412，重读重试。
 *   - **不存在**：原子创建（不允许覆盖）。两个请求同时首次发布时，只有一个能
 *     创建成功，另一个拿到 conflict，重读后走上面的条件覆盖路径，把它那条也
 *     合并进去。因为「对象已存在」和「写入成功」在存储侧是一个原子判定，
 *     所以不存在「都以为自己创建成功、最后互相覆盖」的窗口期。
 *
 * 索引一旦损坏（解析失败）立刻抛 `corrupt`，绝不会用空索引覆盖它。
 */
export async function updateIndexEntry(
  gameId: string,
  mutate: (current: PackPointer | undefined) => PackPointer | null,
  maxAttempts = 3,
): Promise<IndexWriteResult> {
  let retried = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const found = await readTextWithEtag(INDEX_PATHNAME);
    // 损坏 → 抛 corrupt（parseIndexText 内），不会走到写入分支。
    const current: StoreIndex = found ? parseIndexText(found.text) : emptyIndex();

    const next = mutate(current.games[gameId]);
    if (next === null) return { index: current, retried };

    const merged: StoreIndex = {
      version: 1,
      games: { ...current.games, [gameId]: next },
      updatedAt: new Date().toISOString(),
    };

    try {
      if (found) {
        await writeText(INDEX_PATHNAME, JSON.stringify(merged, null, 2), { mode: "if-match", etag: found.etag });
      } else {
        // 原子创建：如果这期间别人先建好了索引，这里会 conflict，重读后重试。
        await writeText(INDEX_PATHNAME, JSON.stringify(merged, null, 2), { mode: "create" });
      }
      return { index: merged, retried };
    } catch (error) {
      const classified = error instanceof BlobStoreError ? error : classify(error);
      // corrupt 永远不会重试：重试也只是重复读一份坏数据。
      if (classified.kind === "conflict" && attempt < maxAttempts - 1) {
        retried = true;
        continue;
      }
      throw classified;
    }
  }
  throw new BlobStoreError("conflict", "索引文件在多次重试后仍被并发修改，请稍后重试。");
}

/* ------------------------------------------------------------------ */
/* 草稿目录                                                            */
/* ------------------------------------------------------------------ */

export async function readDrafts(): Promise<DraftCatalog> {
  const raw = await readText(DRAFT_PATHNAME);
  if (!raw) return { version: 1, updatedAt: "", games: [] };
  try {
    const parsed = JSON.parse(raw) as DraftCatalog;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      games: Array.isArray(parsed.games) ? parsed.games : [],
    };
  } catch {
    return { version: 1, updatedAt: "", games: [] };
  }
}

/** 写入一条草稿条目（同 id 覆盖）。草稿永远不进玩家目录。 */
export async function upsertDraft(entry: DraftEntry): Promise<{ entries: DraftEntry[]; updated: boolean }> {
  let updated = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await readTextWithEtag(DRAFT_PATHNAME);
    // 草稿目录损坏不阻断发布主流程（它只影响「申请中」列表，不影响已发布目录），
    // 因此这里仍然按空目录处理；这与已发布索引的失败关闭是刻意区分的。
    const current: DraftCatalog = found
      ? (() => {
          try {
            const parsed = JSON.parse(found.text) as DraftCatalog;
            return { version: 1 as const, updatedAt: parsed.updatedAt ?? "", games: Array.isArray(parsed.games) ? parsed.games : [] };
          } catch {
            return { version: 1 as const, updatedAt: "", games: [] as DraftEntry[] };
          }
        })()
      : { version: 1 as const, updatedAt: "", games: [] as DraftEntry[] };

    const index = current.games.findIndex((item) => item.id === entry.id);
    updated = index >= 0;
    const games = index >= 0 ? current.games.map((item, i) => (i === index ? entry : item)) : [...current.games, entry];
    const merged: DraftCatalog = { version: 1, updatedAt: new Date().toISOString(), games };
    try {
      const writeMode: WriteMode = found ? { mode: "if-match", etag: found.etag } : { mode: "create" };
      await writeText(DRAFT_PATHNAME, JSON.stringify(merged, null, 2), writeMode);
      return { entries: games, updated };
    } catch (error) {
      const classified = error instanceof BlobStoreError ? error : classify(error);
      if (classified.kind === "conflict" && attempt < 2) continue;
      throw classified;
    }
  }
  throw new BlobStoreError("conflict", "草稿目录在多次重试后仍被并发修改。");
}

/* ------------------------------------------------------------------ */
/* 维护者工具                                                          */
/* ------------------------------------------------------------------ */

/** 列出 store 里的全部包体（维护者 CLI 核对用）。 */
export async function listPackBlobs(): Promise<Array<{ pathname: string; size: number; uploadedAt: string }>> {
  try {
    const blobs = await backend().list(`${PACK_PREFIX}/`);
    return blobs.map((blob) => ({
      pathname: blob.pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
    }));
  } catch (error) {
    throw classify(error);
  }
}
