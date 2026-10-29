/**
 * Blob namespace guard: refuse to run in Preview against a shared default
 * prefix.
 *
 * Why this exists. Production and Preview deployments of this project use the
 * SAME Blob store (same `BLOB_READ_WRITE_TOKEN`) and the same default prefixes
 * (`registry`, `published-games`). A Preview deployment that enables Blob
 * storage without an explicit prefix therefore reads and writes production
 * data: a Preview publish can add a version object and rewrite the production
 * `meta.json` latest pointer, and a Preview admin can edit production users.
 *
 * Prefix separation is the only isolation this architecture can offer, so it
 * must be explicit rather than defaulted. Missing configuration must fail
 * loudly at the point of use instead of silently landing in the production
 * namespace — "the page 404s" is not evidence of isolation, it is evidence
 * that nobody looked.
 *
 * Production itself is unaffected: `VERCEL_ENV === "production"` passes, and a
 * non-Vercel host (local dev, tests, self-hosted) never sets `VERCEL_ENV` at
 * all, so the guard is inert there.
 */

/** Prefixes the production deployment uses when nothing is configured. */
const PRODUCTION_PREFIXES = {
  registry: "registry",
  "published-games": "published-games",
} as const;

export interface NamespaceGuardInput {
  /** Human readable name of the store, used in the error message. */
  store: "registry" | "published-games";
  /** Raw value of the dedicated prefix environment variable, if any. */
  prefix: string | undefined;
}

/**
 * Throws when a Preview deployment would use the production namespace.
 * Returns the trimmed prefix (or the production default in Production).
 */
export function resolveBlobPrefix(input: NamespaceGuardInput): string {
  const fallback = PRODUCTION_PREFIXES[input.store];
  const prefix = input.prefix?.trim();

  if (process.env.VERCEL_ENV !== "preview") {
    return prefix || fallback;
  }

  const envVar =
    input.store === "registry" ? "REGISTRY_BLOB_PREFIX" : "PUBLISHED_GAMES_BLOB_PREFIX";

  if (!prefix) {
    throw new Error(
      `[storage:${input.store}] Preview 环境启用了 Blob 存储但未设置 ${envVar}。` +
        `Preview 与 Production 共用同一个 Blob 存储与默认前缀 "${fallback}"，` +
        `继续运行会读写生产数据。请为 Preview 设置独立的 ${envVar}（例如 ${fallback}-preview）后重新部署。`,
    );
  }
  if (prefix === fallback) {
    throw new Error(
      `[storage:${input.store}] Preview 环境的 ${envVar} 等于生产默认前缀 "${fallback}"，` +
        `不是隔离命名空间。请改用独立前缀（例如 ${fallback}-preview）。`,
    );
  }
  return prefix;
}
