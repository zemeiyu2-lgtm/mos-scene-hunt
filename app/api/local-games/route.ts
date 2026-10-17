import { NextResponse } from "next/server";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Game } from "@/lib/game/types";
import { exportGameJson, validateGamePackage } from "@/lib/game/package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_DIR = path.join(process.cwd(), "data", "game-packages");
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

function enabled() {
  return process.env.MOS_LOCAL_GAME_STORE === "1";
}

function authorized(request: Request) {
  const expected = process.env.MOS_LOCAL_GAME_STORE_TOKEN;
  return Boolean(expected && request.headers.get("x-mos-local-token") === expected);
}

function unavailable() {
  return NextResponse.json(
    { error: "local_game_store_disabled", message: "电脑游戏包服务器尚未启用。请在本机服务设置 MOS_LOCAL_GAME_STORE=1 后重启。" },
    { status: 503 },
  );
}

/** Persistent game-package storage for a Next.js instance running on the creator's own computer. */
export async function GET() {
  if (!enabled()) return NextResponse.json({ enabled: false, games: [] });
  try {
    await mkdir(STORE_DIR, { recursive: true });
    const names = (await readdir(STORE_DIR)).filter((name) => SAFE_ID.test(name.replace(/\.json$/i, "")) && name.endsWith(".json"));
    const games: Game[] = [];
    for (const name of names) {
      try {
        const raw: unknown = JSON.parse(await readFile(path.join(STORE_DIR, name), "utf8"));
        const report = validateGamePackage(raw);
        if (report.game && !report.issues.some((issue) => issue.severity === "error")) games.push(report.game);
      } catch {
        // Ignore damaged files but leave them on disk for recovery.
      }
    }
    games.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    return NextResponse.json({ enabled: true, games });
  } catch (error) {
    return NextResponse.json({ error: "local_game_store_read_failed", message: error instanceof Error ? error.message : "无法读取电脑游戏包目录。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!enabled()) return unavailable();
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized", message: "请输入电脑游戏包服务器的访问口令。" }, { status: 401 });
  try {
    const body = await request.json() as { game?: unknown };
    const report = validateGamePackage(body?.game);
    if (!report.game || report.issues.some((issue) => issue.severity === "error")) {
      return NextResponse.json({ error: "invalid_game_package", message: "游戏包存在结构性错误，请先在创作中心修复。", issues: report.issues }, { status: 422 });
    }
    if (!SAFE_ID.test(report.game.id)) {
      return NextResponse.json({ error: "invalid_game_id", message: "游戏 ID 只能包含英文字母、数字、下划线和连字符。" }, { status: 422 });
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(path.join(STORE_DIR, report.game.id + ".json"), exportGameJson(report.game) + "\n", "utf8");
    return NextResponse.json({ ok: true, game: report.game, message: "已保存到电脑游戏包服务器。" });
  } catch (error) {
    return NextResponse.json({ error: "local_game_store_write_failed", message: error instanceof Error ? error.message : "保存游戏包失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!enabled()) return unavailable();
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized", message: "请输入电脑游戏包服务器的访问口令。" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "invalid_game_id", message: "游戏 ID 不合法。" }, { status: 400 });
  try {
    await unlink(path.join(STORE_DIR, id + ".json"));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "not_found", message: "没有找到这个游戏包。" }, { status: 404 });
    return NextResponse.json({ error: "local_game_store_delete_failed", message: error instanceof Error ? error.message : "删除失败。" }, { status: 500 });
  }
}
