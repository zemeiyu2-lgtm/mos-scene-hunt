/**
 * Live verification of the PMTiles transport assumption.
 *
 * Protomaps' whole pitch is "no tile server": the archive is one static file
 * read over HTTP Range requests. If a host does not answer `206` with the right
 * bytes, the map silently renders nothing. This test hits the public build and
 * asserts the contract. It is network-dependent, so it *skips* rather than
 * fails when the host is unreachable — a red CI run must mean a real
 * regression, not an offline runner.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_PMTILES_URL } from "@/lib/map/maplibre-style";

const PMTILES_MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73]; // "PMTiles"
const HEADER_BYTES = 16_384;

async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(DEFAULT_PMTILES_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe("PMTiles over HTTP Range (public build)", () => {
  it("answers a range request with 206 and the PMTiles magic bytes", async () => {
    if (!(await reachable())) {
      console.warn(`skip: ${DEFAULT_PMTILES_URL} unreachable from this runner`);
      return;
    }
    const head = await fetch(DEFAULT_PMTILES_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(20_000),
    });
    const contentLength = Number(head.headers.get("content-length") ?? "0");
    // The planet archive is ~120 GB; anything smaller means the URL changed.
    expect(contentLength).toBeGreaterThan(100_000_000_000);
    expect(head.headers.get("accept-ranges")).toContain("bytes");

    const response = await fetch(DEFAULT_PMTILES_URL, {
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
      signal: AbortSignal.timeout(30_000),
    });
    expect(response.status).toBe(206);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(HEADER_BYTES);
    expect(Array.from(bytes.slice(0, 7))).toEqual(PMTILES_MAGIC);
  });
});
