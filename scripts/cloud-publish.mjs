#!/usr/bin/env node
/**
 * scripts/cloud-publish.mjs - 把发布通道里**已批准**的游戏包落进仓库内容层。
 *
 * 为什么必须有这一步：线上站点是从 Git 构建的只读部署，任何「在线写入」都不会
 * 变成玩家能看到的内容。所以「发布」的最后一公里只能是一次可审计的提交。
 *
 * 用法：
 *   npm run cloud:publish -- <token 或 /api/cloud/games/<token> 或完整 URL> [--publish] [--dry-run]
 *
 *   --publish   目录条目状态写 published（默认 draft：只落库，不上玩家目录）
 *   --dry-run   只打印将要发生的改动，不写文件
 *
 * 它做的事：
 *   1. 把令牌换成包体（GET /api/cloud/games/<token>）——包体来自服务端存储，
 *      不是命令行里传进来的任意文件，因此「落库内容」与「被批准的摘要」一致。
 *   2. 复核摘要、重新跑一遍游戏包校验（服务端可能被替换，本地再验一次不贵）。
 *   3. 写 content/<packFile>，并合并 content/cloud/catalog.json 条目。
 *   4. 打印下一步：git diff / 提交到功能分支 / 开 PR。
 *
 * 安全：脚本本身不持有任何密钥，只持有一个有时效的发布令牌。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
// 静态 import（而不是运行时 await import）：这样 esbuild 在构建期就把
// lib/game/package.ts 打进单文件产物，CLI 与应用共用同一套校验逻辑。
import { validateGamePackage } from "../lib/game/package.ts";

const root = process.cwd();
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const dryRun = flags.has("--dry-run");
const publish = flags.has("--publish");

function die(message, code = 1) {
  console.error("✗ " + message);
  process.exit(code);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** 接受 token、/api/... 路径或完整 URL，统一成绝对 URL。 */
function resolveUrl(input) {
  const value = input.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) {
    const base = process.env.MOS_CLOUD_BASE_URL ?? "http://127.0.0.1:3000";
    return new URL(value, base).toString();
  }
  const base = process.env.MOS_CLOUD_BASE_URL ?? "http://127.0.0.1:3000";
  return new URL(`/api/cloud/games/${encodeURIComponent(value)}`, base).toString();
}

if (positional.length === 0) {
  die(
    "缺少发布令牌。用法：npm run cloud:publish -- <token 或 /api/cloud/games/<token> 或完整 URL> [--publish] [--dry-run]",
    2,
  );
}

const url = resolveUrl(positional[0]);
console.log("→ 取回已批准的游戏包：" + url);

let response;
try {
  response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
} catch (error) {
  die(`网络请求失败：${error instanceof Error ? error.message : String(error)}`);
}

const bodyText = await response.text();
if (!response.ok) {
  let detail = bodyText.slice(0, 300);
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed.message ?? detail;
  } catch {
    /* 非 JSON 错误体，直接用原文 */
  }
  die(`服务端拒绝（HTTP ${response.status}）：${detail}`);
}

let game;
try {
  game = JSON.parse(bodyText);
} catch {
  die("服务端返回的不是合法 JSON；可能取到了登录页或错误页。");
}

// 复核：令牌声明的 id 必须与包体一致。
const headerId = response.headers.get("x-publish-game-id");
if (headerId && game?.id !== headerId) {
  die(`包体 id（${game?.id}）与凭据声明的 id（${headerId}）不一致，已中止。`);
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(game?.id ?? ""))) {
  die(`游戏 id 不合法：${JSON.stringify(game?.id)}`);
}

const digest = sha256(bodyText);
console.log(`  游戏：${game.title}（${game.id}）· ${game.scenes?.length ?? "?"} 站 · 摘要 ${digest.slice(0, 12)}…`);

// 本地再跑一次校验：直接用应用自己的规则（由 scripts/build-cloud-publish.mjs 打包进来）。
const report = validateGamePackage(game);
const errors = report.issues.filter((issue) => issue.severity === "error");
if (!report.game || errors.length > 0) {
  die("包体未通过本地校验：" + (errors[0]?.message ?? "无法解析"));
}

const packPath = path.join(root, "content", `${game.id}.json`);
const catalogPath = path.join(root, "content", "cloud", "catalog.json");
const desiredStatus = publish ? "published" : "draft";

if (!existsSync(catalogPath)) die(`找不到目录文件：${catalogPath}`);
let catalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
} catch (error) {
  die(`目录文件不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
}
if (!Array.isArray(catalog.games)) die("目录文件缺少 games 数组。");

const existing = catalog.games.find((entry) => entry.id === game.id);
if (existing && existing.packFile && existing.packFile !== `${game.id}.json`) {
  die(`id 冲突：目录中已有「${existing.id}」使用 ${existing.packFile}，拒绝覆盖。`);
}

const entry = {
  id: game.id,
  title: game.title,
  author: game.author ?? "MOS Scene Hunt",
  description: game.description,
  language: game.language ?? "zh-CN",
  ...(game.estimatedMinutes ? { estimatedMinutes: game.estimatedMinutes } : {}),
  ...(game.difficulty ? { difficulty: game.difficulty } : {}),
  sceneCount: game.scenes.length,
  status: desiredStatus,
  packFile: `${game.id}.json`,
  ...(desiredStatus === "published" ? { publishedAt: new Date().toISOString().slice(0, 10) } : {}),
};

const nextCatalog = {
  ...catalog,
  updatedAt: new Date().toISOString().slice(0, 10),
  games: existing
    ? catalog.games.map((item) => (item.id === game.id ? { ...item, ...entry } : item))
    : [...catalog.games, entry],
};

console.log(`\n${dryRun ? "（试运行，不写文件）" : ""}将执行：`);
console.log(`  写入 ${path.relative(root, packPath)}（${Buffer.byteLength(bodyText)} 字节）`);
console.log(`  ${existing ? "更新" : "新增"}目录条目：${game.id} → status=${desiredStatus}`);

if (dryRun) process.exit(0);

writeFileSync(packPath, bodyText, "utf8");
writeFileSync(catalogPath, JSON.stringify(nextCatalog, null, 2) + "\n", "utf8");

console.log("\n✓ 已落库。下一步（请由维护者确认后执行）：");
console.log("  git add content/ && git status --short");
console.log(`  git commit -m "content: ${desiredStatus === "published" ? "publish" : "stage"} ${game.id}"`);
console.log("  git push origin <功能分支>   # 通过 PR 合并，Vercel 会为新提交生成部署");
if (!publish) {
  console.log("\n  注意：本次以 draft 落库，玩家看不到。确认内容无误后加 --publish 重新落库，或直接改目录状态。");
}
