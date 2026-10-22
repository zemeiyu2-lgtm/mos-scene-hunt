/**
 * 批次 A 验收探针：首页精简（ui/first-batch-polish）
 *
 * 覆盖：
 *   1. 首页正常打开、地图演示渲染
 *   2. 四种状态：无进度 / 有进度 / 已完成 / 加载失败（每个状态用独立
 *      incognito context，保证 SW / 存储 / 拦截互不污染）
 *   3. 主按钮文案与链接行为（开始探索→/select、继续→/map、完成→/bag）
 *   4. 次级入口存在且降权
 *   5. 状态不重复展示
 *   6. 无 pageerror / console.error
 *
 * 运行：node tests/e2e/run-probe.mjs probe-home-polish.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(ARTIFACTS, { recursive: true });

const GAME_ID = "demo-hunt";
const GAME_VERSION = "0.3.0";
const SCENES = ["scene-a", "scene-b", "scene-c", "scene-d", "scene-e"];
const SAVE_KEY = `mos-scene-hunt:save:${GAME_ID}`;

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

/** 点击可见的主按钮（首页唯一主操作）。 */
async function clickPrimary(page) {
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("a.btn-primary, button.btn-primary"))
      .find((n) => n.offsetParent !== null);
    if (!el) throw new Error("找不到主按钮");
    el.click();
  });
}

/** 独立 incognito context：每次都是干净的 SW / localStorage / IDB。 */
async function freshPage(browser, { expectAbortedFetch = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // S4 故意 abort 内容请求，浏览器必然打出一条 ERR_FAILED —— 预期副作用。
    if (expectAbortedFetch && m.text().includes("net::ERR_FAILED")) return;
    errors.push(`console: ${m.text()}`);
  });
  return { context, page };
}

function saveScript(statePatch) {
  const patch = JSON.stringify(statePatch ?? {});
  return `
    localStorage.clear();
    const scenes = {};
    for (const id of ${JSON.stringify(SCENES)}) {
      scenes[id] = { sceneId: id, status: "locked", attempts: 0, grantedRewardIds: [] };
    }
    const patch = ${patch};
    for (const [id, p] of Object.entries(patch.scenes ?? {})) {
      scenes[id] = { ...scenes[id], ...p };
    }
    const now = Date.now();
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify({
      schemaVersion: 1, savedAt: now, gameId: ${JSON.stringify(GAME_ID)}, gameVersion: ${JSON.stringify(GAME_VERSION)},
      state: {
        gameId: ${JSON.stringify(GAME_ID)}, gameVersion: ${JSON.stringify(GAME_VERSION)},
        currentSceneId: patch.currentSceneId ?? null,
        scenes,
        inventory: patch.inventory ?? [],
        keywords: [],
        startedAt: now, lastUpdatedAt: now,
      },
    }));
  `;
}

async function openHome(page, { interceptContent = false } = {}) {
  if (interceptContent) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes(`/content/${GAME_ID}`)) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
  }
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // 首页是否渲染演示地图随状态而变（无游戏才展示），主按钮才是稳定锚点。
  await page.waitForSelector("a.btn-primary, button.btn-primary", { timeout: 20000 });
  await sleep(1400);
}

async function homeState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const primary = Array.from(document.querySelectorAll("a.btn-primary, button.btn-primary")).find(
      (el) => el.offsetParent !== null,
    );
    const map = document.querySelector(".leaflet-container");
    return {
      text,
      primaryLabel: primary ? primary.textContent.trim().replace(/\s+/g, " ") : null,
      primaryHref: primary && primary.tagName === "A" ? primary.getAttribute("href") : null,
      mapRendered: Boolean(map && map._leaflet_id),
      percentHits: (text.match(/\d+% 已探索/g) ?? []).length,
      titleHits: (text.match(/MOS Scene Hunt/g) ?? []).length,
      hasExploreChip: text.includes("Explore · Discover · Play"),
    };
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=414,896"],
  defaultViewport: { width: 414, height: 896 },
});

