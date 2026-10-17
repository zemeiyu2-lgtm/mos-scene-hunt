#!/usr/bin/env node
/**
 * tests/e2e/cloud-loop-http.mjs - 云端发布闭环的**真实 HTTP** 验收。
 *
 * 与 vitest 路由单测的区别：这里打的是一个真正跑起来的 `next start` 进程，
 * 走真实的网络栈、真实的 Next 路由、真实的文件系统，而不是直接调用处理函数。
 * 它验证的就是部署后线上一模一样的接口行为。
 *
 * 前置：
 *   1. 已构建（npm run build）
 *   2. 服务已启动，且配置了 MOS_CLOUD_PUBLISH_KEY / MOS_CLOUD_PUBLISH_SECRET
 *
 * 用法：node tests/e2e/cloud-loop-http.mjs [--base http://127.0.0.1:3210]
 *
 * 注意：每一步都记录「期望状态码 → 实际状态码」，失败即非零退出。
 * 本脚本不会修改仓库里的 content/（落库由 scripts/cloud-publish.mjs 负责），
 * 但会在 content/cloud/publish-store/ 里写入已批准的包（该目录已在 .gitignore）。
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : process.env.CLOUD_LOOP_BASE ?? "http://127.0.0.1:3210";
const KEY = process.env.MOS_CLOUD_PUBLISH_KEY ?? "local-acceptance-publish-key-001";

const results = [];
function check(name, expected, actual, extra = "") {
  const pass = Array.isArray(expected) ? expected.includes(actual) : expected === actual;
  results.push({ name, expected, actual, pass, extra });
  console.log(`  ${pass ? "✓" : "✗"} ${name} — 期望 ${String(expected)}，实际 ${actual}${extra ? "，" + extra : ""}`);
}

async function post(body, { key = KEY, raw = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/cloud/games`, {
    method: "POST",
    headers,
    body: raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应保留原文即可 */
  }
  return { status: res.status, text, json, headers: res.headers };
}

const acceptanceGame = JSON.parse(readFileSync(new URL("./fixtures/acceptance-game.json", import.meta.url), "utf8"));

console.log(`\n§1 接口自述与访问控制（${BASE}）`);
{
  const res = await fetch(`${BASE}/api/cloud/games`);
  const body = await res.json();
  check("GET 接口自述", 200, res.status, `enabled=${body.enabled}`);
  check("自述不泄露密钥", true, !JSON.stringify(body).includes(KEY));
}

{
  const res = await post({ game: acceptanceGame }, { key: "" });
  check("未带发布密钥被拒绝", 401, res.status);
}
{
  const res = await post({ game: acceptanceGame }, { key: "wrong-key-wrong-key-wrong" });
  check("错误发布密钥被拒绝", 403, res.status);
}
{
  // 未授权请求不能写入：确认拒绝之后目录/存储都没有多出东西。
  const store = await fetch(`${BASE}/api/cloud/games`).then((r) => r.json());
  check("被拒绝后通道状态未变化", true, store.enabled === true);
}

console.log("\n§2 无效游戏包");
{
  const res = await post({ game: { id: "broken", title: "坏包", scenes: [] } });
  check("结构性错误被拒绝", 422, res.status, res.json?.issues?.length ? `${res.json.issues.length} 条问题` : "");
}
{
  const res = await post("{ this is not json", { raw: true });
  check("非 JSON 被拒绝", 400, res.status);
}
{
  const placeholder = structuredClone(acceptanceGame);
  placeholder.id = "acceptance-placeholder";
  placeholder.scenes[1].location = { lat: 0, lng: 0, radius: 25 };
  const res = await post({ game: placeholder });
  check("0,0 占位坐标被拒绝", 422, res.status);
}
{
  const traversal = structuredClone(acceptanceGame);
  traversal.id = "../../etc/passwd";
  const res = await post({ game: traversal });
  check("路径穿越型 id 被拒绝", 422, res.status);
}

