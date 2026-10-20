/**
 * 地图导航探针：雷达指针 + 可折叠任务面板。
 *
 * 覆盖 2026-10-18 已验证交互线（radar pointer / compact map HUD）的验收点，
 * 确保「恢复原始交互方案」之后这些行为确实存在于地图页：
 *
 *  N1 任务面板默认收起（不主动遮挡地图）
 *  N2 卡片展示导向文案「蓝色箭头指向目标」
 *  N3 雷达 SVG 内存在目标箭头，且旋转角度 = 目标方位（与独立计算比对）
 *  N4 点击卡片可展开任务详情，再次点击可收起
 *  N5 页面不出现距离数字（km / m 读数）
 *  N6 玩家光标可见
 *  N7 指南针按钮提示说明两种箭头语义
 *  N8 相机离开再返回地图页不触发 layerPointToLatLng 崩溃
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
const ARTIFACTS = path.join(root, "tests", "e2e", "artifacts");

/** demo-hunt 的起始坐标与 scene-a 坐标（与内容包保持一致）。 */
const START = { lat: 14.5845, lng: 120.9794 };
const SETTINGS_KEY = "mos-scene-hunt:settings";

/**
 * 用 DEV 模拟器「传送」玩家。
 *
 * 持久化结构是 `{ simulatorEnabled, simulatorCoordinate: { lat, lng } }`，
 * provider 只在挂载时读一次，所以写完必须 reload。
 * 模拟器本身还需要构建期 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1` 才可用。
 */
