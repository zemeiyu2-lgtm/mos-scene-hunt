/**
 * 一次性探针：验证 /design 的 4 步创建流程在真实浏览器里的交互。
 * 不是验收套件的一部分，用 run-probe.mjs 驱动：
 *   node tests/e2e/run-probe.mjs probe-design.mjs
 *
 * 重点覆盖那些只能在浏览器里证伪的东西：
 *   - 两个入口按钮是否真的可见可点
 *   - 绘制态是否真的把「地图点击」从「加场景」换成「加边界点」
 *   - 点数计数是否随点击增长，且 <3 点时完成按钮不可用
 *   - 完成后是否落库为 polygon 且地图点击回到「加场景」模式
 *   - 圆形模式是否走独立分支
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SAVE_KEY = "mos-scene-hunt:active-save";
const SETTINGS_KEY = "mos-scene-hunt:settings";

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

async function waitFor(fn, { timeout = 8000, interval = 120, message = "条件未满足" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`${message}（等待 ${timeout}ms 超时）`);
}

/** 按可见文本点击：先滚进视口（页面是内部滚动容器，长页面按钮常在首屏外），
 *  再用真实坐标点击，顺带验证没有被其它图层遮挡。 */
async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, needle) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return (
        nodes.find(
          (n) => (n.textContent ?? "").includes(needle) && n.offsetParent !== null,
        ) ?? null
      );
    },
    selector,
    text,
  );
  const el = handle.asElement();
  assert(el, `找不到可点击元素：${selector} 含「${text}」`);
  await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await new Promise((r) => setTimeout(r, 200));
  const box = await el.boundingBox();
  assert(box, `元素无 boundingBox：${text}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** 找一个可见按钮，返回 { disabled }。 */
async function buttonState(page, text) {
  return page.evaluate((needle) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes(needle) && b.offsetParent !== null,
    );
    return btn ? { disabled: btn.disabled } : null;
  }, text);
}

/** 地图中心点击，返回点击处的像素坐标。先确保地图在视口内（前面步骤可能
 *  已把页面滚到卡片区域），否则坐标会落在视口外而丢失。 */
async function clickMap(page, dx = 0, dy = 0) {
  await page.evaluate(() => {
    document.querySelector(".leaflet-container")?.scrollIntoView({ block: "center" });
  });
  await new Promise((r) => setTimeout(r, 200));
  const box = await page.evaluate(() => {
    const c = document.querySelector(".leaflet-container");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  assert(box, "找不到 .leaflet-container");
  const x = box.x + box.w / 2 + dx;
  const y = box.y + box.h / 2 + dy;
  await page.mouse.click(x, y);
  return { x, y };
}

async function designState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const poly = document.querySelectorAll(".area-vertex-label").length;
    const save = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("保存我的游戏"),
    );
    return {
      text,
      vertexLabels: poly,
      saveDisabled: save ? save.disabled : null,
    };
  });
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

  await page.goto(`${BASE}/design`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));

  // ---------- 步骤导航 ----------
  await check("页面存在 4 步导航，第一步为「选择游戏区域」", async () => {
    const { text } = await designState(page);
    for (const s of [
      "选择游戏区域",
      "放置场景",
      "设置触发距离",
      "保存游戏",
    ]) {
      assert(text.includes(s), `缺少步骤「${s}」`);
    }
  });

  await check("第一步提供「自定义绘制」与「圆形区域」两个入口", async () => {
    const { text } = await designState(page);
    assert(text.includes("自定义绘制"), "缺少「自定义绘制」入口");
    assert(text.includes("圆形区域"), "缺少「圆形区域」入口");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "design-01-step1-entries.png") });

  // ---------- 进入绘制态 ----------
  await clickByText(page, "button", "自定义绘制");
  await new Promise((r) => setTimeout(r, 600));

  await check("进入绘制态后显示引导与最少点数提示", async () => {
    const { text } = await designState(page);
    assert(
      text.includes("依次点击游戏区域的边界点"),
      "缺少「请在地图上依次点击游戏区域的边界点」提示",
    );
    assert(text.includes("0") && text.includes("已选择"), "缺少点数计数");
    assert(text.includes("至少 3 个点"), "缺少「至少 3 个点」提示");
  });

  await check("绘制态提供 完成/撤销/重新绘制/取消 四项操作", async () => {
    const { text } = await designState(page);
    for (const b of ["完成区域", "撤销上一点", "重新绘制", "取消"]) {
      assert(text.includes(b), `缺少「${b}」按钮`);
    }
  });

  await check("0 个点时完成与保存均不可用", async () => {
    const fin = await buttonState(page, "完成区域");
    const save = await buttonState(page, "保存我的游戏");
    assert(fin?.disabled === true, "0 点时「完成区域」应禁用");
    assert(save?.disabled === true, "绘制会话中「保存我的游戏」应禁用");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "design-02-drawing.png") });

  // ---------- 点击加点 ----------
  await check("地图点击添加边界点而非场景", async () => {
    await clickMap(page, -120, -80);
    await clickMap(page, 120, -80);
    await clickMap(page, 0, 110);
    await new Promise((r) => setTimeout(r, 500));
    const { text, vertexLabels } = await designState(page);
    assert(
      text.includes("已选择 3 个点"),
      `点数计数未到 3：${text.match(/已选择[^\n]*/)?.[0] ?? "（无）"}`,
    );
    assert(vertexLabels >= 3, `编号顶点标记应 ≥3，实际 ${vertexLabels}`);
  });

  await check("达到 3 点后完成按钮可用（保存仍等会话结束）", async () => {
    const fin = await buttonState(page, "完成区域");
    assert(fin?.disabled === false, "3 点后「完成区域」不应禁用");
  });

  // ---------- 撤销 ----------
  await check("撤销上一点把计数退回 2", async () => {
    await clickByText(page, "button", "撤销上一点");
    await new Promise((r) => setTimeout(r, 400));
    const { text } = await designState(page);
    assert(text.includes("已选择 2 个点"), "撤销后应为 2 个点");
    const fin = await buttonState(page, "完成区域");
    assert(fin?.disabled === true, "退回 2 点后完成按钮应再次禁用");
    // 补回来，继续完成区域
    await clickMap(page, 0, 110);
    await new Promise((r) => setTimeout(r, 400));
  });

  // ---------- 完成区域 ----------
  await check("完成区域后闭合为多边形并退出绘制态", async () => {
    await clickByText(page, "button", "完成区域");
    await new Promise((r) => setTimeout(r, 700));
    const { text } = await designState(page);
    assert(!text.includes("依次点击游戏区域的边界点"), "完成后应退出绘制态");
    assert(
      text.includes("自定义区域") && /\d+ 个边界点/.test(text),
      "完成后应显示边界点汇总",
    );
    const save = await buttonState(page, "保存我的游戏");
    assert(save?.disabled === false, "区域完成后保存应可用");
  });

  await check("完成后地图点击恢复为「添加场景」", async () => {
    const before = await page.evaluate(() => document.querySelectorAll(".area-vertex-label").length);
    await clickMap(page, -120, -80);
    await new Promise((r) => setTimeout(r, 600));
    const { text } = await designState(page);
    assert(!text.includes("依次点击游戏区域的边界点"), "不应重新进入绘制态");
    const after = await page.evaluate(() => document.querySelectorAll(".area-vertex-label").length);
    assert(after === before, `顶点标记不应再增长（${before} → ${after}）`);
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "design-03-polygon-done.png") });

  // ---------- 圆形模式 ----------
  await check("圆形区域走独立入口并给出圆心提示", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1200));
    await clickByText(page, "button", "圆形区域");
    await new Promise((r) => setTimeout(r, 600));
    const { text } = await designState(page);
    assert(
      text.includes("圆心") || text.includes("点击地图设置"),
      "圆形模式应提示点击地图设置圆心",
    );
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "design-04-circle.png") });
} finally {
  await browser.close();
}

const ok = results.filter((r) => r.ok).length;
log(`\n探针结果：${results.length} 项，通过 ${ok}，失败 ${results.length - ok}`);
if (errors.length) {
  log(`\n控制台错误 ${errors.length} 条：`);
  for (const e of errors.slice(0, 10)) log(`  · ${e}`);
} else {
  log("无页面级 JS 错误。");
}
writeFileSync(
  path.join(ARTIFACTS, "probe-design-summary.json"),
  JSON.stringify({ results, errors }, null, 2),
);
process.exit(results.every((r) => r.ok) ? 0 : 1);
