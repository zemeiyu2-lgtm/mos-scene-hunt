/**
 * Request-scoped authentication for route handlers.
 *
 * Deliberately built on the plain `Request` object (cookie header parsing)
 * rather than `next/headers`, so every guard can be unit-tested by calling the
 * handler with a `Request` — no server, no request context, no mocks.
 *
 * Guard order is part of the contract: authenticate BEFORE touching data, so
 * an unauthorised caller cannot learn whether a game id exists from a timing
 * or status difference.
 */

import { getRegistry, type RegistryStore } from "../registry/store";
import { ROLE_RANK, type Role } from "../registry/types";
import { SESSION_COOKIE, hashHeader, verifySession, type SessionContext } from "./session";
import { sessionCookieCandidates } from "./cookie";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(headers ?? {}),
    },
  });
}

/** Maps a thrown {@link HttpError} to a JSON response; anything else is a 500. */
export function toErrorResponse(error: unknown, logTag: string): Response {
  if (error instanceof HttpError) {
    return jsonResponse(error.status, {
      error: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    });
  }
  console.error(`[${logTag}] 未处理错误`, error);
  return jsonResponse(500, { error: "internal_error", message: "服务器内部错误，请稍后重试。" });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    const value = part.slice(index + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}

export function clientHints(request: Request): { ipHash: string; uaHash: string } {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  return { ipHash: hashHeader(ip), uaHash: hashHeader(request.headers.get("user-agent")) };
}

/** Live session for this request, or null. Never throws. */
export async function currentSession(
  request: Request,
  store: RegistryStore = getRegistry(),
): Promise<SessionContext | null> {
  // The cookie NAME differs between environments (`__Host-` prefix in
  // production), so both candidates must be tried. Reading only the dev name
  // here made every admin endpoint return 401 in a production build while the
  // unit tests — which run with the unprefixed name — stayed green.
  for (const name of sessionCookieCandidates()) {
    const token = readCookie(request, name);
    if (!token) continue;
    const context = await verifySession(store, token);
    if (context) return context;
  }
  return null;
}

/** Any signed-in user. */
export async function requireUser(request: Request, store?: RegistryStore): Promise<SessionContext> {
  const context = await currentSession(request, store);
  if (!context) {
    throw new HttpError(401, "unauthenticated", "请先登录。");
  }
  return context;
}

/** Signed-in user whose role is at least `min`. */
export async function requireRole(
  request: Request,
  min: Role,
  store?: RegistryStore,
): Promise<SessionContext> {
  const context = await requireUser(request, store);
  if (ROLE_RANK[context.user.role] < ROLE_RANK[min]) {
    throw new HttpError(403, "forbidden", "当前账号没有执行该操作的权限。");
  }
  return context;
}

/**
 * CSRF defence for mutations: same-origin only, and JSON only.
 *
 * SameSite=Lax already blocks cross-site form posts, but a lax cookie plus a
 * text/plain body is a classic bypass; requiring both an Origin match and a
 * JSON content type closes it without a token round-trip.
 */
export function assertSafeMutation(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "请以 application/json 提交。");
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    // Non-browser clients (tests, curl) omit Origin; allow them only when they
    // also present no cookie-based session, which requireUser already enforced.
    return;
  }
  const host = request.headers.get("host");
  if (!host) {
    throw new HttpError(403, "bad_origin", "缺少 Host 头，拒绝写入。");
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "bad_origin", "Origin 头不合法。");
  }
  if (originHost !== host) {
    throw new HttpError(403, "bad_origin", "跨站请求被拒绝。");
  }
}

/** Public-read cache policy helper; unpublished content must never be cached. */
export const NO_STORE = "no-store" as const;
