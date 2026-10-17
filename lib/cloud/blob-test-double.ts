/**
 * lib/cloud/blob-test-double - 只在测试里使用的 Blob 存储替身。
 *
 * 为什么需要它：正式发布数据现在存在 Vercel Blob（远端对象存储）。单元测试
 * 既要覆盖「写入后能读出来、并发写不互相覆盖、存储故障要报错」这些真实性质，
 * 又不能在 CI 里真的往远端 store 写数据（会污染生产数据，也需要凭据）。
 *
 * 做法：实现 `BlobBackend` 接口（见 ./blob-backend），由测试通过
 * `setBlobBackend()` 注入。被测代码走的仍是真实的 `lib/cloud/blob-store` 分支
 * 逻辑——条件写入、404 语义、故障归类都在真实路径上，只是把网络那一层换成本地
 * 内存实现，行为对齐真实 API 的关键语义：
 *   - `ifMatch` 不匹配抛 conflict（并发保护靠它）；
 *   - 读不存在的对象返回 null；
 *   - 故障注入（putFailure / readFailure）用来验证「存储故障不破坏既有数据」。
 *
 * 这**不等于**验证过真实 Blob 连通性。真实 store 的连通性由部署后的手工验收
 * 覆盖，报告里必须与单测分开写。
 */

import { BlobBackendError, type BlobBackend, type PutOptions, type ReadResult } from "./blob-backend";

export interface FakeBlob {
  pathname: string;
  body: string;
  etag: string;
  uploadedAt: Date;
  contentType: string;
}

/** 内存版 Blob store。每个测试用例 new 一个，互不影响。 */
export class FakeBlobStore implements BlobBackend {
  readonly blobs = new Map<string, FakeBlob>();
  private etagCounter = 0;

  /** 故障注入：返回 Error 时该次写入失败。 */
  putFailure: (() => Error | null) | null = null;
  /** 故障注入：返回 Error 时该次读取失败。 */
  readFailure: (() => Error | null) | null = null;
  /** 记录写入过的路径，验证「重复发布不重复写包体」。 */
  readonly puts: string[] = [];
  /** 记录每次写入的选项，验证条件写入是否真的带上了 ifMatch。 */
  readonly putOptions: Array<{ pathname: string; options: PutOptions; hadIfMatch: boolean }> = [];

  private nextEtag(): string {
    this.etagCounter += 1;
    return `"etag-${this.etagCounter}"`;
  }

  async read(pathname: string): Promise<ReadResult | null> {
    const failure = this.readFailure?.() ?? null;
    if (failure) throw asBackendError(failure);
    const record = this.blobs.get(pathname);
    if (!record) return null;
    return { text: record.body, etag: record.etag };
  }

  async write(pathname: string, text: string, options: PutOptions = {}): Promise<void> {
    const failure = this.putFailure?.() ?? null;
    if (failure) throw asBackendError(failure);

    const existing = this.blobs.get(pathname);
    this.putOptions.push({ pathname, options, hadIfMatch: options.ifMatch !== undefined });

    if (existing) {
      // ifMatch 优先：并发写入保护。
      if (options.ifMatch !== undefined && options.ifMatch !== existing.etag) {
        throw new BlobBackendError("conflict", "对象已被其他写入修改（条件写入失败）。");
      }
      if (options.allowOverwrite === false) {
        throw new BlobBackendError("unknown", `blob already exists: ${pathname}`);
      }
    } else if (options.ifMatch !== undefined) {
      // 对不存在的对象做条件写入：真实 API 也是前置条件失败。
      throw new BlobBackendError("conflict", "对象不存在，条件写入失败。");
    }

    this.blobs.set(pathname, {
      pathname,
      body: text,
      etag: this.nextEtag(),
      uploadedAt: new Date(),
      contentType: options.contentType ?? "application/json; charset=utf-8",
    });
    this.puts.push(pathname);
  }

  async list(prefix: string): Promise<Array<{ pathname: string; size: number; uploadedAt: Date }>> {
    return [...this.blobs.values()]
      .filter((blob) => blob.pathname.startsWith(prefix))
      .map((blob) => ({
        pathname: blob.pathname,
        size: new TextEncoder().encode(blob.body).byteLength,
        uploadedAt: blob.uploadedAt,
      }));
  }

  /** 便捷读取（测试断言用）。 */
  text(pathname: string): string | null {
    return this.blobs.get(pathname)?.body ?? null;
  }

  /** 清空（模拟「store 还没接过任何发布」）。 */
  clear(): void {
    this.blobs.clear();
    this.puts.length = 0;
    this.putOptions.length = 0;
  }
}

/**
 * 故障注入用的普通 Error 也能被归类：`BlobBackendError` 原样透传，其它按
 * 「未知故障」处理——这样测试断言的是「路由层如何对待一次失败的写入」，
 * 而不是必须构造某个特定错误类。
 */
function asBackendError(error: Error): BlobBackendError {
  if (error instanceof BlobBackendError) return error;
  const message = error.message || "injected failure";
  const kind =
    error.name === "BlobPreconditionFailedError"
      ? "conflict"
      : error.name === "BlobAccessError" || error.name === "BlobStoreSuspendedError"
        ? "unavailable"
        : "unknown";
  return new BlobBackendError(kind, message, error);
}
