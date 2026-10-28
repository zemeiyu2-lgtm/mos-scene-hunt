/**
 * Shared in-memory fake of `@vercel/blob` for registry tests.
 *
 * Implements the SDK contract the adapters rely on:
 *   - `put` refuses to overwrite unless `allowOverwrite` is set,
 *   - `get` throws `BlobNotFoundError` for missing keys,
 *   - `list` pages via `cursor`/`hasMore` with every page capped at 2 entries,
 *     so explicit-pagination code paths are always exercised.
 *
 * SYNTHETIC ONLY: passing against this fake says nothing about a real Blob
 * container; that is a separate, credential-gated step.
 */

const PAGE_CAP = 2;

export interface FakeBlobState {
  blobs: Map<string, string>;
  reset: () => void;
  keys: () => string[];
}

export function createFakeBlobState(): FakeBlobState {
  const blobs = new Map<string, string>();
  return {
    blobs,
    reset: () => blobs.clear(),
    keys: () => [...blobs.keys()].sort(),
  };
}

export function fakeBlobModule(state: FakeBlobState) {
  class FakeBlobNotFoundError extends Error {
    name = "BlobNotFoundError";
  }
  return {
    BlobNotFoundError: FakeBlobNotFoundError,
    async put(
      pathname: string,
      body: string,
      options?: { allowOverwrite?: boolean },
    ): Promise<unknown> {
      if (state.blobs.has(pathname) && !options?.allowOverwrite) {
        throw new Error(
          `The blob "${pathname}" already exists and overwrite is not allowed.`,
        );
      }
      state.blobs.set(pathname, body);
      return { pathname };
    },
    async get(
      pathname: string,
      _options?: { access?: string; useCache?: boolean },
    ): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> } | null> {
      const body = state.blobs.get(pathname);
      if (body === undefined) throw new FakeBlobNotFoundError(`Blob "${pathname}" not found`);
      const bytes = new TextEncoder().encode(body);
      return {
        statusCode: 200,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      };
    },
    async list(options: {
      prefix?: string;
      cursor?: string;
      limit?: number;
    }): Promise<{ blobs: { pathname: string }[]; hasMore: boolean; cursor?: string }> {
      const prefix = options.prefix ?? "";
      const all = state.keys().filter((k) => k.startsWith(prefix));
      const start = options.cursor ? Number(options.cursor) : 0;
      const size = Math.min(options.limit ?? PAGE_CAP, PAGE_CAP);
      const page = all.slice(start, start + size);
      const next = start + page.length;
      return {
        blobs: page.map((pathname) => ({ pathname })),
        hasMore: next < all.length,
        cursor: next < all.length ? String(next) : undefined,
      };
    },
    head: async () => null,
    del: async () => undefined,
  };
}
