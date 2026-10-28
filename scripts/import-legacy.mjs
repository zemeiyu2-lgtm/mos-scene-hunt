#!/usr/bin/env node
/**
 * Operator entry point for the legacy import.
 *
 * Signs in as an admin over real HTTP and calls POST /api/admin/import-legacy.
 * It exists so an operator never has to hand-craft a curl with a session
 * cookie, and so every run is a recorded, reviewable act.
 *
 * Usage:
 *   BASE_URL=https://host ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     node scripts/import-legacy.mjs                 # dry run (default)
 *   ... node scripts/import-legacy.mjs --apply       # actually import
 *
 * Options:
 *   --apply          perform the import (without it, nothing is written)
 *   --limit N        stop after N games (useful for a first inspection)
 *   --json           print the raw report instead of a table
 *
 * Preview deployments sit behind a share-code gateway: pass SHARECODE=... so
 * the script can exchange it for the gateway cookie.
 */

import http from "node:http";
import https from "node:https";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const JSON_OUT = args.includes("--json");
const limitIndex = args.indexOf("--limit");
const LIMIT = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;

const rawBase = process.env.BASE_URL || "http://127.0.0.1:3000";
const baseUrl = new URL(rawBase);
const BASE = baseUrl.origin;
const TRANSPORT = baseUrl.protocol === "https:" ? https : http;
const SHARECODE = process.env.SHARECODE || baseUrl.searchParams.get("sharecode") || "";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

let gatewayCookie = "";

function call(path, { method = "GET", body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const headers = {};
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const jar = [gatewayCookie, cookie].filter(Boolean).join("; ");
    if (jar) headers.cookie = jar;
    const req = TRANSPORT.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* html */
          }
          resolve({ status: res.statusCode, json, text, setCookie: res.headers["set-cookie"] ?? [] });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function cookiesFrom(res) {
  return res.setCookie
    .map((entry) => entry.split(";")[0])
    .filter((pair) => pair && pair.includes("=") && !pair.endsWith("="))
    .join("; ");
}

if (!EMAIL || !PASSWORD) {
  console.error("缺少 ADMIN_EMAIL / ADMIN_PASSWORD 环境变量。");
  process.exit(2);
}

if (SHARECODE) {
  const gate = await call(`/?sharecode=${encodeURIComponent(SHARECODE)}`);
  gatewayCookie = cookiesFrom(gate);
}

const login = await call("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
if (login.status !== 200) {
  console.error(`登录失败（HTTP ${login.status}）：${login.json?.message ?? login.text.slice(0, 120)}`);
  process.exit(2);
}
const session = cookiesFrom(login);

const body = {};
if (APPLY) body.apply = true;
if (LIMIT && Number.isFinite(LIMIT)) body.limit = LIMIT;

console.log(`\n=== 历史作品导入 @ ${BASE} ===`);
console.log(APPLY ? "模式：APPLY（会写入 registry，但绝不修改历史对象）" : "模式：DRY RUN（只读，不写任何数据）");

const res = await call("/api/admin/import-legacy", { method: "POST", body, cookie: session });
if (res.status !== 200) {
  console.error(`导入失败（HTTP ${res.status}）：${res.json?.message ?? res.text.slice(0, 200)}`);
  process.exit(1);
}

const report = res.json;
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (!report.listingComplete) {
    console.log(`\n⚠ 列表不完整：${report.listingError}`);
  }
  console.log(`来源：${report.source} ${report.location}`);
  console.log(
    `汇总：共 ${report.totals.games} 个作品 / 可上线 ${report.totals.importPublished} / 隔离 ${report.totals.importQuarantined} / 已存在 ${report.totals.skipExisting} / id 非法 ${report.totals.skipInvalidId} / 版本对象 ${report.totals.versionsSeen}`,
  );
  console.log("");
  for (const game of report.games) {
    const label =
      game.action === "import_published"
        ? "上线"
        : game.action === "import_quarantined"
          ? "隔离"
          : game.action === "skip_existing"
            ? "跳过(已存在)"
            : "跳过(id非法)";
    console.log(`  [${label}] ${game.gameId}  versions=${game.versions.length}  latest=${game.latestVersionId ?? "—"}`);
    if (game.note) console.log(`      ${game.note}`);
    for (const version of game.versions) {
      if (!version.ok) console.log(`      ! ${version.versionId}: ${version.problem}`);
    }
  }
}

if (!APPLY) {
  console.log("\n以上为演练结果，未写入任何数据。确认无误后加 --apply 执行。\n");
} else {
  console.log("\n已写入 registry。历史对象保持原样；如需回退，见 docs/迁移与回退方案.md。\n");
}
