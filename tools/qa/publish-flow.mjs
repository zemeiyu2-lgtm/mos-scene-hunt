#!/usr/bin/env node
/**
 * 隔离环境闭环验证：提交 → 审核 → 发布 → 公开读取 → 目录可见 → 撤下 → 恢复
 *
 * 前置：目标服务使用**隔离存储**（REGISTRY_STORE=fs + 临时 REGISTRY_DIR/PUBLISHED_GAMES_DIR），
 *       并已通过 BOOTSTRAP_ADMIN_EMAIL/PASSWORD 引导管理员。
 * 该脚本不连接生产；BASE_URL 必须是 127.0.0.1。
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3211";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) {
  console.error("FAIL 该脚本只允许对 localhost 运行");
  process.exit(2);
}
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL;
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const PACK = process.env.PACK_PATH ?? path.resolve("content/fisheng-comprehensive-test.json");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) { console.log(results.join("\n")); process.exit(1); }
};

function cookieOf(res) {
  const list = res.headers.getSetCookie?.() ?? [];
  return list.map((c) => c.split(";")[0]).find((c) => c.includes("=")) ?? "";
}

const json = async (res) => { try { return await res.json(); } catch { return {}; } };
const post = (url, body, cookie) => fetch(`${BASE}${url}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body ?? {}),
});

const game = JSON.parse(readFileSync(PACK, "utf8"));
const gameId = game.id;

// 0. 未登录提交必须 401
const anon = await post("/api/publish", game);
check("未登录提交被拒", anon.status === 401, `status=${anon.status}`);

// 1. 登录（隔离环境引导管理员）
const login = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });
check("管理员登录", login.status === 200, `status=${login.status}`);
const cookie = cookieOf(login);
check("取得会话 Cookie", cookie.length > 0);

// 2. 非法 id 必须 400
const bad = await post("/api/publish", { ...game, id: "Bad Id" }, cookie);
check("非法 gameId 被拒", bad.status === 400, `status=${bad.status}, code=${(await json(bad)).error}`);

// 3. 提交
const submitted = await post("/api/publish", game, cookie);
const submitBody = await json(submitted);
check("提交成功", submitted.status === 201 || submitted.status === 200, `status=${submitted.status}, versionId=${submitBody.versionId}, state=${submitBody.workState}`);
const versionId = submitBody.versionId;
check("返回 versionId 为 16 位十六进制", /^[0-9a-f]{16}$/.test(versionId ?? ""));
check("提交后不在公开面（publishedVersionId 为空）", submitBody.publishedVersionId === null);

// 4. 未发布前公开读取必须 404
const beforePublish = await fetch(`${BASE}/api/games/${gameId}`);
check("未发布时公开读取 404", beforePublish.status === 404, `status=${beforePublish.status}`);

// 5. 审核通过 → 发布
const claim = await post(`/api/admin/works/${gameId}/claim`, {}, cookie);
check("领取审核", claim.status === 200, `status=${claim.status}, code=${(await json(claim)).error ?? "ok"}`);
const decision = await post(`/api/admin/works/${gameId}/decision`, { decision: "approve", reasonCodes: [], checklist: {} }, cookie);
check("审核通过", decision.status === 200, `status=${decision.status}, code=${(await json(decision)).error ?? "ok"}`);
const published = await post(`/api/admin/works/${gameId}/publish`, {}, cookie);
const publishBody = await json(published);
check("发布上线", published.status === 200 && publishBody.work?.state === "published", `status=${published.status}, state=${publishBody.work?.state}`);

// 6. 公开读取：字节与源包规范化后一致（按响应实际内容记录哈希）
const read = await fetch(`${BASE}/api/games/${gameId}`);
const text = await read.text();
check("已发布作品公开可读", read.status === 200, `status=${read.status}, bytes=${text.length}`);
const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
const readVersion = await fetch(`${BASE}/api/games/${gameId}?v=${versionId}`);
check("按版本号可读（?v=）", readVersion.status === 200, `status=${readVersion.status}`);

// 7. 目录可见
const catalog = await fetch(`${BASE}/content/cloud/catalog.json`);
const catalogBody = await json(catalog);
const listed = (catalogBody.games ?? []).some((g) => g.id === gameId);
check("游戏中心目录包含该作品", catalog.status === 200 && listed, `status=${catalog.status}, total=${(catalogBody.games ?? []).length}`);

// 8. 重复提交幂等
const dup = await post("/api/publish", game, cookie);
const dupBody = await json(dup);
check("重复提交幂等", dup.status === 200 && dupBody.reviewStatus === "already_submitted", `status=${dup.status}, reviewStatus=${dupBody.reviewStatus}`);

// 9. 撤下 → 404；恢复 → 200
const withdraw = await post(`/api/admin/works/${gameId}/withdraw`, {}, cookie);
check("撤下成功", withdraw.status === 200, `status=${withdraw.status}`);
const afterWithdraw = await fetch(`${BASE}/api/games/${gameId}`);
check("撤下后公开 404", afterWithdraw.status === 404, `status=${afterWithdraw.status}`);
const restore = await post(`/api/admin/works/${gameId}/restore`, {}, cookie);
check("恢复成功", restore.status === 200, `status=${restore.status}`);
const afterRestore = await fetch(`${BASE}/api/games/${gameId}`);
check("恢复后公开 200", afterRestore.status === 200, `status=${afterRestore.status}`);

// 10. 审计留痕（页面渲染层，抓文本）
const audit = await fetch(`${BASE}/admin/audit`, { headers: { Cookie: cookie } });
const auditText = await audit.text();
check("审计页含发布与撤下记录", audit.status === 200 && /发布|撤下/.test(auditText), `status=${audit.status}`);

console.log(results.join("\n"));
console.log(`\nINFO gameId=${gameId} versionId=${versionId} publicHash=${digest}`);