async function teleport(page, coord, { settle = 2600 } = {}) {
  await page.evaluate(
    (key, c) => {
      const raw = localStorage.getItem(key);
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        key,
        JSON.stringify({ ...prev, simulatorEnabled: true, simulatorCoordinate: { lat: c.lat, lng: c.lng } }),
      );
    },
    SETTINGS_KEY,
    coord,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(settle);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 屏幕上的方位角（0=北，顺时针），用于与页面内计算结果比对。 */
function bearingDegrees(from, to) {
  const rad = (v) => (v * Math.PI) / 180;
  const deg = (v) => (v * 180) / Math.PI;
  const lat1 = rad(from.lat);
  const lat2 = rad(to.lat);
  const dLng = rad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const results = [];
function record(name, ok, error) {
  results.push({ name, ok, error });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !error ? "" : `\n      ${error}`}`);
}

async function check(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (error) {
    record(name, false, String(error?.message ?? error).slice(0, 600));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--window-size=390,844"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await browser.defaultBrowserContext().overridePermissions(BASE, ["geolocation", "notifications"]);
  await page.setGeolocation(START);

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  try {
    await page.goto(`${BASE}/map`, { waitUntil: "networkidle2", timeout: 45_000 });
    await sleep(1200);

    /* ---------------------------------------------- N0 定位未就绪时的等待态 */
    await check("N0 定位未就绪时显示合理的等待状态", async () => {
      // 首次打开尚未注入模拟坐标：应给出「等待…方向」而不是空白或报错。
      const text = await page.evaluate(() => document.body.innerText);
      const waiting = /等待可靠定位方向|等待定位|请求定位|允许定位|定位权限/.test(text);
      assert(waiting, `未找到任何定位等待/提示文案：\n${text.slice(0, 400)}`);
    });

    // 注入模拟坐标并重新载入，后续所有方向断言都基于确定的定位来源。
    await teleport(page, START);

    /* ---------------------------------------------------------- N1 默认收起 */
    await check("N1 任务面板默认收起（详情入口未直接铺开）", async () => {
      const text = await page.evaluate(() => document.body.innerText);
      assert(text.includes("蓝色箭头指向目标"), `未找到导向文案：\n${text.slice(0, 400)}`);
      assert(
        !text.includes("查看任务详情"),
        `任务详情入口在默认态即可见，说明面板未收起：\n${text.slice(0, 400)}`,
      );
    });

    /* ---------------------------------------------------------- N2 导向文案 */
    await check("N2 卡片说明蓝色箭头指向目标并提示指南针", async () => {
      const text = await page.evaluate(() => document.body.innerText);
      assert(/蓝色箭头指向目标/.test(text), `缺少「蓝色箭头指向目标」：\n${text.slice(0, 400)}`);
    });

    /* ---------------------------------------------------------- N3 箭头角度 */
    await check("N3 雷达目标箭头旋转角等于目标方位", async () => {
      const arrow = await page.evaluate(() => {
        // 目标箭头是一个 role=img 的 <svg>，旋转直接写在它自己的 style 上。
        const node = document.querySelector('svg[aria-label="目标方向指示"]');
        if (!node) return { found: false, angle: null };
        const style = node.getAttribute("style") ?? "";
        const match = /rotate\((-?[\d.]+)deg\)/.exec(style);
        return { found: true, angle: match ? Number(match[1]) : null };
      });
      assert(arrow.found, "雷达卡中没有找到目标方向指示箭头");
      assert(arrow.angle !== null, "目标箭头没有旋转角度");
      const angle = arrow.angle;

      // 页面箭头指向当前目标（scene-a）；用起始坐标独立算一遍。
      const scenes = await page.evaluate(async () => {
        const res = await fetch("/content/demo-hunt.json");
        const pack = await res.json();
        return pack.scenes.map((scene) => ({ id: scene.id, lat: scene.location.lat, lng: scene.location.lng }));
      });
      assert(scenes.length > 0, "读不到内容包场景");
      const expected = bearingDegrees(START, scenes[0]);
      const delta = Math.abs(((angle - expected + 540) % 360) - 180);
      assert(delta < 8, `箭头角度 ${angle}° 与期望方位 ${expected.toFixed(1)}° 偏差过大（${delta.toFixed(1)}°）`);
    });

    /* ---------------------------------------------------------- N4 展开/收起 */
    await check("N4 点击卡片展开任务详情，再次点击收起", async () => {
      const clicked = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button")).find((node) =>
          /蓝色箭头指向目标/.test(node.innerText),
        );
        if (!button) return false;
        button.click();
        return true;
      });
      assert(clicked, "找不到任务卡按钮");
      await sleep(600);
      let text = await page.evaluate(() => document.body.innerText);
      assert(text.includes("查看任务详情") || text.includes("解锁情境"), `展开后没有详情入口：\n${text.slice(0, 500)}`);

      await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button")).find((node) =>
          /蓝色箭头指向目标|查看任务详情|解锁情境/.test(node.innerText) && node.querySelector("svg"),
        );
        button?.click();
      });
      await sleep(600);
      text = await page.evaluate(() => document.body.innerText);
      assert(!text.includes("查看任务详情"), "再次点击后没有收起任务详情");
    });

    /* ---------------------------------------------------------- N5 无距离数字 */
    await check("N5 地图页不显示距离数字", async () => {
      const text = await page.evaluate(() => {
        // innerText 会把 Leaflet 自己的界面文本也算进来：圆形 SVG 的 <title>、
        // 比例尺控件（"100 m"）和版权行。它们都不是玩家到目标的距离读数。
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const parts = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (!parent) continue;
          if (parent.closest("svg")) continue;
          if (parent.closest(".leaflet-control")) continue;
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const chunk = (node.textContent ?? "").trim();
          if (chunk) parts.push(chunk);
        }
        return parts.join("\n");
      });
      const suspicious = /\d+(\.\d+)?\s*(km|m)\b/u.test(text);
      assert(!suspicious, `地图页仍在显示距离读数：\n${text.slice(0, 500)}`);
      assert(!/距离/.test(text), `文案里仍有距离表述：\n${text.slice(0, 500)}`);
      // 卡片本身必须没有读数，只有方向说明。
      assert(/蓝色箭头指向目标/.test(text), `任务卡缺少方向说明：\n${text.slice(0, 400)}`);
    });

    /* ---------------------------------------------------------- N6 玩家光标 */
    await check("N6 玩家光标可见（带脉冲环，模拟器模式下已定位）", async () => {
      const info = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll(".leaflet-marker-icon"));
        const visible = nodes.filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.opacity !== "0";
        });
        // 玩家光标带脉冲环（player-marker__pulse），场景标记没有。
        const player = visible.find((node) => node.querySelector(".player-marker__pulse"));
        return {
          count: visible.length,
          hasPlayer: Boolean(player),
          label: player?.getAttribute("title") ?? player?.getAttribute("aria-label") ?? "",
        };
      });
      assert(info.count > 0, "地图上没有可见的标记");
      assert(info.hasPlayer, "玩家光标（带脉冲环）未渲染");
      // 朝向指针只在拿到指南针 heading 时出现；桌面无头浏览器没有磁力计，
      // 因此这里不做硬性断言，只记录。
      console.log(`      · 玩家光标存在，朝向指针=${info.label || "无标题"}`);
    });

    /* ---------------------------------------------------------- N7 指南针说明 */
    await check("N7 指南针按钮说明黄色/蓝色箭头含义", async () => {
      const title = await page.evaluate(() => {
        const button = document.querySelector("button[title*='箭头'], button[aria-label*='指南针']");
        return button?.getAttribute("title") ?? button?.getAttribute("aria-label") ?? "";
      });
      assert(/黄色箭头/.test(title) && /蓝色箭头/.test(title), `指南针提示不完整：「${title}」`);
    });

    /* ---------------------------------------------------------- N8 往返不崩溃 */
    await check("N8 离开再返回地图页不触发 layerPointToLatLng 崩溃", async () => {
      pageErrors.length = 0;
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(1500);
      await page.goto(`${BASE}/map`, { waitUntil: "networkidle2" });
      await sleep(2500);
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(2000);
      const crash = pageErrors.filter((error) => /layerPointToLatLng|getBounds/.test(error));
      assert(crash.length === 0, `出现崩溃：\n${crash.join("\n")}`);
    });

    await page.screenshot({ path: path.join(ARTIFACTS, "probe-radar-navigation.png") });

    /* ------------------------------------------------- N9 到达后自动展开详情 */
    await check("N9 到达当前目标后任务详情自动展开", async () => {
      const scenes = await page.evaluate(async () => {
        const res = await fetch("/content/demo-hunt.json");
        const pack = await res.json();
        return pack.scenes.map((scene) => ({
          id: scene.id,
          lat: scene.location.lat,
          lng: scene.location.lng,
        }));
      });
      const target = scenes[0];
      // 先确保处于收起态：导航回 /map（模拟坐标已在 localStorage 里）。
      await page.goto(`${BASE}/map`, { waitUntil: "networkidle2" });
      await sleep(2800);
      const before = await page.evaluate(() => document.body.innerText);
      const collapsedBefore = !before.includes("查看任务详情") && !before.includes("解锁情境");
      assert(collapsedBefore, `到达前任务详情应为收起态：\n${before.slice(0, 400)}`);

      await teleport(page, { lat: target.lat, lng: target.lng }, { settle: 3400 });
      const after = await page.evaluate(() => document.body.innerText);
      const expandedAfter = after.includes("查看任务详情") || after.includes("解锁情境");
      assert(after.includes("蓝色箭头指向目标"), `传送后没有回到地图任务卡：\n${after.slice(0, 400)}`);
      assert(
        expandedAfter,
        `到达目标后详情没有自动展开（到达前收起=${collapsedBefore}）：\n${after.slice(0, 600)}`,
      );
    });

    /* ------------------------------------------------- N10 圆形区域适配不崩溃 */
    await check("N10 圆形区域取景适配，不触发 layerPointToLatLng 崩溃", async () => {
      pageErrors.length = 0;
      await page.goto(`${BASE}/design`, { waitUntil: "networkidle2" });
      await sleep(3500);
      const text = await page.evaluate(() => document.body.innerText);
      assert(/地图|区域/.test(text), `创作页没有渲染地图/区域控件：\n${text.slice(0, 400)}`);
      const crash = pageErrors.filter((error) => /layerPointToLatLng|getBounds/.test(error));
      assert(crash.length === 0, `创作页圆形取景崩溃：\n${crash.join("\n")}`);
      // 地图容器必须真的长出 Leaflet 图层，否则上面的断言是空过。
      const hasTiles = await page.evaluate(() => Boolean(document.querySelector(".leaflet-container .leaflet-tile-pane")));
      assert(hasTiles, "创作页地图容器没有渲染瓦片图层");
    });
  } finally {
    await browser.close();
  }

  const passed = results.filter((item) => item.ok).length;
  const summary = {
    base: BASE,
    ranAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: `${((passed / results.length) * 100).toFixed(1)}%`,
    results,
  };
  writeFileSync(path.join(ARTIFACTS, "probe-radar-navigation.json"), JSON.stringify(summary, null, 2));
  console.log(`\n总计 ${summary.total} 项，通过 ${passed}，失败 ${summary.failed}`);
  process.exit(summary.failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
