#!/usr/bin/env node
/**
 * Real-HTTP end-to-end check for the admin platform.
 *
 * Unlike the vitest suites (which call route handlers directly), this drives a
 * running server over the network with real cookies. It is the evidence that
 * the deployed thing behaves, not just the unit-level functions.
 *
 * Usage:
 *   node tests/e2e-admin/run.mjs [baseUrl]
 *
 * Exit code 0 only when every step passes. Prints one line per assertion so a
 * reviewer can read the transcript without opening a browser.
 */

import http from "node:http";

const BASE = process.argv[2] || "http://127.0.0.1:3210";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@e2e.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "e2e-admin-password-2026";
const CREATOR_EMAIL = `creator-${Date.now()}@e2e.test`;
const CREATOR_PASSWORD = "e2e-creator-password-2026";

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

function cookieFrom(response) {
  // `response.setCookie` is the raw array; fetch-based clients hide this
  // header per the Fetch spec, which is why this script uses node:http.
  for (const entry of response.setCookie ?? []) {
    const pair = entry.split(";")[0];
    if (pair && pair.includes("=")) return pair;
  }
  return "";
}

/**
 * Raw HTTP client.
 *
 * Deliberately not `fetch`: Set-Cookie is a forbidden response header there,
 * and this script's whole job is to inspect the real cookie exchange.
 */
function call(path, { method = "GET", body, raw, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const headers = {};
    let payload;
    if (raw !== undefined) {
      payload = raw;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
    }
    if (payload !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (cookie) headers.cookie = cookie;

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* HTML page */
          }
          resolve({
            status: res.statusCode,
            json,
            text,
            setCookie: res.headers["set-cookie"] ?? [],
            headers: { get: (name) => res.headers[name.toLowerCase()] ?? null },
          });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function pack(id, title, sceneCount = 2) {
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    id: `s${i + 1}`,
    title: `场景 ${i + 1}`,
    story: "这是用于验收的场景描述文本。",
    location: { lat: 14.58 + i * 0.001, lng: 120.98 + i * 0.001, radius: 50 },
    nextSceneId: i + 1 < sceneCount ? `s${i + 2}` : null,
    challenge: { type: "text", question: "输入通行词", answer: ["go"] },
    reward: { type: "keyword", title: "通行词", value: "go" },
  }));
  return {
    id,
    language: "zh-CN",
    title,
    description: "端到端验收使用的游戏包。",
    version: "1.0.0",
    startLocation: { lat: 14.58, lng: 120.98 },
    entrySceneId: "s1",
    scenes,
  };
}

