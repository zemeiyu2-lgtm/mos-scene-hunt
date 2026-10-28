import {
  HttpError,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/guard";
import { runLegacyImport } from "@/lib/registry/legacy-import";
import { recordAudit } from "@/lib/registry/service";
import { getRegistry } from "@/lib/registry/store";

/**
 * Legacy import endpoint (admin only).
 *
 * POST /api/admin/import-legacy { apply?: boolean, limit?: number }
 *
 * Dry run unless `apply` is exactly `true`. Reads the pre-registry store and
 * writes ONLY registry documents — it never puts, deletes or overwrites a game
 * object, which is the whole reason the historical works stay recoverable.
 *
 * Deliberately admin-only and CSRF-guarded: importing makes historical content
 * publicly readable, so it is a publish-class action, not a read.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireRole(request, "admin");
    assertSafeMutation(request);

    let apply = false;
    let limit: number | undefined;
    const raw = await request.text();
    if (raw.trim().length > 0) {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "invalid_json", "请求体不是合法 JSON。");
      }
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const record = body as { apply?: unknown; limit?: unknown };
        apply = record.apply === true;
        if (typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0) {
          limit = Math.min(Math.floor(record.limit), 5000);
        }
      }
    }

    const report = await runLegacyImport({ apply, limit });

    if (apply) {
      const hints = clientHints(request);
      await recordAudit(await getRegistry(), {
        actor: { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash },
        action: "work.import_legacy",
        targetType: "work",
        targetId: "*",
        before: null,
        after: {
          imported: report.totals.importPublished,
          quarantined: report.totals.importQuarantined,
          skipped: report.totals.skipExisting + report.totals.skipInvalidId,
          source: report.source,
        },
      });
    }

    return jsonResponse(200, report);
  } catch (error) {
    return toErrorResponse(error, "import-legacy");
  }
}
