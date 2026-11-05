import { NextResponse } from "next/server";
import { CLOUD_CATALOG } from "@/lib/cloud/catalog";

/**
 * Public cloud catalogue.
 *
 * The data itself lives in `lib/cloud/catalog.ts` so the exploration read model
 * and this endpoint can never disagree about what is published. Response shape,
 * field order and cache policy are unchanged from the previous inline literal.
 */
export function GET() {
  return NextResponse.json(CLOUD_CATALOG, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
