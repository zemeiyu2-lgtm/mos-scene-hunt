/**
 * V1.0 验收复核：多端适配浏览器模拟测试（模块 E 证据）。
 *
 * 视口：390×844（手机竖屏）、1024×768（平板横屏）、1600×900（大屏 16:9）。
 * 页面：/select、/map、/map?demo=1（演示条）、/scene/g1（故事+挑战）。
 * 全屏按钮（kiosk-only）只在 ≥1024px 显示。
 * 真实 GPS 不可用的浏览器模拟中，地图页会显示「定位不可用」之类的状态——
 * 这属于模拟环境限制，记录为待现场验收。
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(process.cwd(), "tests", "e2e", "artifacts", "responsive");
mkdirSync(OUT, { recursive: true });

const SEED_ID = "probe-demo-iso";
const AUTHORING_KEY = `mos-scene-hunt:authoring:${SEED_ID}`;
const CURRENT_KEY = "mos-scene-hunt:current-authored-game";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED_GAME = {
  id: SEED_ID,
  language: "zh-CN",
  title: "复核·多端模拟",
  description: "多端适配复核",
  version: "0.1.0",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
  entrySceneId: "g1",
  scenes: [
    { id: "g1", title: "复核站点一", story: "这是一段用于检查故事排版在各类屏幕上的可读性的示例文本，长度刻意略长，覆盖多行折行与字号表现。", location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "站点一" }, nextSceneId: "g2",
      challenge: { type: "choice", question: "多端复核问题一？", options: ["甲选项", "乙选项"], answer: 1 }, reward: { type: "keyword", title: "线索", value: "线索甲" } },
    { id: "g2", title: "复核站点二", story: "第二站故事文本。", location: { lat: 14.5845, lng: 120.9802, radius: 20, name: "站点二" }, nextSceneId: null,
      challenge: { type: "choice", question: "多端复核问题二？", options: ["甲选项", "乙选项"], answer: 0 }, reward: { type: "keyword", title: "线索", value: "线索乙" } },
  ],
};

const VIEWPORTS = [
  { name: "phone-portrait", width: 390, height: 844 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "large-screen", width: 1600, height: 900 },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  userDataDir: mkdtempSync(path.join(tmpdir(), "mos-responsive-")),
});

const evidence = [];
try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/select`, { waitUntil: "domcontentloaded" });
  await page.evaluate((authoringKey, currentKey, gameJson) => {
    window.localStorage.setItem(authoringKey, gameJson);
    window.localStorage.setItem(currentKey, JSON.parse(gameJson).id);
  }, AUTHORING_KEY, CURRENT_KEY, JSON.stringify(SEED_GAME));

  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    const shots = [];

    // 1. 游戏中心 /select
    await page.goto(`${BASE}/select?game=${SEED_ID}`, { waitUntil: "domcontentloaded" });
    await sleep(900);
    let f = path.join(OUT, `${vp.name}-select.png`);
    await page.screenshot({ path: f });
    shots.push(f);

    // 2. 故事+挑战页 /scene/g1
    await page.goto(`${BASE}/scene/g1?game=${SEED_ID}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(900);
    f = path.join(OUT, `${vp.name}-scene.png`);
    await page.screenshot({ path: f });
    shots.push(f);
    const sceneText = await page.evaluate(() => (document.body?.innerText ?? "").slice(0, 400));

    // 3. 地图页（演示条关闭）
    await page.goto(`${BASE}/map?game=${SEED_ID}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(1400);
    f = path.join(OUT, `${vp.name}-map.png`);
    await page.screenshot({ path: f });
    shots.push(f);

    // 4. 地图页 + 自动演示（演示条应可见且不遮挡核心内容）
    await page.evaluate(() => window.sessionStorage.setItem("mos.demo.autopilot", "1"));
    await page.goto(`${BASE}/map?game=${SEED_ID}&demo=1`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(1400);
    f = path.join(OUT, `${vp.name}-map-demo.png`);
    await page.screenshot({ path: f });
    shots.push(f);
    const demoInfo = await page.evaluate(() => {
      const bar = document.querySelector("[data-demo-bar], .demo-bar, body[data-demo-autopilot='1'] ");
      const bodyText = document.body?.innerText ?? "";
      return {
        demoFlag: window.sessionStorage.getItem("mos.demo.autopilot"),
        barText: (bar?.textContent ?? bodyText).replace(/\n+/g, " | ").slice(0, 200),
      };
    });
    await page.evaluate(() => window.sessionStorage.removeItem("mos.demo.autopilot"));

    // 5. 全屏按钮可见性
    const kiosk = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("全屏"));
      if (!el) return { present: false };
      const style = window.getComputedStyle(el);
      return { present: true, display: style.display };
    });

    evidence.push({
      viewport: vp.name,
      size: `${vp.width}x${vp.height}`,
      sceneTextHead: sceneText.replace(/\n+/g, " | ").slice(0, 160),
      demo: demoInfo,
      fullscreenButton: kiosk,
      screenshots: shots.map((p) => path.relative(process.cwd(), p)),
    });
  }
} finally {
  await browser.close().catch(() => {});
}

writeFileSync(path.join(OUT, "responsive-evidence.json"), JSON.stringify(evidence, null, 2));
for (const e of evidence) {
  process.stdout.write(`\n== ${e.viewport} (${e.size}) ==\n`);
  process.stdout.write(`scene: ${e.sceneTextHead}\n`);
  process.stdout.write(`demo: flag=${e.demo.demoFlag} bar="${e.demo.barText}"\n`);
  process.stdout.write(`fullscreen: ${JSON.stringify(e.fullscreenButton)}\n`);
}
process.exit(0);
