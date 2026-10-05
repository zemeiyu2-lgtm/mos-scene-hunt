/**
 * 试玩链路探针：验证「保存自定义游戏 → 立即试玩」加载的是自制游戏。
 *
 * 这是对真实缺陷的复现测试：design 保存的包写进了
 * `mos-scene-hunt:authoring:<id>`，但根 provider 曾经把 gameId 写死成
 * demo-hunt，于是 /select 永远显示官方示范内容。
 *
 * 用法：node tests/e2e/run-probe.mjs probe-authored-play.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const AUTHORING_KEY = "mos-scene-hunt:authoring:current-campus";
const CURRENT_KEY = "mos-scene-hunt:current-authored-game";
const DEMO_TITLE = "Luneta · 看见这座城市";
const AUTHORED_TITLE = "从课堂到禾场";

mkdirSync(ARTIFACTS, { recursive: true });

const results = [];
const errors = [];

function log(m) {
  process.stdout.write(m + "\n");
}

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

function assert(c, m) {
  if (!c) throw new Error(m);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeout = 10_000, interval = 150, message = "条件未满足" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error(`${message}（等待 ${timeout}ms 超时）`);
}

/** 用户点名的场景：8 个校园地点的自定义游戏。 */
const SCENES = [
  { id: "chapel", title: "礼拜堂", lat: 14.584481, lng: 120.9794, radius: 15 },
  { id: "library", title: "图书馆", lat: 14.5846, lng: 120.9798, radius: 20 },
  { id: "classroom", title: "教室", lat: 14.58475, lng: 120.9801, radius: 15 },
  { id: "student-center", title: "学生中心", lat: 14.5849, lng: 120.9805, radius: 25 },
  { id: "cafeteria", title: "餐厅", lat: 14.58505, lng: 120.9809, radius: 30 },
  { id: "dormitory", title: "宿舍", lat: 14.5852, lng: 120.9813, radius: 20 },
  { id: "campus-outdoor", title: "校园户外", lat: 14.58535, lng: 120.9817, radius: 40 },
  { id: "chapel-gate", title: "礼拜堂/集合点", lat: 14.5855, lng: 120.9821, radius: 15 },
];

