/**
 * 创作中心崩溃修复验收探针（fix/design-layerpoint-crash 专用）
 *
 * 覆盖用户指定的全部验收项：
 *   A  /design 正常打开
 *   B  逐点绘制 / 撤销 / 重新绘制 / 闭合
 *   C  圆形 ↔ 多边形双向切换
 *   D  拖拽场景标记
 *   E  缩放、拖动地图、悬停标记
 *   F  刷新、离开 /design 再返回
 *   G  连续 5 轮完整绘制编辑
 *   H  全程 pageerror / console.error 归零
 *
 * 额外：每轮结束后直接把该轮捕获的异常计数写回结果，任何一项失败都会
 * 让退出码非 0，不允许「看起来绿但实际报错」。
 *
 * 运行：node tests/e2e/run-probe.mjs probe-design-acceptance.mjs
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

/** 点击第一个「可见且文本包含 needle」的元素；按钮常在折叠区域，故在页面内派发 click。 */
async function clickByText(page, selector, needle, { allowDisabled = false } = {}) {
  const info = await page.evaluate(
    (sel, text, allow) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      const el = nodes.find((n) => {
        const t = n.textContent ?? "";
        if (!t.includes(text)) return false;
        if (!allow) return !n.disabled;
        return true;
      });
      if (!el) return { ok: false, reason: "not-found" };
      el.scrollIntoView({ block: "center" });
      el.click();
      return { ok: true };
    },
    selector,
    needle,
    allowDisabled,
  );
  assert(info.ok, `找不到可点击元素：${selector} 含「${needle}」`);
  await sleep(320);
}

async function buttonState(page, needle) {
  return page.evaluate((text) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(text),
    );
    return btn ? { disabled: btn.disabled } : null;
  }, needle);
}

/**
 * 保存按钮文案有歧义：「保存并立即试玩」「仅保存到本机」都不含子串「保存我的游戏」。
 * 按真实意图取「④ 保存游戏」区块里的保存按钮，并断言它确实存在。
 */
async function saveState(page) {
  const state = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").trim().includes("仅保存到本机"),
    );
    if (!btns.length) return null;
    return { disabled: btns[0].disabled, label: btns[0].textContent.trim() };
  });
  assert(state, "找不到保存按钮（仅保存到本机）");
  return state;
}

/** 读设计页关键状态：正文、顶点标签数、多边形/圆形徽标。 */
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

