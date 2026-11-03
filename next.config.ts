import type { NextConfig } from "next";

/**
 * Build-time kill switch for the DEV GPS simulator (B-01 P1).
 *
 * Why this exists
 * ---------------
 * The runtime guard in `lib/location/simulator.ts` reads `process.env.VERCEL_ENV`
 * to hard-disable the simulator on a Vercel production deployment. That guard
 * cannot work in the browser: only `NEXT_PUBLIC_*` variables (and the keys of
 * the `env` block below) are inlined into the client bundle, so `VERCEL_ENV`
 * survives only as a runtime `process.env` lookup, which is `undefined` in the
 * browser. The result was empirically confirmed on 2026-11-03: a build with
 * VERCEL_ENV=production still shipped the simulator entry point.
 *
 * The fix moves the decision to where the information actually exists - the
 * build process, which runs on Node and does see VERCEL_ENV. When this is a
 * production deployment we publish `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR="0"` in
 * `env`, which Next inlines into every client bundle. A variable configured on
 * the Vercel Production environment is therefore overridden at compile time,
 * not at runtime.
 *
 * Safety rules baked in here:
 *  - Only this one public, non-secret key is written to `env`. Nothing else is
 *    copied from the environment, so no server secret can leak into the client
 *    bundle through this block.
 *  - Fail safe: on Vercel, anything that is not an explicitly recognised
 *    non-production environment (`preview` / `development`) is treated as
 *    production, so a missing or unexpected VERCEL_ENV disables the simulator
 *    instead of exposing it.
 *  - Non-production builds (local dev, local `next build`, preview) get no
 *    override at all and keep the previous behaviour exactly.
 */
function simulatorEnvOverride(): Record<string, string> {
  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim().toLowerCase();
  const onVercel = process.env.VERCEL === "1";
  const isProductionDeployment =
    vercelEnv === "production" ||
    // Fail safe: deployed on Vercel but the environment marker is missing or
    // unrecognised -> assume production and keep the simulator off.
    (onVercel && vercelEnv !== "preview" && vercelEnv !== "development");

  return isProductionDeployment ? { NEXT_PUBLIC_ENABLE_GPS_SIMULATOR: "0" } : {};
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Leaflet ships an ESM/CJS hybrid; transpiling keeps the bundle predictable.
  transpilePackages: ["leaflet"],
  // The app does not use next/image; disabling image optimization keeps the
  // optional sharp binary (Apache-2.0 AND LGPL-3.0-or-later) out of the
  // production dependency tree entirely.
  images: { unoptimized: true },
  // Build-time production gate for the DEV GPS simulator. Empty outside a
  // production deployment, so preview/local configuration is untouched.
  env: simulatorEnvOverride(),
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