function buildAuthoredGame() {
  return {
    id: "current-campus",
    version: "1.0.0",
    title: AUTHORED_TITLE,
    description: "八个校园地点的自定义寻宝。",
    language: "zh-CN",
    estimatedMinutes: 45,
    startLocation: { lat: SCENES[0].lat, lng: SCENES[0].lng, name: "礼拜堂" },
    entrySceneId: "chapel",
    huntArea: {
      center: { lat: 14.585, lng: 120.9808 },
      radiusMeters: 180,
      shape: "polygon",
      points: [
        { lat: 14.5862, lng: 120.9786 },
        { lat: 14.5862, lng: 120.983 },
        { lat: 14.5838, lng: 120.983 },
        { lat: 14.5838, lng: 120.9786 },
      ],
      name: "校园区域",
    },
    scenes: SCENES.map((s, i) => ({
      id: s.id,
      title: s.title,
      story: `第 ${i + 1} 站：${s.title}。`,
      briefing: `前往${s.title}。`,
      location: { lat: s.lat, lng: s.lng, radius: s.radius, name: s.title },
      nextSceneId: i < SCENES.length - 1 ? SCENES[i + 1].id : null,
      challenge: {
        type: "choice",
        question: `${s.title}的现场问题？`,
        options: ["A", "B", "C"],
        answer: 0,
      },
      reward: { type: "keyword", title: `${s.title}线索`, value: s.title },
    })),
  };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  // ---------- 0. 干净的起点：没有任何自定义游戏 ----------
  await page.goto(`${BASE}/select`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("mos-scene-hunt:authoring:") || k === "mos-scene-hunt:current-authored-game") {
        localStorage.removeItem(k);
      }
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(1200);

  await check("1. 没有自定义游戏时，/select 回落到 demo-hunt", async () => {
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes(DEMO_TITLE), `未显示官方示范内容，正文片段：${t.slice(0, 200)}`);
  });

  // ---------- 1. 写入自定义游戏（等同 design 保存） ----------
  await page.evaluate(
    (authKey, currentKey, game) => {
      localStorage.setItem(authKey, JSON.stringify(game));
      localStorage.setItem(currentKey, game.id);
    },
    AUTHORING_KEY,
    CURRENT_KEY,
    buildAuthoredGame(),
  );

  // ---------- 2. 冷启动 /select ----------
  await page.goto(`${BASE}/select`, { waitUntil: "domcontentloaded" });
  await sleep(1500);

  await check("2. /select 显示自定义游戏标题，不显示 Luneta", async () => {
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes(AUTHORED_TITLE), `未显示「${AUTHORED_TITLE}」：${t.slice(0, 300)}`);
    assert(!t.includes(DEMO_TITLE), `仍显示官方内容「${DEMO_TITLE}」`);
  });

  await check("3. /select 显示正确的场景数量（8 个）", async () => {
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes("8 个"), `「地点」统计未显示 8 个：${t.slice(0, 400)}`);
  });

  await check("4. /select 场景名称逐一正确", async () => {
    const t = await page.evaluate(() => document.body.innerText);
    for (const s of SCENES) {
      assert(t.includes(s.title), `场景列表缺少「${s.title}」`);
    }
  });

  await check("5. /select 触发距离来自实际数据而非硬编码 30–50m", async () => {
    const t = await page.evaluate(() => document.body.innerText);
    // 实际 radius 15–40，故应渲染 "15–40 m"
    assert(t.includes("15–40 m"), `未渲染真实触发半径区间：${t.slice(0, 500)}`);
    assert(!t.includes("30–50 m"), "仍硬编码 30–50 m");
  });

  await check("6. /select 标注为「本机创作」", async () => {
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes("本机创作"), "未标注为自定义创作");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "authored-01-select.png") });

  // ---------- 3. 开始寻宝 → 各页使用自定义数据 ----------
  const startBtn = await page.evaluateHandle(() => {
    return (
      Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").includes("开始寻宝") || (b.textContent ?? "").includes("继续寻宝"),
      ) ?? null
    );
  });
  const startEl = startBtn.asElement();
  assert(startEl, "找不到「开始寻宝」按钮");
  await startEl.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await sleep(200);
  const startBox = await startEl.boundingBox();
  await page.mouse.click(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await sleep(2500);

  await check("7. 开始寻宝后进入 /map", async () => {
    const url = page.url();
    assert(url.includes("/map"), `未跳转到 /map，当前 ${url}`);
  });

  await check("8. /map 渲染 8 个自定义场景标记", async () => {
    const markers = await page.$$eval('[data-role="scene-marker"]', (n) => n.length);
    assert(markers >= 8, `场景标记数量为 ${markers}，期望 ≥8`);
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "authored-02-map.png") });

  await check("9. /quest 使用自定义场景名称", async () => {
    await page.goto(`${BASE}/quest`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes("礼拜堂") || t.includes("图书馆"), `未出现自定义场景名：${t.slice(0, 400)}`);
    assert(!t.includes(DEMO_TITLE), "仍显示官方标题");
  });

  await check("10. /scene/chapel 加载自定义情境（非官方五站）", async () => {
    await page.goto(`${BASE}/scene/chapel`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes("礼拜堂"), `未显示自定义场景：${t.slice(0, 300)}`);
    assert(!t.includes("Rizal") && !t.includes("Luneta"), "仍显示官方示范内容");
  });

  await check("11. /challenge/chapel 使用自定义题目", async () => {
    await page.goto(`${BASE}/challenge/chapel`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes("礼拜堂的现场问题？"), `未显示自定义题目：${t.slice(0, 400)}`);
  });

  await check("12. /reward/chapel 使用自定义奖励", async () => {
    await page.goto(`${BASE}/reward/chapel`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes("礼拜堂线索"), `未显示自定义奖励：${t.slice(0, 400)}`);
  });

  // ---------- 4. 清空自定义游戏 → 回落 ----------
  await check("13. 清空自定义游戏后 /select 回落到 demo-hunt", async () => {
    await page.evaluate((authKey) => {
      localStorage.removeItem(authKey);
      localStorage.removeItem("mos-scene-hunt:current-authored-game");
    }, AUTHORING_KEY);
    await page.goto(`${BASE}/select`, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const t = await page.evaluate(() => document.body.innerText);
    assert(t.includes(DEMO_TITLE), `未回落官方内容：${t.slice(0, 300)}`);
    assert(!t.includes(AUTHORED_TITLE), "仍残留自定义标题");
  });
} finally {
  await browser.close();
}

const ok = results.filter((r) => r.ok).length;
log(`\n探针结果：${results.length} 项，通过 ${ok}，失败 ${results.length - ok}`);
if (errors.length) {
  log(`\n控制台错误 ${errors.length} 条：`);
  for (const e of errors.slice(0, 8)) log(`  · ${e}`);
} else {
  log("无页面级 JS 错误。");
}
writeFileSync(
  path.join(ARTIFACTS, "probe-authored-play-summary.json"),
  JSON.stringify({ results, errors }, null, 2),
);
process.exit(results.every((r) => r.ok) ? 0 : 1);