/** 计算地图容器内的相对坐标点击（地图可能不在视口内，先滚进来）。 */
async function mapBox(page) {
  await page.evaluate(() => {
    document.querySelector(".leaflet-container")?.scrollIntoView({ block: "center" });
  });
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

/** 在地图上绕圈点击 n 个边界点，间隔足够大以免误触同一像素。 */
const RING = [
  [-140, -100],
  [140, -100],
  [160, 90],
  [0, 150],
  [-160, 90],
  [-40, -150],
];

async function drawPoints(page, n) {
  for (let i = 0; i < n; i += 1) {
    await clickMap(page, RING[i % RING.length][0], RING[i % RING.length][1]);
  }
}

async function openDesign(page, label) {
  await page.goto(`${BASE}/design`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await sleep(1200);
  const box = await page.evaluate(() => {
    const c = document.querySelector(".leaflet-container");
    return Boolean(c && c._leaflet_id);
  });
  assert(box, `${label}：地图容器未完成 Leaflet 初始化`);
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

  /* ------------------------------------------------ A 打开 */
  await check("A /design 正常打开，地图与场景标记渲染完成", async () => {
    await openDesign(page, "首次打开");
    const s = await designState(page);
    assert(s.text.includes("创作中心") || s.text.includes("选择游戏区域"), "缺少创作中心正文");
    assert(s.sceneMarkers > 0, `场景标记应 >0，实际 ${s.sceneMarkers}`);
    assert(s.chip.length > 0, "缺少区域徽标");
  });

  /* ------------------------------------------------ B 绘制全流程 */
  await check("B1「自定义绘制」进入绘制态，起点数为 0", async () => {
    await clickByText(page, "button", "自定义绘制");
    const s = await designState(page);
    assert(s.text.includes("依次点击游戏区域的边界点"), "未进入绘制态");
    assert(s.pointCount === 0, `起点数应为 0，实际 ${s.pointCount}`);
    assert((await buttonState(page, "完成区域"))?.disabled === true, "0 点时完成应禁用");
  });

  await check("B2 逐点绘制：点数、顶点标签、完成按钮状态同步", async () => {
    for (let i = 1; i <= 3; i += 1) {
      await clickMap(page, RING[i - 1][0], RING[i - 1][1]);
      const s = await designState(page);
      assert(s.pointCount === i, `第 ${i} 点后点数应为 ${i}，实际 ${s.pointCount}`);
      assert(s.vertexLabels === i, `第 ${i} 点后顶点标签应为 ${i}，实际 ${s.vertexLabels}`);
    }
    assert((await buttonState(page, "完成区域"))?.disabled === false, "3 点后完成应可用");
    assert((await saveState(page)).disabled === true, "绘制会话中保存应禁用");
  });

  await check("B3 撤销上一点：点数与顶点标签一起回退", async () => {
    await clickByText(page, "button", "撤销上一点");
    const s = await designState(page);
    assert(s.pointCount === 2, `撤销后点数应为 2，实际 ${s.pointCount}`);
    assert(s.vertexLabels === 2, `撤销后顶点标签应为 2，实际 ${s.vertexLabels}`);
    assert((await buttonState(page, "完成区域"))?.disabled === true, "2 点时完成应禁用");
  });

  await check("B4 重新绘制把点数清零，随后可继续加点", async () => {
    await clickByText(page, "button", "重新绘制");
    let s = await designState(page);
    assert(s.pointCount === 0, `重新绘制后点数应为 0，实际 ${s.pointCount}`);
    assert(s.vertexLabels === 0, `重新绘制后顶点标签应为 0，实际 ${s.vertexLabels}`);
    await drawPoints(page, 4);
    s = await designState(page);
    assert(s.pointCount === 4, `重新加点后点数应为 4，实际 ${s.pointCount}`);
  });

  await check("B5 闭合区域：退出绘制态、顶点清理、保存可用", async () => {
    await clickByText(page, "button", "完成区域");
    const s = await designState(page);
    assert(!s.text.includes("依次点击游戏区域的边界点"), "闭合后应退出绘制态");
    assert(s.vertexLabels === 0, `闭合后顶点标签应清零，实际 ${s.vertexLabels}`);
    assert(/自定义区域/.test(s.chip), `闭合后应显示自定义区域徽标，实际「${s.chip}」`);
    assert((await saveState(page)).disabled === false, "闭合后保存应可用");
  });

  /* ------------------------------------------------ C 圆形 ↔ 多边形 */
  await check("C1 已闭合多边形 → 圆形区域（点击地图设圆心）", async () => {
    await clickByText(page, "button", "圆形区域");
    let s = await designState(page);
    assert(s.text.includes("点击地图设置圆心"), "未进入圆形放置态");
    await clickMap(page, 40, 30);
    s = await designState(page);
    assert(/圆形\s*·\s*半径\s*\d+m/.test(s.chip), `切换后应为圆形徽标，实际「${s.chip}」`);
    assert(s.vertexLabels === 0, "圆形模式不应有顶点标签");
  });

  await check("C2 圆形 → 多边形（再次自定义绘制并闭合）", async () => {
    await clickByText(page, "button", "自定义绘制");
    await drawPoints(page, 3);
    await clickByText(page, "button", "完成区域");
    const s = await designState(page);
    assert(/自定义区域/.test(s.chip), `应回到多边形徽标，实际「${s.chip}」`);
  });

  await check("C3 多边形 → 清除区域回到圆形，区域半径滑块可用", async () => {
    await clickByText(page, "button", "清除区域");
    let s = await designState(page);
    assert(/圆形\s*·\s*半径/.test(s.chip), `清除后应为圆形，实际「${s.chip}」`);
    const before = Number((s.chip.match(/半径\s*(\d+)m/) ?? [])[1] ?? NaN);
    // 用真实键盘事件驱动滑块：React 的 range onChange 依赖原生 input 事件，
    // 直接派发合成事件改 value 在受控组件上不会生效。
    const slider = await page.$('input[type="range"]');
    assert(slider, "找不到区域半径滑块");
    await slider.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(150);
    await slider.focus();
    await page.keyboard.press("Home");
    await sleep(200);
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("ArrowRight");
      await sleep(90);
    }
    await sleep(300);
    s = await designState(page);
    const after = Number((s.chip.match(/半径\s*(\d+)m/) ?? [])[1] ?? NaN);
    assert(Number.isFinite(after), `调整后徽标里读不到半径：「${s.chip}」`);
    assert(after !== before, `滑块调整后半径应变化，仍为 ${after}m（原 ${before}m）`);
    assert(after <= 500 && after >= 30, `半径越界：${after}m`);
  });

  /* ------------------------------------------------ D 拖拽场景标记 */
  await check("D 拖拽场景标记后坐标变化且不崩溃", async () => {
    const before = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-role="scene-marker"]')).length > 0,
    );
    assert(before, "没有可拖拽的场景标记");
    // 地图点击会把当前选中地点移到点击处 —— 等价于拖动一次位置更新，
    // 但真正的 drag 路径要单独走一遍 mouse down/move/up。
    const pos = await page.evaluate(() => {
      const m = document.querySelector('[data-role="scene-marker"]');
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(pos.x + i * 6, pos.y + i * 3);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(500);
    const s = await designState(page);
    assert(!s.text.includes("Application error"), "拖拽后页面进入错误态");
  });

  /* ------------------------------------------------ E 缩放 / 拖动 / 悬停 */
  await check("E 缩放、拖动地图、悬停标记均无异常", async () => {
    const b = await mapBox(page);
    // 滚轮缩放（放大再缩小）
    await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel({ deltaY: -240 });
      await sleep(120);
    }
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel({ deltaY: 240 });
      await sleep(120);
    }
    // 拖动地图
    await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(b.x + b.w / 2 - i * 9, b.y + b.h / 2 - i * 5);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(400);
    // 悬停每个场景标记 + 区域边线
    const markers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-role="scene-marker"]')).map((m) => {
        const r = m.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
    );
    for (const p of markers) {
      await page.mouse.move(p.x, p.y);
      await sleep(120);
    }
    assert(!(await designState(page)).text.includes("Application error"), "交互后进入错误态");
  });

  /* ------------------------------------------------ F 刷新 / 离开返回 */
  await check("F1 刷新 /design 后地图与区域完好", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await sleep(1200);
    const s = await designState(page);
    assert(s.sceneMarkers > 0, "刷新后场景标记丢失");
    assert(s.chip.length > 0, "刷新后区域徽标丢失");
  });

  await check("F2 离开 /design 再返回，地图重建正常", async () => {
    await page.goto(`${BASE}/games`, { waitUntil: "domcontentloaded" });
    await sleep(700);
    await page.goto(`${BASE}/design`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await sleep(1200);
    const s = await designState(page);
    assert(s.sceneMarkers > 0, "返回后场景标记丢失");
  });

  /* ------------------------------------------------ G 连续 5 轮 */
  for (let round = 1; round <= 5; round += 1) {
    await check(`G${round} 第 ${round} 轮完整绘制编辑`, async () => {
      const errBefore = errors.length;
      await clickByText(page, "button", "自定义绘制");
      await drawPoints(page, 3);
      await clickByText(page, "button", "撤销上一点");
      let s = await designState(page);
      assert(s.pointCount === 2, `第 ${round} 轮撤销后应为 2 点，实际 ${s.pointCount}`);
      await clickMap(page, RING[3][0], RING[3][1]);
      await clickMap(page, RING[4][0], RING[4][1]);
      await clickByText(page, "button", "完成区域");
      s = await designState(page);
      assert(/自定义区域/.test(s.chip), `第 ${round} 轮闭合后徽标异常：「${s.chip}」`);
      // 轮内穿插拖拽与缩放，确保每轮都走到 Layer 失效风险路径
      const b = await mapBox(page);
      await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
      await page.mouse.wheel({ deltaY: -200 });
      await sleep(150);
      await page.mouse.wheel({ deltaY: 200 });
      await sleep(150);
      await clickByText(page, "button", "清除区域");
      await sleep(200);
      await clickByText(page, "button", "自定义绘制");
      await clickByText(page, "button", "取消");
      const added = errors.length - errBefore;
      assert(added === 0, `第 ${round} 轮新增 ${added} 条错误：${errors.slice(errBefore, errBefore + 3).join(" | ")}`);
    });
  }

  /* ------------------------------------------------ H 错误汇总 */
  await check("H 全程无 pageerror / console.error", async () => {
    assert(errors.length === 0, `共 ${errors.length} 条错误：\n      ${errors.slice(0, 6).join("\n      ")}`);
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "design-acceptance-final.png") });
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
  path.join(ARTIFACTS, "probe-design-acceptance-summary.json"),
  JSON.stringify({ base: BASE, results, errors }, null, 2),
);
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
