import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { validateGame } from "@/lib/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return NextResponse.json({ error: "分享链接无效。" }, { status: 404 });
  try {
    const blob = await get(`shares/${id}.json`, { access: "private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return NextResponse.json({ error: "这份游戏不存在，或分享链接已失效。" }, { status: 404 });
    const raw = await new Response(blob.stream).text();
    const { game, issues } = validateGame(JSON.parse(raw));
    if (issues.some((issue) => issue.severity === "error")) throw new Error("Stored game failed validation");
    return NextResponse.json({ game }, { headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("Unable to load game share", error);
    return NextResponse.json({ error: "无法读取这份游戏，请检查链接或稍后重试。" }, { status: 404 });
  }
}
