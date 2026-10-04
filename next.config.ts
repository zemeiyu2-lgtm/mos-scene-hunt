import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Leaflet ships an ESM/CJS hybrid; transpiling keeps the bundle predictable.
  transpilePackages: ["leaflet"],
  eslint: { ignoreDuringBuilds: true },
  // The app does not use next/image; disabling image optimization keeps the
  // optional sharp binary (Apache-2.0 AND LGPL-3.0-or-later) out of the
  // production dependency tree entirely.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // The service worker and manifest must never be served from a stale cache.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        // Game content packs are the offline fallback source of truth.
        source: "/content/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
    ];
  },
};

export default nextConfig;
