/**
 * `/dev/map-bench` — server-side access boundary.
 *
 * The bench is an internal diagnostics tool. In production it must 404 at the
 * server, not merely be unlinked: this component runs on the server for every
 * request (`force-dynamic`), and `notFound()` short-circuits before the client
 * bundle is ever served. See `lib/map/dev-gate.ts` for the rules:
 *
 * - Vercel Production (no `MOS_DEV_BENCH`, `NODE_ENV=production`) → 404.
 * - Local `next dev` → always available.
 * - Local prod-mode E2E / authorized environments → set `MOS_DEV_BENCH=1`.
 */
import { notFound } from "next/navigation";
import { isDevBenchEnabled } from "@/lib/map/dev-gate";
import { MapBenchClient } from "./map-bench-client";

export const dynamic = "force-dynamic";

export default function MapBenchPage() {
  if (!isDevBenchEnabled(process.env)) notFound();
  return <MapBenchClient />;
}
