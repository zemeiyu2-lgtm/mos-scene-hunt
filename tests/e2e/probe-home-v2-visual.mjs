/**
 * 首页 V2.0 视觉与交互验收探针（feat/homepage-v2）。
 *
 * 覆盖：
 *   1. 路由健康：首页及全部原有入口返回 200
 *   2. 双语切换：点 EN 后 Hero/入口/页脚变为英文，刷新后偏好保持
 *   3. 图片加载：首屏与区块内全部真实摄影 naturalWidth > 0
 *   4. 核心入口跳转：游戏中心 /games、创作中心 /design 实际可点击导航
 *   5. 手机 390x844 与桌面 1440x900 全页截图（中/英）
 *
 * 运行：先在 3102 端口起生产服务，再
 *   node tests/e2e/run-probe.mjs probe-home-v2-visual.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(ARTIFACTS, { recursive: true });

const results = [];
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(m) { process.stdout.write(m + "\n"); }

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

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function openFresh(browser, { width, height }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.setViewport({ width, height, isMobile: width < 800, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("a.btn-primary, button.btn-primary", { timeout: 20000 });
  await sleep(1500);
  return { context, page };
}

async function assertAllImagesLoaded(page) {
  const bad = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute("src") ?? "(no src)"),
  );
  assert(bad.length === 0, `未加载完成的图片: ${bad.join(", ")}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  /* ---------- R1 路由健康 ---------- */
  await check("R1 全部原有路由返回 200", async () => {
    const routes = ["/", "/games", "/design", "/create", "/select", "/map", "/quest",
      "/bag", "/tutorial", "/how-to-create", "/gps-test"];
    const bad = [];
    for (const route of routes) {
      const res = await fetch(`${BASE}${route}`, { redirect: "manual" });
      if (res.status !== 200) bad.push(`${route}=${res.status}`);
    }
    assert(bad.length === 0, `非 200 路由: ${bad.join(", ")}`);
  });

  /* ---------- R2 双语切换 ---------- */
  await check("R2 中英切换：EN 点击后文案切换，刷新后保持，可切回中文", async () => {
    const { context, page } = await openFresh(browser, { width: 390, height: 844 });
    try {
      let text = await bodyText(page);
      assert(text.includes("走到真实地点，解锁那里的故事"), "默认应为中文 Hero");
      assert(text.includes("游戏中心") && text.includes("创作中心"), "默认应为中文入口");

      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll(".home-lang button"))
          .find((b) => b.textContent === "EN");
        btn?.click();
      });
      await sleep(600);
      text = await bodyText(page);
      assert(text.includes("Walk to real places. Unlock their stories."), "切换 EN 后 Hero 应为英文");
      assert(text.includes("Game Centre") && text.includes("Creator Studio"), "切换 EN 后入口应为英文");
      // 区块 kicker 经 CSS text-transform: uppercase 渲染，按大小写不敏感匹配。
      assert(/featured packs/i.test(text), "切换 EN 后精选包区块应为英文");

      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(1200);
      text = await bodyText(page);
      assert(text.includes("Walk to real places. Unlock their stories."), "刷新后英文偏好应保持");

      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll(".home-lang button"))
          .find((b) => b.textContent === "中");
        btn?.click();
      });
      await sleep(400);
      text = await bodyText(page);
      assert(text.includes("走到真实地点，解锁那里的故事"), "切回中文应恢复");
    } finally { await context.close(); }
  });

  /* ---------- R3 图片加载（手机 + 桌面） ---------- */
  await check("R3 手机端全部图片加载完成", async () => {
    const { context, page } = await openFresh(browser, { width: 390, height: 844 });
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(2500);
      await assertAllImagesLoaded(page);
      const stats = await page.evaluate(() => ({
        count: document.querySelectorAll("img").length,
        hero: document.querySelector(".home-hero img")?.currentSrc ?? "",
      }));
      assert(stats.count >= 4, `图片数量异常: ${stats.count}`);
      await page.screenshot({ path: path.join(ARTIFACTS, "v2-mobile-390-full-zh.png"), fullPage: true });
    } finally { await context.close(); }
  });

  await check("R4 桌面端全部图片加载完成 + 英文全页截图", async () => {
    const { context, page } = await openFresh(browser, { width: 1440, height: 900 });
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(2500);
      await assertAllImagesLoaded(page);
      await page.screenshot({ path: path.join(ARTIFACTS, "v2-desktop-1440-full-zh.png"), fullPage: true });
      await page.evaluate(() => {
        Array.from(document.querySelectorAll(".home-lang button"))
          .find((b) => b.textContent === "EN")?.click();
      });
      await sleep(800);
      await page.screenshot({ path: path.join(ARTIFACTS, "v2-desktop-1440-full-en.png"), fullPage: true });
      await assertAllImagesLoaded(page);
    } finally { await context.close(); }
  });

  await check("R5 手机端英文截图", async () => {
    const { context, page } = await openFresh(browser, { width: 390, height: 844 });
    try {
      await page.evaluate(() => {
        Array.from(document.querySelectorAll(".home-lang button"))
          .find((b) => b.textContent === "EN")?.click();
      });
      await sleep(800);
      await page.screenshot({ path: path.join(ARTIFACTS, "v2-mobile-390-hero-en.png") });
    } finally { await context.close(); }
  });

  /* ---------- R6 核心入口真实可用 ---------- */
  await check("R6 核心入口跳转：游戏中心 / 创作中心实际导航", async () => {
    const { context, page } = await openFresh(browser, { width: 390, height: 844 });
    try {
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('a[href="/games"].home-entry'))
          .find((n) => n.offsetParent !== null);
        el?.click();
      });
      await page.waitForFunction(() => location.pathname === "/games", { timeout: 10000 });
      await sleep(1200);
      let text = await bodyText(page);
      assert(text.includes("游戏中心"), "未进入游戏中心页面");

      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("a.btn-primary, button.btn-primary", { timeout: 20000 });
      await sleep(1000);
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('a[href="/design"].home-entry'))
          .find((n) => n.offsetParent !== null);
        el?.click();
      });
      await page.waitForFunction(() => location.pathname === "/design", { timeout: 10000 });
      await sleep(1200);
      text = await bodyText(page);
      assert(text.includes("创作中心") || text.includes("选择游戏区域"), "未进入创作中心页面");

      // 精选探索包入口 → /games
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".home-pack-link", { timeout: 20000 });
      await page.evaluate(() => document.querySelector(".home-pack-link")?.click());
      await page.waitForFunction(() => location.pathname === "/games", { timeout: 10000 });
    } finally { await context.close(); }
  });

} finally {
  await browser.close();
}
const ok = results.filter((r) => r.ok).length;
log(`\n验收结果：${results.length} 项，通过 ${ok}，失败 ${results.length - ok}`);
if (errors.length) {
  log(`\n页面级错误 ${errors.length} 条：`);
  for (const e of errors.slice(0, 12)) log(`  · ${e}`);
} else {
  log("页面级错误 0 条。");
}
writeFileSync(
  path.join(ARTIFACTS, "probe-home-v2-visual-summary.json"),
  JSON.stringify({ base: BASE, results, errors }, null, 2),
);
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
