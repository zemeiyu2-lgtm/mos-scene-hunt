/**
 * Server-side access gate for internal diagnostics pages (`/dev/map-bench`).
 *
 * The bench is a pure client fixture — it calls no app API and holds no user
 * data — but it is still an internal tool: it exposes engine configuration,
 * build diagnostics, and lets any visitor drive map traffic. Production must
 * therefore serve it as a 404 at the server boundary, not merely hide a link.
 *
 * Rules:
 * - `MOS_DEV_BENCH=1`  → explicitly enabled (local prod-mode E2E runs, or an
 *   authorized environment that opts in via server env).
 * - `NODE_ENV=development` → `next dev` always works, zero configuration.
 * - Anything else (a Vercel Production build has neither) → disabled.
 *
 * This is evaluated at request time on the server (`dynamic = "force-dynamic"`
 * on the page), so a production build cannot be coaxed into rendering the
 * bench by client-side tampering.
 */
export function isDevBenchEnabled(env: {
  NODE_ENV?: string | undefined;
  MOS_DEV_BENCH?: string | undefined;
}): boolean {
  if (env.MOS_DEV_BENCH === "1") return true;
  return env.NODE_ENV === "development";
}
