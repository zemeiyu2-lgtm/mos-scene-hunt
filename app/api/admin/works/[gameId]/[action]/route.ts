import {
  HttpError,
  assertSafeMutation,
  clientHints,
  jsonResponse,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/guard";
import { isValidGameId } from "@/lib/publish/version";
import {
  applySimpleAction,
  claimReview,
  decide,
  publishWork,
} from "@/lib/registry/service";

/**
 * Admin actions on one work.
 *
 * POST /api/admin/works/<gameId>/claim
 * POST /api/admin/works/<gameId>/decision   { decision, reasonCodes, reasonText, checklist }
 * POST /api/admin/works/<gameId>/publish
 * POST /api/admin/works/<gameId>/withdraw | unlist | restore | archive
 *
 * Authorisation matrix (design §9.2):
 *  - reviewers may claim and decide; they may NOT publish or withdraw.
 *  - publishing, withdrawing, unlinking, restoring and archiving are admin-only.
 * The role check happens before any work document is read, so a 403 never
 * reveals whether the game id exists.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIMPLE_ACTIONS = ["withdraw", "unlist", "restore", "archive"] as const;
type SimpleAction = (typeof SIMPLE_ACTIONS)[number];

const DECISIONS = ["approve", "request_changes", "reject"] as const;
type Decision = (typeof DECISIONS)[number];

function isSimpleAction(value: string): value is SimpleAction {
  return (SIMPLE_ACTIONS as readonly string[]).includes(value);
}

function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string; action: string }> },
): Promise<Response> {
  try {
    const { gameId: rawId, action } = await params;
    const gameId = decodeURIComponent(rawId);
    if (!isValidGameId(gameId)) {
      throw new HttpError(400, "invalid_game_id", "游戏 id 不合法。");
    }

    // Publishing changes what the public sees: admin only, checked first.
    const needsAdmin = action === "publish" || isSimpleAction(action);
    const auth = needsAdmin
      ? await requireRole(request, "admin")
      : await requireRole(request, "reviewer");

    assertSafeMutation(request);
    const hints = clientHints(request);
    const actor = { user: auth.user, ipHash: hints.ipHash, uaHash: hints.uaHash };

    if (action === "claim") {
      const work = await claimReview(actor, gameId);
      return jsonResponse(200, { work });
    }

    if (action === "decision") {
      const body = (await readJson(request)) as {
        decision?: unknown;
        reasonCodes?: unknown;
        reasonText?: unknown;
        checklist?: unknown;
      };
      if (!isDecision(body.decision)) {
        throw new HttpError(400, "invalid_decision", "decision 必须是 approve / request_changes / reject。");
      }
      const reasonCodes = Array.isArray(body.reasonCodes)
        ? body.reasonCodes.filter((c): c is string => typeof c === "string").slice(0, 10)
        : [];
      const reasonText = typeof body.reasonText === "string" ? body.reasonText.slice(0, 2000) : "";
      const checklist: Record<string, boolean> =
        body.checklist && typeof body.checklist === "object"
          ? Object.fromEntries(
              Object.entries(body.checklist as Record<string, unknown>)
                .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
                .slice(0, 20),
            )
          : {};
      const work = await decide({
        actor,
        gameId,
        decision: body.decision,
        reasonCodes,
        reasonText,
        checklist,
      });
      return jsonResponse(200, { work });
    }

    if (action === "publish") {
      const work = await publishWork(actor, gameId);
      return jsonResponse(200, { work });
    }

    if (isSimpleAction(action)) {
      const work = await applySimpleAction(actor, gameId, action);
      return jsonResponse(200, { work });
    }

    throw new HttpError(404, "unknown_action", `未知操作：${action}`);
  } catch (error) {
    return toErrorResponse(error, "admin-works");
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "请以 application/json 提交。");
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_body", "请求体必须是一个 JSON 对象。");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "请求体不是合法 JSON。");
  }
}
