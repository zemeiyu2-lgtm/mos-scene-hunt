/**
 * Local CORS Range proxy for PMTiles — TEST HARNESS ONLY.
 *
 * Why this exists: `latest.protomaps.com` serves the public planet build
 * without `Access-Control-Allow-Origin`, so a browser cannot read it directly
 * (verified 2026-11-03: fetch blocked by CORS). Protomaps' own guidance is to
 * copy the archive to your own bucket, and buckets (R2/S3) answer CORS. This
 * proxy stands in for "your own bucket" during the bench so the full
 * MapLibre + pmtiles pipeline can be validated against the *real* global
 * archive — bytes still come from upstream on demand via Range requests;
 * nothing is downloaded wholesale.
 *
 * Production must never point at this proxy: it serialises traffic through one
 * Node process and doubles the latency. Point NEXT_PUBLIC_PMTILES_URL at
 * object storage instead.
 *
 * Usage: node tools/pmtiles-cors-proxy.mjs [port=3210]
 */

import http from "node:http";

const UPSTREAM = "https://latest.protomaps.com/v4.pmtiles";
const PORT = Number(process.argv[2] ?? 3210);

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? "*";
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "range, origin, content-type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const headers = { Range: req.headers.range ?? "bytes=0-" };
  let headersSent = false;
  try {
    const upstream = await fetch(UPSTREAM, { headers });
    const responseHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Expose-Headers": "content-range, content-length, etag",
      "Content-Type": "application/octet-stream",
      ETag: upstream.headers.get("etag") ?? '"proxy"',
    };
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) responseHeaders["Content-Length"] = contentLength;
    headersSent = true;
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      return;
    }
    // Node's undici ReadableStream is async-iterable; the manual
    // getReader()/next() dance is not (reader.next is undefined on Node 22).
    for await (const chunk of upstream.body) {
      if (!res.write(Buffer.from(chunk))) {
        // Backpressure: the browser is slower than upstream.
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (error) {
    console.error(`proxy: ${String(error).slice(0, 160)}`);
    // Mid-stream failures can only be aborted, not re-headed.
    if (!headersSent) {
      res.writeHead(502, {
        "Access-Control-Allow-Origin": origin,
        "Content-Type": "text/plain",
      });
      res.end(`proxy error: ${String(error)}`);
    } else {
      res.destroy();
    }
  }
});

// A cancelled tile fetch must not take the proxy down.
server.on("clientError", (_error, socket) => socket.destroy());

server.listen(PORT, () => {
  console.log(`pmtiles cors proxy on http://localhost:${PORT}${new URL(UPSTREAM).pathname}`);
});
