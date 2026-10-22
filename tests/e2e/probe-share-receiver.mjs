/**
 * 分享接收方最小探针（第二轮首页小改验收专用）。
 *
 * 只验证「有效的非默认分享游戏 + 接收方零本地进度」这一条链路：
 *   R1 链接打开后加载的是分享的游戏，且不出现默认演示游戏的内容/地图
 *   R2 断网（拦截 /content/）时仍从链接哈希还原分享游戏，不静默回退演示游戏
 *   R3 点「开始寻宝」进入 /map 并看到分享游戏的场景
 *   R4 离开分享 URL 后首页的行为（记录用途：分享包只存在 URL 哈希里，属既有架构）
 *
 * 载荷由 content/igsl-eight-transformations.json 按应用自身的 gzip + base64url
 * 格式生成，不修改协议、不写入作者存档。
 *
 * 运行：node tests/e2e/run-probe.mjs probe-share-receiver.mjs
 */

import puppeteer from "puppeteer-core";
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(ARTIFACTS, { recursive: true });

const PACK = JSON.parse(readFileSync(path.join(process.cwd(), "content", "igsl-eight-transformations.json"), "utf8"));
const HASH = "g." + gzipSync(Buffer.from(JSON.stringify(PACK), "utf8")).toString("base64url");
const SHARE_URL = `${BASE}/select#hunt=${HASH}`;
const DEMO_TITLE = "Luneta · 看见这座城市";

const results = [];
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(m + "\n");

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    log(`  ✓ ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, error: msg });
    log(`  ✗ ${name}\n      ${msg}`);
  }
}
function assert(c, m) { if (!c) throw new Error(m); }

async function freshPage(browser) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().includes("net::ERR_FAILED")) return; // R2 故意的断网
    errors.push(`console: ${m.text()}`);
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  return { context, page };
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const record = {};

try {
  /* ---------- R1：分享链接加载的是分享游戏 ---------- */
  await check("R1 接收方零进度打开链接：加载分享游戏，不出现默认演示游戏", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.goto(SHARE_URL, { waitUntil: "networkidle2" });
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 20000 },
        PACK.title,
      );
      const text = await bodyText(page);
      assert(!text.includes(DEMO_TITLE), "接收方看到了默认演示游戏的标题");
      assert(!text.includes("开始探索"), "接收方首页主操作混入了默认游戏入口");
      assert(!(await page.evaluate(() => Boolean(document.querySelector(".leaflet-container")))), "分享游戏入口页不应渲染演示地图");
      const authored = await page.evaluate(() =>
        Object.keys(window.localStorage).filter((k) => k.startsWith("mos-scene-hunt:authoring:")).length);
      assert(authored === 0, `接收方被写入了 ${authored} 条作者存档`);
      record.receiverTitle = PACK.title;
      await page.screenshot({ path: path.join(ARTIFACTS, "share-receiver-select.png") });

      /* ---------- R3：开始寻宝后进入 /map 并看到分享场景 ---------- */
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find((n) =>
          (n.textContent ?? "").includes("开始寻宝"));
        if (!b) throw new Error("找不到「开始寻宝」按钮");
        b.click();
      });
      await page.waitForFunction(() => location.pathname === "/map", { timeout: 15000 });
      await sleep(1500);
      const mapText = await bodyText(page);
      assert(mapText.includes("转化一"), "地图页没有分享游戏的场景");
      assert(!mapText.includes(DEMO_TITLE), "地图页混入了默认演示游戏内容");
      await page.screenshot({ path: path.join(ARTIFACTS, "share-receiver-map.png") });
      record.mapEntered = true;
    } finally { await context.close(); }
  });

  /* ---------- R2：断网时仍从哈希还原，不静默回退演示游戏 ---------- */
  await check("R2 内容请求全部失败时：仍从链接还原分享游戏，不静默回退演示游戏", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (req.url().includes("/content/")) req.abort().catch(() => {});
        else req.continue().catch(() => {});
      });
      await page.goto(SHARE_URL, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: 20000 },
        PACK.title,
      );
      const text = await bodyText(page);
      assert(!text.includes(DEMO_TITLE), "断网时静默回退到了默认演示游戏");
      assert(!text.includes("分享链接未能打开"), "有效链接被误判为损坏");
      await page.screenshot({ path: path.join(ARTIFACTS, "share-receiver-offline-select.png") });
    } finally { await context.close(); }
  });

  /* ---------- R4：离开分享 URL 后首页的行为记录 ---------- */
  await check("R4 离开分享 URL 后：首页不崩溃，主操作仍指向选关页（记录既有架构行为）", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
      await page.waitForSelector("a.btn-primary, button.btn-primary", { timeout: 20000 });
      await sleep(800);
      const s = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll("a.btn-primary")).find((n) => n.offsetParent !== null);
        return {
          title: document.body.innerText.includes("Luneta · 看见这座城市"),
          href: a ? a.getAttribute("href") : null,
          crash: document.body.innerText.includes("Application error"),
        };
      });
      record.homeAfterShare = s;
      assert(!s.crash, "离开分享 URL 后首页崩溃");
      assert(s.href === "/select", `首页主操作应指向 /select，实际 ${s.href}`);
      await page.screenshot({ path: path.join(ARTIFACTS, "share-receiver-home-after.png") });
    } finally { await context.close(); }
  });
} finally {
  await browser.close();
}

const ok = results.filter((r) => r.ok).length;
log(`\n验收结果：${results.length} 项，通过 ${ok}，失败 ${results.length - ok}`);
if (errors.length) {
  log(`\n页面级错误 ${errors.length} 条：`);
  for (const e of errors.slice(0, 8)) log(`  · ${e}`);
} else {
  log("页面级错误 0 条。");
}
writeFileSync(
  path.join(ARTIFACTS, "probe-share-receiver-summary.json"),
  JSON.stringify({ base: BASE, shareUrlLength: SHARE_URL.length, record, results, errors }, null, 2),
);
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