async function main() {
  console.log(`\n=== MOS Scene Hunt 后台端到端验收 @ ${BASE} ===\n`);

  // 0. The login page triggers the one-time bootstrap administrator.
  const loginPage = await call("/admin/login");
  check("GET /admin/login 可访问（触发初始管理员引导）", loginPage.status === 200, `HTTP ${loginPage.status}`);

  // 1. Admin login
  const adminLogin = await call("/api/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminCookie = cookieFrom(adminLogin);
  check("初始管理员可以登录", adminLogin.status === 200, `HTTP ${adminLogin.status}`);
  check("登录返回会话 Cookie", adminCookie.includes("mos_sess="), adminCookie || "(空)");

  // 2. Unauthenticated probes
  const anonPublish = await call("/api/publish", {
    method: "POST",
    body: pack("anon-probe", "匿名提交"),
  });
  check("匿名提交被拒绝（401）", anonPublish.status === 401, `HTTP ${anonPublish.status}`);

  const anonAdmin = await call("/api/admin/works/x/publish", { method: "POST", body: {} });
  check("匿名调用后台接口被拒绝（401）", anonAdmin.status === 401, `HTTP ${anonAdmin.status}`);

  // 3. Create a creator account
  const created = await call("/api/admin/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      email: CREATOR_EMAIL,
      password: CREATOR_PASSWORD,
      displayName: "E2E 创作者",
      role: "creator",
    },
  });
  check("管理员可以创建创作者账号", created.status === 201, `HTTP ${created.status} ${created.text.slice(0, 120)}`);

  const creatorLogin = await call("/api/auth/login", {
    method: "POST",
    body: { email: CREATOR_EMAIL, password: CREATOR_PASSWORD },
  });
  const creatorCookie = cookieFrom(creatorLogin);
  check("创作者可以登录", creatorLogin.status === 200, `HTTP ${creatorLogin.status}`);

  // 4. Submit
  const gameId = `e2e-hunt-${Date.now().toString(36)}`;
  const firstVersionPack = pack(gameId, "E2E 首版");
  const submit = await call("/api/publish", {
    method: "POST",
    cookie: creatorCookie,
    body: firstVersionPack,
  });
  const submitBody = submit.json ?? {};
  check("创作者提交合法游戏包（201）", submit.status === 201, `HTTP ${submit.status} ${submit.text.slice(0, 160)}`);
  check("提交响应不含公开播放链接", submitBody.playPath === undefined, JSON.stringify(submitBody.playPath));
  check("提交后进入待审状态", submitBody.reviewStatus === "pending", String(submitBody.reviewStatus));
  const v1 = submitBody.versionId;

  // 5. Unreviewed content is unreadable
  const readBefore = await call(`/api/games/${gameId}`);
  check("未审核作品公开读取 404", readBefore.status === 404, `HTTP ${readBefore.status}`);
  const readVersionBefore = await call(`/api/games/${gameId}?v=${v1}`);
  check("未审核版本带 ?v= 仍 404", readVersionBefore.status === 404, `HTTP ${readVersionBefore.status}`);

  // 6. Ownership cannot be forged
  const hijack = await call("/api/publish", {
    method: "POST",
    cookie: adminCookie,
    body: pack(gameId, "劫持尝试"),
  });
  check("他人（含管理员）用同一 id 提交被拒绝（403）", hijack.status === 403, `HTTP ${hijack.status}`);
  check("拒绝原因为 game_id_taken", hijack.json?.error === "game_id_taken", String(hijack.json?.error));

  // 7. Creator cannot use admin endpoints
  const forbidden = await call(`/api/admin/works/${gameId}/publish`, {
    method: "POST",
    cookie: creatorCookie,
    body: {},
  });
  check("创作者调用发布接口被拒绝（403）", forbidden.status === 403, `HTTP ${forbidden.status}`);

  // 8. Review
  const claim = await call(`/api/admin/works/${gameId}/claim`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  check("管理员可以领取审核", claim.status === 200, `HTTP ${claim.status}`);

  const noReason = await call(`/api/admin/works/${gameId}/decision`, {
    method: "POST",
    cookie: adminCookie,
    body: { decision: "request_changes", reasonCodes: [], reasonText: "", checklist: {} },
  });
  check("退回但无原因被拒绝（409）", noReason.status === 409, `HTTP ${noReason.status}`);

  const approve = await call(`/api/admin/works/${gameId}/decision`, {
    method: "POST",
    cookie: adminCookie,
    body: { decision: "approve", reasonCodes: [], reasonText: "内容完整", checklist: { played: true } },
  });
  check("审核通过", approve.status === 200, `HTTP ${approve.status}`);

  const readAfterApprove = await call(`/api/games/${gameId}`);
  check("审核通过但未发布时公开读取仍 404", readAfterApprove.status === 404, `HTTP ${readAfterApprove.status}`);

  // 9. Publish
  const publish = await call(`/api/admin/works/${gameId}/publish`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  check("管理员发布成功", publish.status === 200, `HTTP ${publish.status}`);

  const readLive = await call(`/api/games/${gameId}`);
  check("发布后公开读取 200", readLive.status === 200, `HTTP ${readLive.status}`);
  check("公开读取返回的标题正确", readLive.json?.title === "E2E 首版", String(readLive.json?.title));

  // 10. Update does not disturb what is live
  const secondVersionPack = pack(gameId, "E2E 第二版");
  const submit2 = await call("/api/publish", {
    method: "POST",
    cookie: creatorCookie,
    body: secondVersionPack,
  });
  check("创作者提交新版本（201）", submit2.status === 201, `HTTP ${submit2.status}`);
  const v2 = submit2.json?.versionId;

  const readDuringUpdate = await call(`/api/games/${gameId}`);
  check(
    "新版本待审期间，公开读取仍是首版",
    readDuringUpdate.status === 200 && readDuringUpdate.json?.title === "E2E 首版",
    `HTTP ${readDuringUpdate.status} title=${readDuringUpdate.json?.title}`,
  );

  await call(`/api/admin/works/${gameId}/claim`, { method: "POST", cookie: adminCookie, body: {} });
  await call(`/api/admin/works/${gameId}/decision`, {
    method: "POST",
    cookie: adminCookie,
    body: { decision: "approve", reasonCodes: [], reasonText: "", checklist: {} },
  });
  const publish2 = await call(`/api/admin/works/${gameId}/publish`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  check("新版本发布成功", publish2.status === 200, `HTTP ${publish2.status}`);

  const readAfterUpdate = await call(`/api/games/${gameId}`);
  check("发布新版本后公开读取切换到第二版", readAfterUpdate.json?.title === "E2E 第二版", String(readAfterUpdate.json?.title));

  const oldLink = await call(`/api/games/${gameId}?v=${v1}`);
  check("旧版本链接仍可读且内容不变", oldLink.status === 200 && oldLink.json?.title === "E2E 首版", `HTTP ${oldLink.status} title=${oldLink.json?.title}`);
  check("旧版本响应标注不可变缓存", (oldLink.headers.get("cache-control") ?? "").includes("immutable"), oldLink.headers.get("cache-control") ?? "");

  // 11. Withdraw / restore
  const withdraw = await call(`/api/admin/works/${gameId}/withdraw`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  check("撤下成功", withdraw.status === 200, `HTTP ${withdraw.status}`);
  const readWithdrawn = await call(`/api/games/${gameId}`);
  check("撤下后公开读取 404", readWithdrawn.status === 404, `HTTP ${readWithdrawn.status}`);

  const restore = await call(`/api/admin/works/${gameId}/restore`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  check("恢复成功", restore.status === 200, `HTTP ${restore.status}`);
  const readRestored = await call(`/api/games/${gameId}`);
  check(
    "恢复后内容与撤下前一致",
    readRestored.status === 200 && readRestored.json?.title === "E2E 第二版",
    `HTTP ${readRestored.status} title=${readRestored.json?.title}`,
  );

  // 12. Pages render for a signed-in admin, and redirect for anonymous users
  const adminHome = await call("/admin", { cookie: adminCookie });
  check("管理员可打开后台首页", adminHome.status === 200, `HTTP ${adminHome.status}`);

  const queuePage = await call("/admin/queue", { cookie: adminCookie });
  check("管理员可打开审核队列", queuePage.status === 200, `HTTP ${queuePage.status}`);

  const workPage = await call(`/admin/works/${gameId}`, { cookie: adminCookie });
  check("管理员可打开作品详情", workPage.status === 200, `HTTP ${workPage.status}`);

  const anonymousAdmin = await call("/admin", {});
  check(
    "匿名访问后台页面被重定向到登录",
    anonymousAdmin.status === 307 || anonymousAdmin.status === 302,
    `HTTP ${anonymousAdmin.status}`,
  );

  const auditPage = await call("/admin/audit", { cookie: adminCookie });
  check("管理员可打开审计日志", auditPage.status === 200, `HTTP ${auditPage.status}`);
  check("审计页包含发布记录", auditPage.text.includes("发布"), "页面未出现「发布」字样");

  // 13. Logout invalidates the session
  const logout = await call("/api/auth/logout", { method: "POST", cookie: creatorCookie });
  check("创作者登出成功", logout.status === 200, `HTTP ${logout.status}`);
  const meAfterLogout = await call("/api/auth/me", { cookie: creatorCookie });
  check("登出后会话失效（401）", meAfterLogout.status === 401, `HTTP ${meAfterLogout.status}`);

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  if (failed > 0) {
    console.log("失败项：");
    for (const item of failures) console.log(`  - ${item}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("验收脚本异常：", error);
  process.exit(1);
});
