import { setBlobBackend } from "../../lib/cloud/blob-store";
import { FakeBlobStore } from "../../lib/cloud/blob-test-double";

/**
 * 云端路由测试的共享支撑。
 *
 * 关键约束：发布数据现在存在 Vercel Blob（远端对象存储）。测试**不能**真的往
 * 远端写（会污染生产数据，也需要凭据），所以这里把 `BlobBackend` 换成内存实现
 * （见 lib/cloud/blob-test-double），通过 `setBlobBackend()` 注入。
 *
 * 被测代码走的仍是真实的 blob-store 分支逻辑：条件写入、404 语义、故障归类都在
 * 真实路径上，只有网络那一层是本地实现。
 *
 * 这**不等于**验证过真实 Blob 连通性——真实 store 由部署后的手工验收覆盖，
 * 报告里必须分开写。
 *
 * 为什么不用 `vi.mock("@vercel/blob")`：`@vercel/blob` 是 CJS 包
 * （`main: ./dist/index.cjs`），vitest 的模块替换对它不生效。走后端注入更可靠，
 * 也让被测代码只依赖 3 个方法。
 */

export const PUBLISH_KEY = "test-publish-key-0000000001";
export const SECRET = "t".repeat(48);

let current: FakeBlobStore = new FakeBlobStore();

/** 换一个新 store 并注入（每个用例开始时调用）。 */
export function useFakeBlob(): FakeBlobStore {
  current = new FakeBlobStore();
  setBlobBackend(current);
  return current;
}

export function currentFakeBlob(): FakeBlobStore {
  return current;
}

/** 恢复默认后端（避免污染同进程里后续的非云端测试）。 */
export function releaseFakeBlob(): void {
  setBlobBackend(null);
}

/** 发布接口需要的环境变量（不涉及任何真实凭据）。 */
export function publishEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MOS_CLOUD_PUBLISH_KEY: PUBLISH_KEY,
    MOS_CLOUD_PUBLISH_SECRET: SECRET,
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_fake_store_for_tests",
    ...extra,
  };
}
