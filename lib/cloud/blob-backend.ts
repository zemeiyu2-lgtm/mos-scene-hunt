/**
 * lib/cloud/blob-backend - 存储后端的**接口**与 Vercel Blob 实现。
 *
 * 把「怎么存」抽成接口的理由不只是为了测试：
 *   - 单测要能验证条件写入、404、故障归类这些**真实分支**，而不能真的往生产
 *     store 写数据；
 *   - `@vercel/blob` 是一个 CJS 包，直接在模块里 import 会让测试里的模块替换
 *     变成一件靠运气的事。经接口注入之后，被测代码只依赖 4 个方法。
 *
 * 生产环境唯一的实现是 `vercelBlobBackend()`，凭据只从环境变量读取（见
 * `lib/cloud/blob-store.readBlobConfig`）。
 */

export class BlobBackendError extends Error {
  readonly kind: "not-found" | "conflict" | "unavailable" | "unknown";
  constructor(kind: BlobBackendError["kind"], message: string, cause?: unknown) {
    super(message);
    this.name = "BlobBackendError";
    this.kind = kind;
    this.cause = cause;
  }
}

export interface PutOptions {
  /** 允许覆盖同名对象。 */
  allowOverwrite?: boolean;
  /** 条件写入：当前 ETag 必须等于它，否则抛 conflict。 */
  ifMatch?: string;
  contentType?: string;
}

export interface ReadResult {
  text: string;
  /** 当前 ETag，条件写入需要。 */
  etag: string;
}

export interface BlobBackend {
  /** 读文本；不存在返回 null。 */
  read(pathname: string): Promise<ReadResult | null>;
  /** 写文本（永远私有访问）。 */
  write(pathname: string, text: string, options?: PutOptions): Promise<void>;
  /** 列举某个前缀下的对象。 */
  list(prefix: string): Promise<Array<{ pathname: string; size: number; uploadedAt: Date }>>;
}

/**
 * 选择实际使用的后端。
 *
 * 默认、以及**任何部署到 Vercel 的环境**，永远返回 `vercelBlobBackend()`。
 *
 * 唯一的例外是本机联调：`MOS_CLOUD_BLOB_MEMORY=1`（并且部署平台标记
 * `VERCEL !== "1"`）。为什么不用 `NODE_ENV !== "production"` 来判断：
 * `next start` 跑的就是生产构建，NODE_ENV 恒为 production，那样写会让本机联调
 * 反而永远走不到内存后端。真正的护栏是 `VERCEL !== "1"`——凡是跑在 Vercel 上的
 * 部署，这个变量恒为 `1`，内存后端的代码路径不可达。
 *
 * 内存实现的数据随进程消失、单进程有效，不具备任何持久化保证，因此它产出的结果
 * 只能用于验证接口契约，不能当作云端持久化验收。
 */
export function activeBlobBackend(): BlobBackend {
  if (process.env.MOS_CLOUD_BLOB_MEMORY === "1" && process.env.VERCEL !== "1") {
    return memoryBackend();
  }
  return vercelBlobBackend();
}

let memoryInstance: BlobBackend | null = null;

/** 进程内存后端（仅本机联调）。语义对齐真实 Blob 的关键分支。 */
function memoryBackend(): BlobBackend {
  if (memoryInstance) return memoryInstance;

  const blobs = new Map<string, { body: string; etag: string; uploadedAt: Date }>();
  let seq = 0;
  const nextEtag = () => {
    seq += 1;
    return `"mem-${seq}"`;
  };

  memoryInstance = {
    async read(pathname) {
      const record = blobs.get(pathname);
      if (!record) return null;
      return { text: record.body, etag: record.etag };
    },
    async write(pathname, text, options = {}) {
      const existing = blobs.get(pathname);
      if (options.ifMatch !== undefined && (!existing || existing.etag !== options.ifMatch)) {
        throw new BlobBackendError("conflict", "对象已被其他写入修改（条件写入失败）。");
      }
      if (existing && options.allowOverwrite === false) {
        throw new BlobBackendError("unknown", `blob already exists: ${pathname}`);
      }
      blobs.set(pathname, { body: text, etag: nextEtag(), uploadedAt: new Date() });
    },
    async list(prefix) {
      return [...blobs.entries()]
        .filter(([pathname]) => pathname.startsWith(prefix))
        .map(([pathname, record]) => ({
          pathname,
          size: new TextEncoder().encode(record.body).byteLength,
          uploadedAt: record.uploadedAt,
        }));
    },
  };
  return memoryInstance;
}

/**
 * Vercel Blob 实现。
 *
 * 延迟 `import()`：只有真正执行读写时才加载 SDK。这样：
 *   - 客户端 bundle 绝不会把它带进来（本模块只在 route handler 里用）；
 *   - 测试可以完全绕开真实 SDK。
 */
export function vercelBlobBackend(): BlobBackend {
  return {
    async read(pathname) {
      const { get } = await import("@vercel/blob");
      try {
        const result = await get(pathname, { access: "private", useCache: false });
        if (!result || !result.stream) return null;
        const text = await new Response(result.stream).text();
        return { text, etag: result.blob.etag ?? "" };
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async write(pathname, text, options = {}) {
      const { put } = await import("@vercel/blob");
      try {
        await put(pathname, text, {
          // 私有访问：包体里有题目答案与现场坐标，不应是公开可猜的 URL。
          access: "private",
          // 路径由业务决定（摘要/固定索引位），随机后缀会破坏幂等。
          addRandomSuffix: false,
          contentType: options.contentType ?? "application/json; charset=utf-8",
          allowOverwrite: options.allowOverwrite ?? true,
          ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
        });
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async list(prefix) {
      const { list } = await import("@vercel/blob");
      const out: Array<{ pathname: string; size: number; uploadedAt: Date }> = [];
      let cursor: string | undefined;
      try {
        for (;;) {
          const page = await list({ prefix, cursor, limit: 1000 });
          for (const blob of page.blobs) {
            out.push({ pathname: blob.pathname, size: blob.size, uploadedAt: blob.uploadedAt });
          }
          if (!page.hasMore) break;
          cursor = page.cursor;
        }
      } catch (error) {
        throw toBackendError(error);
      }
      return out;
    },
  };
}

/** 把 SDK 异常归类成后端错误（route handler 据此给不同状态码）。 */
function toBackendError(error: unknown): BlobBackendError {
  if (error instanceof BlobBackendError) return error;
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "BlobNotFoundError") {
    return new BlobBackendError("not-found", "存储里找不到该对象。", error);
  }
  if (name === "BlobPreconditionFailedError") {
    return new BlobBackendError("conflict", "对象已被其他写入修改（条件写入失败）。", error);
  }
  if (
    name === "BlobAccessError" ||
    name === "BlobStoreNotFoundError" ||
    name === "BlobStoreSuspendedError" ||
    /No blob credentials found/i.test(message)
  ) {
    return new BlobBackendError("unavailable", "Blob 存储不可用或凭据无效：" + message, error);
  }
  return new BlobBackendError("unknown", "Blob 存储操作失败：" + message, error);
}