try {
  /* ---------- 状态 1：无进度 ---------- */
  await check("S1 无进度：打开首页，地图渲染，主按钮「开始探索」→/select", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await openHome(page);
      await page.waitForSelector(".leaflet-container", { timeout: 20000 });
      const s = await homeState(page);
      assert(s.mapRendered, "地图未完成 Leaflet 初始化");
      assert(s.primaryLabel?.includes("开始探索"), `主按钮应为「开始探索」，实际「${s.primaryLabel}」`);
      assert(s.primaryHref === "/select", `主按钮应指向 /select，实际 ${s.primaryHref}`);
      assert(s.text.includes("请在安全、开放的户外区域游玩"), "缺少户外安全提示");
      assert(!s.hasExploreChip, "装饰性英文标签应已移除");
      assert(s.titleHits <= 2, `标题出现 ${s.titleHits} 次，疑似重复`);
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s1-no-progress.png") });
    } finally { await context.close(); }
  });

  await check("S1b 次级入口存在且为降权样式（非渐变卡片）", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await openHome(page);
      const s = await homeState(page);
      for (const t of ["游戏中心", "创作中心", "创作说明"]) assert(s.text.includes(t), `缺少入口「${t}」`);
      const weighted = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('a[href="/games"]')).find((n) => n.offsetParent !== null);
        if (!el) return null;
        return { hasGradient: /from-(sky|violet)-50/.test(el.className), isSmallCard: el.className.includes("text-[13px]") };
      });
      assert(weighted, "找不到游戏中心入口");
      assert(weighted.isSmallCard && !weighted.hasGradient, "次级入口未降权");
    } finally { await context.close(); }
  });

  await check("S1c 窄屏 414px 无横向溢出", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await openHome(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `横向溢出 ${overflow}px`);
    } finally { await context.close(); }
  });

  await check("S8 恢复期间不闪现地图：加载中无 Leaflet，恢复后新玩家才出现演示地图", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (req.url().includes(`/content/${GAME_ID}`)) setTimeout(() => req.continue().catch(() => {}), 1600);
        else req.continue().catch(() => {});
      });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await sleep(700);
      const during = await page.evaluate(() => {
        const primary = Array.from(document.querySelectorAll("a.btn-primary, button.btn-primary"))
          .find((n) => n.offsetParent !== null);
        return {
          hasMap: Boolean(document.querySelector(".leaflet-container")),
          primary: primary ? primary.textContent.replace(/\s+/g, "") : "",
        };
      });
      assert(!during.hasMap, "内容尚在恢复时已渲染地图，存在错误地图闪现的风险");
      assert(during.primary.includes("正在恢复游戏"), `恢复期主按钮应为「正在恢复游戏…」，实际「${during.primary}」`);
      await page.waitForSelector(".leaflet-container", { timeout: 20000 });
      const after = await homeState(page);
      assert(after.mapRendered, "恢复完成后新玩家应能看到演示地图");
      assert(after.primaryLabel?.includes("开始探索"), `恢复完成后主按钮应为「开始探索」，实际「${after.primaryLabel}」`);
    } finally { await context.close(); }
  });

  /* ---------- 状态 2：有进度 ---------- */
  await check("S2 有进度：主按钮「继续探索」→/map，进度只展示一次，背包入口保留", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(saveScript({
        currentSceneId: "scene-b",
        scenes: { "scene-a": { status: "completed" } },
      }));
      await openHome(page);
      const s = await homeState(page);
      assert(s.primaryLabel?.includes("继续探索"), `主按钮应为「继续探索」，实际「${s.primaryLabel}」`);
      assert(s.primaryHref === "/map", `主按钮应指向 /map，实际 ${s.primaryHref}`);
      assert(s.percentHits === 1, `「N% 已探索」应只出现 1 次，实际 ${s.percentHits} 次`);
      assert(s.text.includes("背包与线索"), "有进度时应保留背包入口");
      assert(!s.mapRendered, "有进度的玩家不应再看到固定的黎刹公园演示地图");
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s2-progress.png") });
    } finally { await context.close(); }
  });

  /* ---------- 状态 3：已完成 ---------- */
  await check("S3 已完成：主按钮「查看探索成果」→/bag，状态显示「已完成」", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(saveScript({
        currentSceneId: null,
        scenes: Object.fromEntries(SCENES.map((id) => [id, { status: "completed" }])),
      }));
      await openHome(page);
      const s = await homeState(page);
      assert(s.primaryLabel?.includes("查看探索成果"), `主按钮应为「查看探索成果」，实际「${s.primaryLabel}」`);
      assert(s.primaryHref === "/bag", `主按钮应指向 /bag，实际 ${s.primaryHref}`);
      assert(s.text.includes("已完成"), "应显示已完成状态");
      assert(!s.text.includes("背包与线索"), "完成态不应再重复「背包与线索」入口（主按钮已指向 /bag）");
      assert(!s.mapRendered, "完成态不应显示固定的黎刹公园演示地图");
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s3-complete.png") });
    } finally { await context.close(); }
  });

  /* ---------- 状态 4：加载失败（全新 context，SW 尚未接管，内容请求被拦截） ---------- */
  await check("S4 加载失败：显示失败提示，主按钮变为「重新加载游戏」，点击不崩溃", async () => {
    const { context, page } = await freshPage(browser, { expectAbortedFetch: true });
    try {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (req.url().includes(`/content/${GAME_ID}`)) req.abort().catch(() => {});
        else req.continue().catch(() => {});
      });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      const s = await homeState(page);
      assert(s.text.includes("游戏内容加载失败"), "应显示加载失败提示");
      assert(s.primaryLabel === "重新加载游戏", `主按钮应为「重新加载游戏」，实际「${s.primaryLabel}」`);
      assert(!s.mapRendered, "加载失败时不应再显示与当前游戏无关的演示地图");
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("重新加载游戏"));
        btn?.click();
      });
      await sleep(800);
      const s2 = await homeState(page);
      assert(!s2.text.includes("Application error"), "重试后不应崩溃");
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s4-loaderror.png") });
    } finally { await context.close(); }
  });

  /* ---------- 状态 5：正在答题（challenging） ---------- */
  await check("S6 答题中：主按钮「继续当前任务」→/challenge/scene-b，点击进入对应任务页", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(saveScript({
        currentSceneId: "scene-b",
        scenes: {
          "scene-a": { status: "completed" },
          "scene-b": { status: "challenging", attempts: 1 },
        },
      }));
      await openHome(page);
      const s = await homeState(page);
      assert(s.primaryLabel?.includes("继续当前任务"), `主按钮应为「继续当前任务」，实际「${s.primaryLabel}」`);
      assert(s.primaryHref === "/challenge/scene-b", `主按钮应指向 /challenge/scene-b，实际 ${s.primaryHref}`);
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s6-challenging.png") });
      await clickPrimary(page);
      await page.waitForFunction(() => location.pathname.startsWith("/challenge/"), { timeout: 10000 });
      assert(page.url().includes("/challenge/scene-b"), `应导航到 /challenge/scene-b，实际 ${page.url()}`);
      const body = await bodyText(page);
      assert(!body.includes("找不到这个任务"), "任务页未渲染出真实场景内容");
      assert(body.includes("第二站"), "任务页缺少对应场景标题");
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s6-challenge-page.png") });
    } finally { await context.close(); }
  });

  /* ---------- 状态 6：已到达情境（arrived） ---------- */
  await check("S7 已到达：进入触发圈后主按钮「继续当前情境」→/scene/scene-b，点击进入情境页", async () => {
    const { context, page } = await freshPage(browser);
    try {
      // 「已到达」不能由存档构造：reconcileState 会把存档中的 arrived 降级为
      // locked（lib/game/state.ts:288），到达必须来自一次真实定位。这里用
      // 浏览器地理定位把位置放进 scene-b 的触发圈，由应用自身的 FIX_UPDATE
      // 把场景从 available 翻成 arrived —— 走的是生产代码的完整定位管道。
      await context.overridePermissions(BASE, ["geolocation"]);
      await page.setGeolocation({ latitude: 14.58315, longitude: 120.97757, accuracy: 10 });
      await page.evaluateOnNewDocument(saveScript({
        currentSceneId: "scene-a",
        scenes: { "scene-a": { status: "completed" } },
      }));
      await openHome(page);
      await page.waitForFunction(() => document.body.innerText.includes("继续当前情境"), { timeout: 20000 });
      const s = await homeState(page);
      assert(s.primaryHref === "/scene/scene-b", `主按钮应指向 /scene/scene-b，实际 ${s.primaryHref}`);
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s7-arrived.png") });
      await clickPrimary(page);
      await page.waitForFunction(() => location.pathname.startsWith("/scene/"), { timeout: 10000 });
      assert(page.url().includes("/scene/scene-b"), `应导航到 /scene/scene-b，实际 ${page.url()}`);
      const body = await bodyText(page);
      assert(!body.includes("找不到这个场景"), "情境页未渲染出真实场景内容");
      assert(body.includes("第二站"), "情境页缺少对应场景标题");
      await page.screenshot({ path: path.join(ARTIFACTS, "home-s7-scene-page.png") });
    } finally { await context.close(); }
  });

  /* ---------- 主按钮行为 ---------- */
  await check("S5 主按钮点击实际导航到 /select（无进度态）", async () => {
    const { context, page } = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".leaflet-container", { timeout: 20000 });
      await sleep(1200);
      await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll("a.btn-primary")).find((el) => el.offsetParent !== null);
        a.click();
      });
      await sleep(1200);
      assert(page.url().includes("/select"), `应导航到 /select，实际 ${page.url()}`);
    } finally { await context.close(); }
  });
  /* ---------- 窄屏矩阵：320 / 390 / 414 ---------- */
  await check("S9 320/390/414：无横向溢出，主 CTA 在首屏内", async () => {
    const sizes = [
      { w: 320, h: 568 },
      { w: 390, h: 844 },
      { w: 414, h: 896 },
    ];
    const report = [];
    for (const { w, h } of sizes) {
      for (const withProgress of [false, true]) {
        const { context, page } = await freshPage(browser);
        try {
          await page.setViewport({ width: w, height: h, isMobile: true, deviceScaleFactor: 2 });
          await page.evaluateOnNewDocument(
            withProgress
              ? saveScript({ currentSceneId: "scene-b", scenes: { "scene-a": { status: "completed" } } })
              : "localStorage.clear();",
          );
          await openHome(page);
          const m = await page.evaluate(() => {
            const cta = Array.from(document.querySelectorAll("a.btn-primary, button.btn-primary"))
              .find((n) => n.offsetParent !== null);
            const r = cta ? cta.getBoundingClientRect() : null;
            return {
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              top: r ? Math.round(r.top) : null,
              bottom: r ? Math.round(r.bottom) : null,
              width: r ? Math.round(r.width) : null,
              vw: window.innerWidth,
              vh: window.innerHeight,
            };
          });
          report.push({ size: `${w}x${h}`, state: withProgress ? "progress" : "fresh", ...m });
          assert(m.overflow <= 0, `${w}px/${withProgress ? "有进度" : "首次"} 横向溢出 ${m.overflow}px`);
          assert(m.bottom !== null && m.bottom <= m.vh, `${w}px/${withProgress ? "有进度" : "首次"} 主 CTA 超出首屏（bottom=${m.bottom}, vh=${m.vh}）`);
          assert(m.width !== null && m.width <= m.vw, `${w}px 主 CTA 宽度超出视口`);
          assert(m.top !== null && m.top >= 0, `${w}px 主 CTA 顶部为负（${m.top}）`);
          await page.screenshot({ path: path.join(ARTIFACTS, `home-s9-${w}-${withProgress ? "progress" : "fresh"}.png`) });
        } finally { await context.close(); }
      }
    }
    writeFileSync(path.join(ARTIFACTS, "home-layout-matrix.json"), JSON.stringify(report, null, 2));
    log(`      布局矩阵：${report.map((r) => `${r.size}/${r.state} cta=${r.top}-${r.bottom}`).join(" · ")}`);
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
  path.join(ARTIFACTS, "probe-home-polish-summary.json"),
  JSON.stringify({ base: BASE, results, errors }, null, 2),
);
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
