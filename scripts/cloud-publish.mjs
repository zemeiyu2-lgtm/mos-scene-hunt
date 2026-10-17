#!/usr/bin/env node
/**
 * scripts/cloud-publish.mjs - 维护者工具：检查发布通道里的内容。
 *
 * 2026-10-17 起，正式发布数据存在 **Vercel Blob**，不再写进仓库的 content/。
 * 因此这个脚本原来的「把包落进 content/ 并提交」已经没有意义了——那样做会
 * 在仓库里再造一份会漂移的副本。现在它做三件只读的事：
 *
 *   npm run cloud:publish -- <token 或 /api/cloud/games/<token> 或完整 URL>
 *     用发布凭据取回那一版包体，复核摘要与结构（用于排错、留档）。
 *
 *   npm run cloud:publish -- --list
 *     列出 store 里已发布的游戏（id、摘要、站数、发布时间）。
 *
 *   npm run cloud:publish -- --show <gameId>
 *     打印某个已发布游戏的当前版本摘要与元数据。
 *
 * 为什么只读：发布已经通过接口完成，改动内容只能通过「重新发布」这个动作，
 * 这样每次变更都有摘要、有令牌、有审计记录，而不是某台机器上的一次手工编辑。
 *
 * 安全：脚本不持有发布密钥，只用发布凭据（有时效）或本地只读存储凭据。
 */

import { createHash } from "node:crypto";
import process from "node:process";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

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
  const base = process.env.MOS_CLOUD_BASE_URL ?? "http://127.0.0.1:3000";
  if (value.startsWith("/")) return new URL(value, base).toString();
  return new URL(`/api/cloud/games/${encodeURIComponent(value)}`, base).toString();
}

/* ------------------------------------------------------------------ */
/* --list / --show：直接读存储（需要本机有只读/读写 token）             */
/* ------------------------------------------------------------------ */

async function loadStore() {
  // 动态 import：只有 --list / --show 才需要 SDK，取回凭据不需要。
  const store = await import("../lib/cloud/blob-store.ts");
  const config = store.readBlobConfig();
  if (!config.configured) {
    die(config.reason + "\n  本机请设置 BLOB_READ_WRITE_TOKEN 后重试（不要把它提交进仓库）。");
  }
  return store;
}

async function listPublished() {
  const store = await loadStore();
  const index = await store.readIndex();
  const entries = Object.entries(index.games);
  if (entries.length === 0) {
    console.log("存储里还没有已发布的内容。");
    return;
  }
  console.log(`已发布 ${entries.length} 款：`);
  for (const [id, pointer] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${id}\n    ${pointer.title} · ${pointer.sceneCount} 站 · 摘要 ${pointer.digest.slice(0, 12)}… · ` +
        `发布 ${pointer.publishedAt.slice(0, 10)}`,
    );
  }

  const drafts = await store.readDrafts();
  const draftOnly = drafts.games.filter((item) => !index.games[item.id]);
  if (draftOnly.length > 0) {
    console.log(`\n草稿（玩家看不到）${draftOnly.length} 款：`);
    for (const item of draftOnly) {
      console.log(`  ${item.id} · ${item.title} · 收到 ${item.receivedAt.slice(0, 10)}`);
    }
  }
}

async function showGame(gameId) {
  const store = await loadStore();
  const index = await store.readIndex();
  const pointer = index.games[gameId];
  if (!pointer) {
    die(`已发布索引里没有「${gameId}」。用 --list 看现有条目。`);
  }
  const text = await store.readPublishedPack(gameId, pointer.digest);
  if (text === null) {
    die(`索引指向的包体不存在（${pointer.pathname}），存储可能被清理过。`);
  }
  const actual = sha256(text);
  console.log(`游戏：${pointer.title}（${gameId}）`);
  console.log(`  当前版本摘要：${pointer.digest}`);
  console.log(`  实际内容摘要：${actual}  ${actual === pointer.digest ? "✓ 吻合" : "✗ 不吻合（数据被改过）"}`);
  console.log(`  站数：${pointer.sceneCount} · 发布：${pointer.publishedAt} · 首次收到：${pointer.receivedAt}`);
  console.log(`  提醒条数：${pointer.warningCount}`);
  if (actual !== pointer.digest) process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 取回凭据：复核某一版内容                                            */
/* ------------------------------------------------------------------ */

async function fetchByToken(input) {
  const url = resolveUrl(input);
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
      detail = JSON.parse(bodyText).message ?? detail;
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

  const headerId = response.headers.get("x-publish-game-id");
  if (headerId && game?.id !== headerId) {
    die(`包体 id（${game?.id}）与凭据声明的 id（${headerId}）不一致，已中止。`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(game?.id ?? ""))) {
    die(`游戏 id 不合法：${JSON.stringify(game?.id)}`);
  }

  const digest = sha256(bodyText);
  console.log(`  游戏：${game.title}（${game.id}）· ${game.scenes?.length ?? "?"} 站 · 摘要 ${digest.slice(0, 12)}…`);

  const { validateGamePackage } = await import("../lib/game/package.ts");
  const report = validateGamePackage(game);
  const errors = report.issues.filter((issue) => issue.severity === "error");
  if (!report.game || errors.length > 0) {
    die("包体未通过本地校验：" + (errors[0]?.message ?? "无法解析"));
  }
  console.log("✓ 结构校验通过（会话与答案字段随包分发，这不是秘密）。");
}

/* ------------------------------------------------------------------ */

if (flags.has("--list")) {
  await listPublished();
} else if (flags.has("--show")) {
  if (positional.length === 0) die("用法：npm run cloud:publish -- --show <gameId>", 2);
  await showGame(positional[0]);
} else if (positional.length > 0) {
  await fetchByToken(positional[0]);
} else {
  console.log(`用法：
  npm run cloud:publish -- <token|URL>     复核某一版发布凭据对应的内容
  npm run cloud:publish -- --list          列出已发布与草稿
  npm run cloud:publish -- --show <gameId> 查看某个游戏当前版本`);
  process.exit(2);
}
