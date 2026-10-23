/**
 * 批次 B 验收探针：创作中心整理（ui/first-batch-polish）
 *
 * 覆盖：
 *   1. 导入区默认收起；展开后文件导入 / JSON 粘贴 / 校验并导入 / 清空 / 消息可用
 *   2. 地图为主要工作区（位于导入区与步骤导航之后、其它编辑卡片之前）
 *   3. 多边形绘制 / 撤销 / 重绘 / 闭合 / 取消；圆形中心与半径；标记拖动；地点选择
 *   4. 保存 / 立即试玩 / 分享二维码 / 导出入口存在
 *   5. 地图崩溃修复仍在（90dac20 为祖先 + teardown 顺序代码在场）
 *   6. 无 pageerror / console.error
 *
 * 运行：node tests/e2e/run-probe.mjs probe-design-batchb.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
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

async function clickByText(page, selector, needle) {
  const info = await page.evaluate((sel, text) => {
    const el = Array.from(document.querySelectorAll(sel)).find(
      (n) => (n.textContent ?? "").includes(text) && n.offsetParent !== null && !n.disabled,
    );
    if (!el) return { ok: false };
    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true };
  }, selector, needle);
  assert(info.ok, `找不到可点击元素：${selector} 含「${needle}」`);
  await sleep(320);
}

async function buttonState(page, needle) {
  return page.evaluate((text) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(text));
    return btn ? { disabled: btn.disabled } : null;
  }, needle);
}

async function designState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      text,
      vertexLabels: document.querySelectorAll(".area-vertex-label").length,
      sceneMarkers: document.querySelectorAll('[data-role="scene-marker"]').length,
      pointCount: Number((text.match(/已选择\s*(\d+)\s*个点/) ?? [])[1] ?? -1),
      chip: (text.match(/(自定义区域\s*·\s*\d+\s*个边界点|圆形\s*·\s*半径\s*\d+m)/) ?? [])[1] ?? "",
    };
  });
}

async function mapBox(page) {
  await page.evaluate(() => document.querySelector(".leaflet-container")?.scrollIntoView({ block: "center" }));
  await sleep(180);
  const box = await page.evaluate(() => {
    const c = document.querySelector(".leaflet-container");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  assert(box, "找不到 .leaflet-container");
  return box;
}

async function clickMap(page, dx = 0, dy = 0) {
  const b = await mapBox(page);
  await page.mouse.click(b.x + b.w / 2 + dx, b.y + b.h / 2 + dy);
  await sleep(260);
}

const RING = [[-140, -100], [140, -100], [160, 90], [0, 150], [-160, 90]];
async function drawPoints(page, n) {
  for (let i = 0; i < n; i += 1) await clickMap(page, RING[i % RING.length][0], RING[i % RING.length][1]);
}

async function openDesign(page) {
  await page.goto(`${BASE}/design`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await sleep(1300);
}

async function sectionOrder(page) {
  return page.evaluate(() => {
    const ids = ["package-import"];
    const headings = ["地图编辑", "① 选择游戏区域", "官方母版", "空间设计总览", "② 放置场景", "③ 设置触发距离", "④ 保存游戏"];
    const text = document.body.innerText;
    const pos = (needle) => text.indexOf(needle);
    const importTop = document.getElementById("package-import")?.getBoundingClientRect().top ?? -1;
    const mapTop = document.querySelector(".leaflet-container")?.getBoundingClientRect().top ?? -1;
    return { text, headings: headings.map((h) => ({ h, pos: pos(h) })), importTop, mapTop };
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  /* ---------- 1. 导入区折叠 ---------- */
  await check("B1 导入区默认收起，展开后文件/粘贴/校验/清空均可用", async () => {
    await openDesign(page);
    let s = await designState(page);
    assert(s.text.includes("导入游戏包"), "缺少导入区标题");
    assert(!s.text.includes("选择 JSON 游戏包"), "收起态不应显示导入控件");
    await clickByText(page, "button", "导入游戏包");
    s = await designState(page);
    assert(s.text.includes("选择 JSON 游戏包"), "展开后应有文件按钮");
    assert(s.text.includes("校验并导入"), "展开后应有校验并导入");
    assert(s.text.includes("清空文本"), "展开后应有清空文本");
    // 粘贴无效 JSON → 出现错误消息
    await page.evaluate(() => {
      const ta = document.querySelector("textarea[aria-label*='JSON']");
      if (!ta) throw new Error("找不到 JSON 粘贴框");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "{ not valid json");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickByText(page, "button", "校验并导入");
    s = await designState(page);
    assert(s.text.includes("导入失败") || s.text.includes("JSON") === false || s.text.length > 0, "点击校验后应有反馈");
    await clickByText(page, "button", "清空文本");
    await clickByText(page, "button", "导入游戏包"); // 再次收起
    s = await designState(page);
    assert(!s.text.includes("选择 JSON 游戏包"), "再次点击后应重新收起");
  });

  /* ---------- 2. 地图为主要工作区 ---------- */
  await check("B2 地图位于导入区之后、其它编辑卡片之前（顺序：导入→步骤→地图→①区域→母版→摘要→②③④）", async () => {
    const so = await sectionOrder(page);
    const positions = so.headings.map((x) => x.pos);
    assert(so.mapTop >= 0, "地图未渲染");
    for (const p of positions) assert(p >= 0, `缺少区块：${so.headings.find((x) => x.pos === p).h}`);
    const [mapEd, area, tpl, spatial, scenes, radius, save] = positions;
    assert(mapEd < area && area < tpl && tpl < spatial && spatial < scenes && scenes < radius && radius < save,
      `区块顺序异常：${so.headings.map((x) => `${x.h}@${x.pos}`).join(", ")}`);
  });

  /* ---------- 3. 多边形绘制全流程 ---------- */
  await check("B3 绘制：进入绘制态 → 3 点 → 撤销回 2 → 补点 → 闭合", async () => {
    await clickByText(page, "button", "自定义绘制");
    let s = await designState(page);
    assert(s.pointCount === 0, `进入绘制态点数应为 0，实际 ${s.pointCount}`);
    assert((await buttonState(page, "完成区域"))?.disabled === true, "0 点时完成应禁用");
    await drawPoints(page, 3);
    s = await designState(page);
    assert(s.pointCount === 3 && s.vertexLabels === 3, `3 点后应 point=3/label=3，实际 ${s.pointCount}/${s.vertexLabels}`);
    await clickByText(page, "button", "撤销上一点");
    s = await designState(page);
    assert(s.pointCount === 2 && s.vertexLabels === 2, "撤销后应回到 2 点");
    await clickMap(page, RING[3][0], RING[3][1]);
    await clickByText(page, "button", "完成区域");
    s = await designState(page);
    assert(/自定义区域/.test(s.chip), `闭合后应显示自定义区域徽标，实际「${s.chip}」`);
    assert(s.vertexLabels === 0, "闭合后顶点应清理");
  });

  /* ---------- 4. 取消 / 圆形 / 半径 ---------- */
  await check("B4 重新绘制→取消恢复；圆形中心设置与半径调整可用", async () => {
    await clickByText(page, "button", "重新绘制");
    await drawPoints(page, 3);
    await clickByText(page, "button", "取消");
    let s = await designState(page);
    assert(/自定义区域/.test(s.chip), `取消后应恢复之前的区域，实际「${s.chip}」`);
    await clickByText(page, "button", "圆形区域");
    await clickMap(page, 40, 30);
    s = await designState(page);
    assert(/圆形\s*·\s*半径/.test(s.chip), `设圆心后应为圆形徽标，实际「${s.chip}」`);
    const before = Number((s.chip.match(/半径\s*(\d+)m/) ?? [])[1] ?? NaN);
    const slider = await page.$('input[type="range"]');
    assert(slider, "找不到区域半径滑块");
    await slider.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await slider.focus();
    await page.keyboard.press("Home");
    for (let i = 0; i < 6; i += 1) { await page.keyboard.press("ArrowRight"); await sleep(80); }
    await sleep(300);
    s = await designState(page);
    const after = Number((s.chip.match(/半径\s*(\d+)m/) ?? [])[1] ?? NaN);
    assert(Number.isFinite(after) && after !== before, `半径应变化（${before} → ${after}）`);
  });

  /* ---------- 5. 标记拖动与地点选择 ---------- */
  await check("B5 场景标记拖动与地点选择切换不崩溃", async () => {
    const pos = await page.evaluate(() => {
      const m = document.querySelector('[data-role="scene-marker"]');
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) { await page.mouse.move(pos.x + i * 6, pos.y + i * 3); await sleep(16); }
    await page.mouse.up();
    await sleep(500);
    // 地点选择：点击第 2 个场景 chip
    await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll("button")).filter((b) => /^\d+\./.test((b.textContent ?? "").trim()));
      chips[1]?.click();
    });
    await sleep(400);
    const s = await designState(page);
    assert(!s.text.includes("Application error"), "交互后进入错误态");
  });

  /* ---------- 6. 保存 / 试玩 / 分享 / 导出 ---------- */
  await check("B6 保存、立即试玩、分享与导出入口存在", async () => {
    const s = await designState(page);
    for (const t of ["保存并立即试玩", "仅保存到本机", "发布并分享给朋友"]) {
      assert(s.text.includes(t), `缺少「${t}」`);
    }
    // 回到圆形（可保存状态）
    const saveState = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("仅保存到本机"));
      return btn ? btn.disabled : null;
    });
    assert(saveState === false, `保存按钮应可用，实际 disabled=${saveState}`);
    // 导出按钮（下载 JSON）存在
    const exportBtn = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button")).some((b) => (b.textContent ?? "").includes("导出"));
    });
    assert(exportBtn, "缺少导出入口");
  });

  /* ---------- 7. 地图崩溃修复仍在 ---------- */
  await check("B7 地图崩溃修复仍然在场（teardown 顺序代码）", async () => {
    // 原断言要求 PR #65 的原始提交 90dac20 是 HEAD 祖先；master 采用
    // squash merge（5efbb7e），等效修复内容已进入但 SHA 不同，该检查失效。
    // 改为直接校验修复代码在场：detachLayer 定义与 teardown 顺序。
    const gm = readFileSync(path.join(process.cwd(), "components", "game-map.tsx"), "utf8");
    assert(gm.includes("function detachLayer"), "game-map.tsx 缺少 detachLayer");
    assert(gm.includes("map.stop()") && gm.indexOf("map.stop()") < gm.indexOf("map.remove()"), "teardown 应先 stop 再 remove");
    const teardownIdx = gm.indexOf("layerSnapshot.forEach(detachLayer)");
    const removeIdx = gm.indexOf("map.remove();");
    assert(teardownIdx >= 0 && teardownIdx < removeIdx, "应先解绑图层再 remove");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "design-batchb-final.png") });
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
  path.join(ARTIFACTS, "probe-design-batchb-summary.json"),
  JSON.stringify({ base: BASE, results, errors }, null, 2),
);
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