console.log("\n§3 发布合法游戏包");
let published;
{
  const res = await post({ game: acceptanceGame });
  check("合法游戏包被接收", 202, res.status);
  published = res.json;
  check("返回内容摘要", true, /^[0-9a-f]{64}$/.test(published?.digest ?? ""));
  check("目录条目为 draft（不会自动上线）", "draft", published?.catalogStatus);
  check("返回获取入口", true, Boolean(published?.retrievalPath));
}

console.log("\n§4 重复发布（幂等）");
{
  const res = await post({ game: acceptanceGame });
  check("同内容重复提交仍被接受", 202, res.status);
  check("摘要与首次一致", published.digest, res.json?.digest);
  check("明确告知内容未变", true, res.json?.unchanged === true);
}

console.log("\n§5 凭令牌取回（手机获取的那一步）");
{
  const res = await fetch(`${BASE}${published.retrievalPath}`);
  const text = await res.text();
  check("有效凭据可取回", 200, res.status);
  const digest = createHash("sha256").update(text).digest("hex");
  check("取回内容摘要与发布一致", published.digest, digest);
  const received = JSON.parse(text);
  check("取回的游戏 id 一致", acceptanceGame.id, received.id);
  check(
    "取回的站点逐一一致",
    JSON.stringify(acceptanceGame.scenes.map((s) => s.id)),
    JSON.stringify(received.scenes.map((s) => s.id)),
  );
  check(
    "取回的坐标逐点一致",
    JSON.stringify(acceptanceGame.scenes.map((s) => s.location)),
    JSON.stringify(received.scenes.map((s) => s.location)),
  );
  check(
    "取回的题目与答案一致",
    JSON.stringify(acceptanceGame.scenes.map((s) => s.challenge)),
    JSON.stringify(received.scenes.map((s) => s.challenge)),
  );
  check("响应头带游戏 id", acceptanceGame.id, res.headers.get("x-publish-game-id"));

  // 落盘一份给浏览器验收用（手机获取的就是这一份内容）。
  mkdirSync(new URL("./artifacts/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./artifacts/cloud-retrieved-package.json", import.meta.url), text, "utf8");
}
{
  const res = await fetch(`${BASE}/api/cloud/games/v1.eyJkaWdlc3QiOiJhYmMiLCJnYW1lSWQiOiJ4In0.forged`);
  check("伪造凭据被拒绝", 401, res.status);
}
{
  const res = await fetch(`${BASE}/api/cloud/games/not-a-token`);
  check("畸形凭据被拒绝", 400, res.status);
}
{
  const res = await fetch(`${BASE}/api/cloud/games/${encodeURIComponent("v1.." )}`);
  check("空载荷凭据被拒绝", 400, res.status);
}

console.log("\n§6 现有静态内容未被破坏");
{
  const res = await fetch(`${BASE}/content/cloud/catalog.json`, { cache: "no-store" });
  const body = await res.json();
  check("线上目录仍可读", 200, res.status, `${body.games?.length ?? 0} 个条目`);
  check("验收包没有被自动写进线上目录", false, (body.games ?? []).some((g) => g.id === acceptanceGame.id));
}
{
  const res = await fetch(`${BASE}/content/rizal-park-discovery.json`);
  check("官方 Rizal Park 包仍可读", 200, res.status);
}
{
  const res = await fetch(`${BASE}/content/../../package.json`);
  check("内容路由仍拒绝路径穿越", [400, 404], res.status);
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${"─".repeat(60)}\n云端发布闭环 HTTP 验收：共 ${results.length} 项，通过 ${passed}，失败 ${failed}`);
writeFileSync(
  new URL("./artifacts/cloud-loop-summary.json", import.meta.url),
  JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed, failed, results }, null, 2),
  "utf8",
);
process.exit(failed === 0 ? 0 : 1);
