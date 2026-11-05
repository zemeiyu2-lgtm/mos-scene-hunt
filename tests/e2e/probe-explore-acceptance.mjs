/**
 * 探索中心三层发现体验 — 验收探针（feat/explore-three-layer-v1）
 *
 * 验收口径（对应本轮整合的 Phase 4）：
 *   1. 第一层 /games 重新组织：探索中心 Hero、精选探索、按兴趣发现、玩法示范、
 *      本机游戏、云端游戏、设计者入口全部存在；
 *   2. 第二层 /explore 与三个分类页：分类图块、真实公开包数量、卡片可点；
 *   3. 第三层 /explore/<id>：站点数/时长/难度/范围/集合点全部来自真实包；
 *   4. 分享：链接必须是正式域名 + /explore/<id>，二维码可展开；
 *   5. 开始探索：走既有下载→入库→/select 流程，返回路径经安全校验后回详情页；
 *   6. 未公开/不存在的包：详情页给出「还没有公开」，不泄露 id 是否存在；
 *   7. 网络失败：给出错误态与重试，而不是「没有内容」；
 *   8. 390px 与桌面布局无横向溢出；
 *   9. 全程无 pageerror / console.error。
 *
 * 运行：node tests/e2e/run-probe.mjs probe-explore-acceptance.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts", "explore");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PACK_ID = "rizal-park-discovery";
mkdirSync(ARTIFACTS, { recursive: true });

const results = [];
const consoleErrors = [];
const pageErrors = [];
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
    log(`  ✗ ${name} — ${msg}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

async function waitForText(page, text, timeout = 8000) {
  await page.waitForFunction(
    (needle) => document.body.innerText.includes(needle),
    { timeout },
    text,
  );
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth > 1;
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=zh-CN"],
});

try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${page.url()} :: ${msg.text()}`);
  });
  page.on("pageerror", (err) => pageErrors.push(`${page.url()} :: ${err.message}`));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  // ---------- 第一层：探索中心 ----------
  log("\n[1] 探索中心 /games @390px");
  await page.goto(`${BASE}/games`, { waitUntil: "networkidle2" });
  await waitForText(page, "按兴趣发现");
  await check("探索中心 Hero 与发现入口存在", async () => {
    const text = await textOf(page);
    for (const needle of ["探索中心", "世界很大，值得亲自去发现", "发现探索", "按兴趣发现"]) {
      assert(text.includes(needle), `缺少文案：${needle}`);
    }
  });
  await check("精选探索展示真实公开包", async () => {
    await waitForText(page, "精选探索");
    const text = await textOf(page);
    assert(text.includes("黎刹公园：寻找最后的宝藏"), "精选区没有真实包标题");
    assert(text.includes("目前有 1 个公开探索包"), "公开包数量不是真实值");
  });
  await check("原有本机/云端/设计者入口未被移除", async () => {
    const text = await textOf(page);
    for (const needle of ["本机游戏", "云端游戏", "设计者入口", "玩法示范"]) {
      assert(text.includes(needle), `缺少区块：${needle}`);
    }
  });
  await check("390px 无横向溢出", async () => {
    assert(!(await hasHorizontalOverflow(page)), "存在横向滚动");
  });
  await page.screenshot({ path: path.join(ARTIFACTS, "games-390.png"), fullPage: true });

  // ---------- 第二层：发现页 ----------
  log("\n[2] 发现页 /explore @390px");
  await page.click('a[href="/explore"]');
  await page.waitForFunction(() => location.pathname === "/explore", { timeout: 8000 });
  await waitForText(page, "全部公开探索");
  await check("三个分类图块与真实计数", async () => {
    const text = await textOf(page);
    for (const needle of ["文化与历史", "自然与户外", "地点与活动", "1 个探索包", "暂无公开内容"]) {
      assert(text.includes(needle), `缺少：${needle}`);
    }
  });
  await check("发现页列出公开探索包", async () => {
    const text = await textOf(page);
    assert(text.includes("黎刹公园：寻找最后的宝藏"), "没有列出公开包");
    assert(text.includes("5 个站点"), "卡片未显示真实站点数");
  });
  await check("发现页 390px 无横向溢出", async () => {
    assert(!(await hasHorizontalOverflow(page)), "存在横向滚动");
  });
  await page.screenshot({ path: path.join(ARTIFACTS, "explore-390.png"), fullPage: true });

  // ---------- 分类页 ----------
  log("\n[3] 分类页 /explore/category/culture-history");
  await page.click('a[href="/explore/category/culture-history"]');
  await page.waitForFunction(
    () => location.pathname === "/explore/category/culture-history",
    { timeout: 8000 },
  );
  await waitForText(page, "文化与历史");
  await check("分类页显示该分类下的真实包", async () => {
    const text = await textOf(page);
    assert(text.includes("黎刹公园：寻找最后的宝藏"), "分类页没有该包");
    assert(text.includes("属于这个分类"), "缺少分类范围说明");
  });
  await page.screenshot({ path: path.join(ARTIFACTS, "category-390.png"), fullPage: true });

  // ---------- 第三层：详情页 ----------
  log("\n[4] 详情页 /explore/<id>");
  await page.click(`a[href="/explore/${PACK_ID}"]`);
  await page.waitForFunction((id) => location.pathname === `/explore/${id}`, { timeout: 8000 }, PACK_ID);
  await waitForText(page, "为什么值得走这一趟");
  await check("事实字段全部来自真实包", async () => {
    const text = await textOf(page);
    for (const needle of ["5 个站点", "约 25 分钟", "轻松", "约 350 m 范围", "黎刹公园集合点"]) {
      assert(text.includes(needle), `缺少真实字段：${needle}`);
    }
  });
  await check("玩法预览按真实构成展示", async () => {
    const text = await textOf(page);
    assert(text.includes("3 个选择题"), "选择题数量不对");
    assert(text.includes("关键词 ×3"), "关键词奖励数量不对");
    assert(text.includes("徽章 ×1"), "徽章数量不对");
  });
  await check("不含评分/参与人数一类编造指标", async () => {
    const text = await textOf(page);
    for (const needle of ["评分", "参与人数", "人气", "好评"]) {
      assert(!text.includes(needle), `出现了编造指标：${needle}`);
    }
  });
  await check("详情页 390px 无横向溢出", async () => {
    assert(!(await hasHorizontalOverflow(page)), "存在横向滚动");
  });
  await page.screenshot({ path: path.join(ARTIFACTS, "detail-390.png"), fullPage: true });

  // ---------- 分享 ----------
  log("\n[5] 分享链接与二维码");
  await check("分享链接是正式域名 + 规范详情路径", async () => {
    const text = await textOf(page);
    assert(text.includes(`${BASE}/explore/${PACK_ID}`), "分享链接不是规范路径");
  });
  await check("二维码可以展开", async () => {
    const buttons = await page.$$("button");
    let clicked = false;
    for (const button of buttons) {
      const label = await page.evaluate((el) => el.textContent ?? "", button);
      if (label.includes("二维码")) {
        await button.click();
        clicked = true;
        break;
      }
    }
    assert(clicked, "找不到二维码按钮");
    await page.waitForSelector("canvas", { timeout: 5000 });
    const size = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas ? canvas.getBoundingClientRect().width : 0;
    });
    assert(size > 100, `二维码尺寸异常：${size}`);
  });
  await page.screenshot({ path: path.join(ARTIFACTS, "detail-share-390.png"), fullPage: false });

  // ---------- 开始探索 → 复用既有流程 ----------
  log("\n[6] 开始探索走既有下载→/select 流程");
  await check("点击开始探索后进入 /select 并带上安全返回目标", async () => {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((el) =>
        (el.textContent ?? "").includes("开始探索"),
      );
      button?.click();
    });
    await page.waitForFunction(() => location.pathname === "/select", { timeout: 20000 });
    const url = new URL(page.url());
    assert(url.searchParams.get("game") === PACK_ID, `game 参数不对：${url.search}`);
    assert(
      url.searchParams.get("from") === `/explore/${PACK_ID}`,
      `from 参数不是规范详情路径：${url.searchParams.get("from")}`,
    );
  });
  await check("/select 正确载入该探索包", async () => {
    await waitForText(page, "黎刹公园：寻找最后的宝藏", 15000);
  });
  await check("返回按钮回到探索包详情页", async () => {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((el) =>
        (el.textContent ?? "").trim() === "返回",
      );
      button?.click();
    });
    await page.waitForFunction((id) => location.pathname === `/explore/${id}`, { timeout: 8000 }, PACK_ID);
  });

  // ---------- 未公开发布拒绝 ----------
  log("\n[7] 未公开/不存在的探索包");
  await check("直接访问不存在的探索包给出「还没有公开」", async () => {
    await page.goto(`${BASE}/explore/not-a-real-pack`, { waitUntil: "networkidle2" });
    await waitForText(page, "这个探索包还没有公开");
    const text = await textOf(page);
    assert(text.includes("浏览全部探索"), "缺少返回全部探索的出口");
  });

  // ---------- 网络失败态 ----------
  log("\n[8] 网络失败态");
  const offlinePage = await context.newPage();
  offlinePage.on("pageerror", (err) => pageErrors.push(`offline :: ${err.message}`));
  await check("探索接口失败时给出错误与重试，而不是「没有内容」", async () => {
    // 只掐断 /api/explore，页面本身仍能加载 —— 这正是「接口挂了」的真实形态；
    // 整页 offline 会让导航直接失败，验不到错误态。
    // 必须绕过 Service Worker：被 SW 接管的页面，请求由 SW 发出，页面级拦截看不到。
    await offlinePage.setBypassServiceWorker(true);
    await offlinePage.setRequestInterception(true);
    offlinePage.on("request", (request) => {
      if (request.url().includes("/api/explore")) void request.abort();
      else void request.continue();
    });
    await offlinePage.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await offlinePage.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
    await waitForText(offlinePage, "暂时无法读取探索内容", 15000);
    const text = await offlinePage.evaluate(() => document.body.innerText);
    assert(text.includes("重试"), "没有重试入口");
    assert(!text.includes("目前还没有公开探索包"), "把网络失败说成了空目录");
    await offlinePage.screenshot({ path: path.join(ARTIFACTS, "explore-error-390.png"), fullPage: false });
  });

  // ---------- 桌面布局 ----------
  log("\n[9] 桌面 1280px");
  const desktop = await context.newPage();
  desktop.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${desktop.url()} :: ${msg.text()}`);
  });
  desktop.on("pageerror", (err) => pageErrors.push(`${desktop.url()} :: ${err.message}`));
  await desktop.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  for (const [name, url] of [
    ["games", `${BASE}/games`],
    ["explore", `${BASE}/explore`],
    ["detail", `${BASE}/explore/${PACK_ID}`],
    ["category", `${BASE}/explore/category/culture-history`],
  ]) {
    await desktop.goto(url, { waitUntil: "networkidle2" });
    await sleep(600);
    await check(`桌面无横向溢出：${name}`, async () => {
      assert(!(await hasHorizontalOverflow(desktop)), `${name} 存在横向滚动`);
    });
    await desktop.screenshot({ path: path.join(ARTIFACTS, `${name}-1280.png`), fullPage: true });
  }

  // ---------- 错误收集 ----------
  log("\n[10] 运行时错误");
  await check("无 console.error（404 探针请求除外）", async () => {
    // 浏览器会把「探测不存在 id」的 404 记成 Failed to load resource，
    // 这是预期行为，不是页面错误；其余 console.error 一律算失败。
    const unexpected = consoleErrors.filter(
      (entry) => !(entry.includes("not-a-real-pack") && entry.includes("404")),
    );
    assert(unexpected.length === 0, `console.error: ${unexpected.slice(0, 3).join(" | ")}`);
  });
  await check("无 pageerror", async () => {
    assert(pageErrors.length === 0, `pageerror: ${pageErrors.slice(0, 3).join(" | ")}`);
  });
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
log(`\n结果：${passed}/${results.length} 通过`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  log("失败项：");
  for (const item of failed) log(`  - ${item.name}: ${item.error}`);
  process.exit(1);
}
