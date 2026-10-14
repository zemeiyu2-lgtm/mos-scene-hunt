import { randomBytes } from "node:crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { validateGame } from "@/lib/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 512 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 8;
const requests = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request): string {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}
function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = requests.get(key);
  if (!entry || entry.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}
export async function POST(request: Request) {
  if (isRateLimited(clientKey(request))) return NextResponse.json({ error: "分享请求过于频繁，请稍后再试。" }, { status: 429 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: "游戏内容过大，暂不支持发布。" }, { status: 413 });
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return NextResponse.json({ error: "游戏内容过大，暂不支持发布。" }, { status: 413 });
    const payload = JSON.parse(raw) as { game?: unknown };
    if (!payload?.game) return NextResponse.json({ error: "缺少游戏内容。" }, { status: 400 });
    const { game, issues } = validateGame(payload.game);
    const firstError = issues.find((issue) => issue.severity === "error");
    if (firstError) return NextResponse.json({ error: "游戏校验失败：" + firstError.message }, { status: 400 });
    const id = randomBytes(12).toString("base64url");
    await put(`shares/${id}.json`, JSON.stringify(game), {
      access: "private", addRandomSuffix: false,
      contentType: "application/json; charset=utf-8", cacheControlMaxAge: 60,
    });
    return NextResponse.json({ id, path: `/s/${id}` }, { status: 201 });
  } catch (error) {
    console.error("Unable to publish game share", error);
    return NextResponse.json({ error: "暂时无法创建短链接，请稍后重试或使用导出游戏包。" }, { status: 500 });
  }
}
