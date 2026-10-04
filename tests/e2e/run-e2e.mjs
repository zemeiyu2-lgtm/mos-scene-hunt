/**
 * MOS Scene Hunt — 端到端验收套件
 *
 * 目标不是「点一遍页面」，而是把规范 §18 要求的闭环真正跑通：
 *   打开网页 → 允许定位 → 地图上看到自己 → 看到目标 → 进入范围
 *   → 自动解锁 → 完成任务 → 获得奖励 → 解锁下一处 → 刷新后进度仍在
 *
 * 这个文件由 `tests/e2e/run.mjs` 以子进程方式调用，服务器生命周期由父进程持有。
 * 直接运行也可以，前提是 BASE 上已经有服务在监听。
 *
 * 关键约定：
 *   - BASE 必须使用 127.0.0.1 而不是 localhost。在 Chrome 里 "localhost"
 *     与 "127.0.0.1" 是**不同的存储源**，权限授予与 localStorage 都不互通。
 *     早期版本因为混用这两个 host，产生了大量假失败。
 *   - 玩家位置通过写入 localStorage 的 DEV 模拟器设置来「传送」。
 *     每一次传送后必须重新加载页面，并等待 GPS tick（1Hz）+ 持久化防抖（250ms）。
 */

import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const SETTINGS_KEY = "mos-scene-hunt:settings";
const SAVE_KEY = "mos-scene-hunt:active-save";

/** 与 content/demo-hunt.json 保持一致的坐标镜像。 */
const SCENES = {
  /** 起点，距 scene-a 约 97m，刻意落在所有触发半径之外。 */
  start: { lat: 14.584481, lng: 120.9794 },
  sceneA: { lat: 14.583604, lng: 120.9794 },
  sceneB: { lat: 14.5832, lng: 120.979883 },
  sceneC: { lat: 14.582679, lng: 120.9794 },
  /** 距 scene-a 约 120m：在半径外，但仍能在地图上看到目标。 */
  nearAOutside: { lat: 14.582525, lng: 120.9794 },
  /** 远离所有场景，用于验证「不进入就不解锁」。 */
  farAway: { lat: 14.6, lng: 121.0 },
};

/**
 * 应用里真实存在的文案。断言必须引用这些常量，而不是凭印象编造的字符串——
 * 早期版本就是因为断言了「开始挑战」这种并不存在的按钮文案而产生假失败。
 * 这些值与 app/ 下的页面组件保持一一对应。
 */
const COPY = {
  /** quest 页：未完成且在半径内 —— 可进入情境 */
  enterScene: "解锁情境",
  /** quest 页 / scene 页：已进入触发半径 */
  inRange: "已进入任务区域",
  /** quest 页：未在半径内 */
  distanceLabel: "距离目标：",
  /** 状态标签 */
  locked: "未解锁",
  available: "待前往",
  arrived: "已到达",
  completed: "已完成",
  /** quest 页：被前置场景挡住 */
  lockedHint: "后解锁",
  /** scene 页主按钮 */
  startChallenge: "开始任务",
  /** scene 页：已离开半径但情境仍可作答 */
  leftArea: "你已离开任务区域",
  /** 挑战页提交按钮 */
  submit: "提交答案",
  /** 判定失败 */
  wrongAnswer: "答案不正确",
};

/* ------------------------------------------------------------------ 测试框架 */

const results = [];
const shots = [];
/** 内容包在 §F 里被取回，供后续几何不变式断言复用。 */
let pack = null;

/**
 * 独立实现的 Haversine。
 *
 * 刻意不复用 lib/location/geodesy.ts：验收代码如果用被测代码自己的数学，
 * 那么数学写错时两边会一起错，测试就失去意义了。
 */
function haversine(a, b) {
  const R = 6371008.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function log(msg) {
  process.stdout.write(msg + "\n");
}

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    results.push({ name, ok: true, ms });
    log(`  ✓ ${name}`);
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, ms, error: message });
    log(`  ✗ ${name}\n      ${message.split("\n").join("\n      ")}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitFor(fn, { timeout = 10_000, interval = 150, message = "条件未满足" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`${message}（等待 ${timeout}ms 超时）`);
}

/** 按可见文本点击，比选择器更耐受样式调整。 */
async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, needle) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return (
        nodes.find((n) => (n.textContent ?? "").includes(needle) && n.offsetParent !== null) ?? null
      );
    },
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`找不到包含「${text}」的 ${selector}`);
  await el.click();
  await handle.dispose();
}

/**
 * DEV 模拟器传送。
 *
 * settings 里记录着模拟坐标，应用启动时读它。写完必须 reload，
 * 因为 provider 只在挂载时读取一次。
 *
 * 注意字段名：持久化结构是
 *   { simulatorEnabled: boolean, simulatorCoordinate: { lat, lng } | null }
 * 早期版本写的是扁平的 simulatorLat/simulatorLng，那两个键根本不存在，
 * 于是模拟器从未激活、定位永远为空——表现为「等待定位以计算距离…」。
 */
async function teleport(page, coord, { settle = 2200 } = {}) {
  await page.evaluate(
    (key, c) => {
      const raw = localStorage.getItem(key);
      const prev = raw ? JSON.parse(raw) : {};
      const next = {
        ...prev,
        simulatorEnabled: true,
        simulatorCoordinate: { lat: c.lat, lng: c.lng },
      };
      localStorage.setItem(key, JSON.stringify(next));
    },
    SETTINGS_KEY,
    coord,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(settle);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function bodyText(page) {
  return page.evaluate(() => document.body?.innerText ?? "");
}

async function shot(page, name) {
  const file = path.join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
  return file;
}

/** 检查横向溢出——移动端最常见的布局事故。 */
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

  const executablePath = findChrome();
  log(`→ 使用浏览器: ${executablePath}\n`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--window-size=390,844",
    ],
  });

  try {
    /* ---------------------------------------------------- §A 基础与自动启动 */
    log("§A 启动与自动定位");
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await browser
      .defaultBrowserContext()
      .overridePermissions(BASE, ["geolocation", "notifications"]);
    await page.setGeolocation(SCENES.start);

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const homeResponse = await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45_000 });

    await check("首页可访问且为 200", async () => {
      assert(homeResponse, "没有拿到响应");
      assert(homeResponse.status() === 200, `状态码 ${homeResponse.status()}`);
    });

    await check("首页无 JS 运行时错误", async () => {
      assert(pageErrors.length === 0, `pageerror: ${pageErrors.join(" | ")}`);
    });

    await check("PWA manifest 可访问且声明 standalone", async () => {
      const res = await page.goto(`${BASE}/manifest.webmanifest`);
      assert(res && res.status() === 200, `状态码 ${res?.status()}`);
      const json = JSON.parse(await res.text());
      assert(json.display === "standalone", `display=${json.display}`);
      assert(Array.isArray(json.icons) && json.icons.length > 0, "缺少图标");
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
    });

    await check("Service Worker 脚本可访问且注册成功", async () => {
      const res = await fetch(`${BASE}/sw.js`);
      assert(res.status === 200, `sw.js 状态码 ${res.status}`);
      const reg = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return "unsupported";
        const r = await navigator.serviceWorker.getRegistration();
        return r ? "registered" : "none";
      });
      assert(reg !== "unsupported", "浏览器不支持 Service Worker");
      // 注册是异步的，给它一点时间
      if (reg === "none") {
        await waitFor(
          async () =>
            page.evaluate(async () => {
              const r = await navigator.serviceWorker.getRegistration();
              return Boolean(r);
            }),
          { timeout: 8000, message: "Service Worker 未在 8s 内注册" },
        );
      }
    });

    /* 这一条守着一个真实修过的 bug：应用曾经要求用户手动点击「获取我的位置」，
       违反规范 §6「进入游戏即请求定位」。 */
    await check("GPS 自动启动，无需手动点击（规范 §6）", async () => {
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(1200);
      const t = await bodyText(page);
      assert(!t.includes("尚未开始定位"), `仍停留在「尚未开始定位」状态，正文：\n${t.slice(0, 400)}`);
    });

    /* ---------------------------------------------------- §B 地图与标记 */
    log("\n§B 地图与玩家标记");
    // 显式打开模拟器并传送，让这一段的定位来源是确定的，而不是赌真实
    // geolocation 何时返回第一帧。
    await teleport(page, SCENES.start);
    await page.goto(`${BASE}/map`, { waitUntil: "networkidle2" });
    await sleep(1600);

    await check("地图页渲染 Leaflet 瓦片", async () => {
      const tiles = await page.$$eval("img.leaflet-tile", (n) => n.length);
      assert(tiles > 0, `瓦片数量为 ${tiles}`);
    });

    await check("地图渲染 3 个场景标记", async () => {
      const markers = await page.$$eval('[data-role="scene-marker"]', (n) => n.length);
      assert(markers >= 3, `场景标记数量为 ${markers}，期望 ≥3`);
    });

    /* 这条在修复前是失败的：玩家标记依赖 fix，而 fix 依赖模拟器读对字段。 */
    await check("地图显示玩家自己的位置标记", async () => {
      const found = await waitFor(
        async () =>
          page.evaluate(
            () =>
              document.querySelectorAll('[data-role="player-marker"], .player-marker').length > 0,
          ),
        { timeout: 12_000, message: "未找到玩家标记" },
      );
      assert(found, "未找到玩家标记");
    });

    await check("玩家标记为模拟器模式（DEV 模拟器生效）", async () => {
      const simulated = await page.evaluate(
        () => document.querySelectorAll(".player-marker--sim").length > 0,
      );
      assert(simulated, "模拟坐标已写入但标记未标记为 simulated，说明真实 GPS 抢占了");
    });

    await check("地图页不再显示「等待定位」", async () => {
      const t = await bodyText(page);
      assert(
        !t.includes("等待定位"),
        `定位仍未就绪：\n${t.slice(0, 400)}`,
      );
    });

    await check("地图页显示距离读数或已进入提示", async () => {
      const t = await bodyText(page);
      assert(
        t.includes(COPY.distanceLabel) || t.includes(COPY.inRange) || /距离/.test(t),
        `正文中没有距离信息：\n${t.slice(0, 400)}`,
      );
    });

    await shot(page, "02-map");

    /* ---------------------------------------------------- §C 进入半径即解锁 */
    log("\n§C 位置触发（核心闭环）");
    await page.goto(BASE, { waitUntil: "networkidle2" });

    await check("远离所有场景时，scene-a 仍为未解锁或待前往", async () => {
      await teleport(page, SCENES.farAway);
      await page.goto(`${BASE}/quest`, { waitUntil: "networkidle2" });
      await sleep(1000);
      const t = await bodyText(page);
      assert(
        !t.includes(COPY.enterScene),
        `在 ${JSON.stringify(SCENES.farAway)} 却已可进入情境：\n${t.slice(0, 400)}`,
      );
      assert(
        t.includes(COPY.available) || t.includes(COPY.locked),
        `scene-a 状态异常，正文：\n${t.slice(0, 400)}`,
      );
    });

    await check(`距 scene-a 半径外（约 75m）不可进入`, async () => {
      await teleport(page, SCENES.nearAOutside);
      await page.goto(`${BASE}/quest`, { waitUntil: "networkidle2" });
      await sleep(1200);
      const t = await bodyText(page);
      assert(
        !t.includes(COPY.enterScene),
        `在半径外却出现「${COPY.enterScene}」：\n${t.slice(0, 400)}`,
      );
      assert(
        t.includes(COPY.distanceLabel),
        `半径外应显示距离读数，正文：\n${t.slice(0, 400)}`,
      );
    });

    await check("进入 scene-a 半径后自动解锁（规范 §6 核心闭环）", async () => {
      await teleport(page, SCENES.sceneA);
      await page.goto(`${BASE}/quest`, { waitUntil: "networkidle2" });
      await waitFor(
        async () => {
          const t = await bodyText(page);
          return t.includes(COPY.inRange) && t.includes(COPY.enterScene);
        },
        { timeout: 12_000, message: "进入半径后任务列表未显示「已进入任务区域」/「解锁情境」" },
      );
    });

    await check("进入半径后 scene 页可开始任务", async () => {
      await page.goto(`${BASE}/scene/scene-a`, { waitUntil: "networkidle2" });
      await sleep(1200);
      const t = await bodyText(page);
      assert(
        t.includes(COPY.startChallenge),
        `scene 页未出现「${COPY.startChallenge}」，正文：\n${t.slice(0, 500)}`,
      );
      assert(
        !t.includes(COPY.leftArea),
        `在半径内却提示已离开任务区域：\n${t.slice(0, 500)}`,
      );
    });

    await shot(page, "03-arrived");

    /* ---------------------------------------------------- §D 挑战与奖励 */
    log("\n§D 挑战判定与奖励");
    await page.goto(`${BASE}/challenge/scene-a`, { waitUntil: "networkidle2" });
    await sleep(900);

    await check("错误答案不推进进度", async () => {
      // 正确答案是索引 1（"灰色"）。故意先选一个错的。
      await clickByText(page, "button", "红色");
      await clickByText(page, "button", COPY.submit);
      await waitFor(async () => (await bodyText(page)).includes(COPY.wrongAnswer), {
        timeout: 8000,
        message: "错误答案未给出「答案不正确」反馈",
      });

      const state = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
      assert(state, "存档未写入");
      const parsed = JSON.parse(state);
      const progress = parsed?.state?.scenes?.["scene-a"];
      assert(
        !progress || progress.status !== "completed",
        `scene-a 被错误地标记为 completed: ${JSON.stringify(progress)}`,
      );
    });

    await check("错误答案不会跳转到奖励页", async () => {
      assert(
        !page.url().includes("/reward/"),
        `错误答案后 URL 变成了 ${page.url()}`,
      );
    });

    await check("正确答案推进并跳转到奖励页", async () => {
      await page.goto(`${BASE}/challenge/scene-a`, { waitUntil: "networkidle2" });
      await sleep(700);
      await clickByText(page, "button", "灰色");
      await clickByText(page, "button", COPY.submit);
      await waitFor(
        async () => page.url().includes("/reward/"),
        { timeout: 12_000, message: `提交后未跳转奖励页，当前 URL ${page.url()}` },
      );
    });

    await check("奖励页展示关键词奖励「记忆」", async () => {
      await sleep(700);
      const t = await bodyText(page);
      assert(t.includes("记忆"), `奖励页未显示关键词「记忆」：\n${t.slice(0, 400)}`);
    });

    await shot(page, "04-reward");

    await check("完成后 scene-b 被解锁（可在半径内进入）", async () => {
      await teleport(page, SCENES.sceneB);
      await page.goto(`${BASE}/quest`, { waitUntil: "networkidle2" });
      await sleep(1300);
      const t = await bodyText(page);
      assert(
        t.includes(COPY.enterScene),
        `scene-b 未解锁，正文：\n${t.slice(0, 600)}`,
      );
    });

    /* ---------------------------------------------------- §E 持久化 */
    log("\n§E 持久化与去重");
    await check("刷新页面后进度仍在（规范 §17）", async () => {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await sleep(1200);
      const state = await waitFor(
        async () => {
          const raw = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          const p = parsed?.state?.scenes?.["scene-a"];
          return p?.status === "completed" ? parsed : null;
        },
        { timeout: 10_000, message: "刷新后 scene-a 不再是 completed" },
      );
      assert(state, "存档丢失");
    });

    await check("重新进入已完成位置不重复发奖励", async () => {
      const before = await page.evaluate((k) => {
        const parsed = JSON.parse(localStorage.getItem(k));
        return {
          inventory: parsed.state.inventory.length,
          attempts: parsed.state.scenes["scene-a"].attempts,
        };
      }, SAVE_KEY);

      await teleport(page, SCENES.sceneA);
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await sleep(1500);

      const after = await page.evaluate((k) => {
        const parsed = JSON.parse(localStorage.getItem(k));
        return {
          inventory: parsed.state.inventory.length,
          attempts: parsed.state.scenes["scene-a"].attempts,
        };
      }, SAVE_KEY);

      assert(
        after.inventory === before.inventory,
        `背包物品数从 ${before.inventory} 变为 ${after.inventory}（重复发放）`,
      );
    });

    /* ---------------------------------------------------- §F 独立内容路由 */
    log("\n§F 内容分发与安全");
    await check("内容包可从独立路由读取", async () => {
      const res = await fetch(`${BASE}/content/demo-hunt.json`);
      assert(res.status === 200, `状态码 ${res.status}`);
      const json = await res.json();
      assert(json.id === "demo-hunt", `id=${json.id}`);
      assert(Array.isArray(json.scenes) && json.scenes.length === 3, "场景数不为 3");
      pack = json;
    });

    /*
     * 内容几何不变式。
     *
     * 这条守着一个真实踩过的坑：起点曾经落在 scene-a 的 50m 触发半径内，
     * 于是玩家还没移动第一站就已经解锁了——规范 §6「走进半径 → 自动解锁」
     * 的前提被破坏，但界面看上去完全正常，只有算距离才会发现。
     */
    await check("起点落在所有场景的触发半径之外", async () => {
      assert(pack, "内容包未加载");
      const s = pack.startLocation ?? { lat: pack.scenes[0].location.lat, lng: pack.scenes[0].location.lng };
      const offenders = [];
      for (const scene of pack.scenes) {
        const d = haversine(s, scene.location);
        if (d <= (scene.location.radius ?? 50)) {
          offenders.push(`${scene.id}: ${d.toFixed(1)}m ≤ ${scene.location.radius ?? 50}m`);
        }
      }
      assert(offenders.length === 0, `起点已在触发半径内 → ${offenders.join(", ")}`);
    });

    /*
     * 相邻场景的间距。
     *
     * 不变式是：站在当前场景的中心时，不能已经落进下一站的触发半径——
     * 否则玩家刚答完题，下一站就已经替他解锁了，「走进范围才解锁」失去意义。
     * 因此门槛是单边半径，而不是两边半径之和：两者之和会让两站相距 100m 以上
     * 才算通过，那是设计偏好，不是规范要求。
     */
    await check("相邻场景不会互相落入对方半径", async () => {
      assert(pack, "内容包未加载");
      const offenders = [];
      for (let i = 0; i < pack.scenes.length - 1; i++) {
        const a = pack.scenes[i];
        const b = pack.scenes[i + 1];
        const d = haversine(a.location, b.location);
        const need = Math.max(a.location.radius ?? 50, b.location.radius ?? 50);
        if (d <= need) {
          offenders.push(`${a.id}→${b.id}: ${d.toFixed(1)}m ≤ ${need}m`);
        }
      }
      assert(offenders.length === 0, `场景过近，会连锁触发 → ${offenders.join(", ")}`);
    });

    await check("场景坐标互不重合", async () => {
      assert(pack, "内容包未加载");
      const seen = new Map();
      const dupes = [];
      for (const scene of pack.scenes) {
        const key = `${scene.location.lat.toFixed(5)},${scene.location.lng.toFixed(5)}`;
        if (seen.has(key)) dupes.push(`${scene.id} 与 ${seen.get(key)} 坐标相同`);
        seen.set(key, scene.id);
      }
      assert(dupes.length === 0, dupes.join("; "));
    });

    await check("场景链的 nextSceneId 形成单一线性路径", async () => {
      assert(pack, "内容包未加载");
      assert(pack.scenes.length > 0, "没有场景");
      assert(
        pack.scenes[0].id === pack.entrySceneId,
        `entrySceneId=${pack.entrySceneId} 不是第一个场景 ${pack.scenes[0].id}`,
      );
      for (let i = 0; i < pack.scenes.length; i++) {
        const scene = pack.scenes[i];
        const expected = pack.scenes[i + 1]?.id ?? null;
        assert(
          (scene.nextSceneId ?? null) === expected,
          `${scene.id}.nextSceneId=${scene.nextSceneId}，期望 ${expected}`,
        );
      }
    });

    await check("内容路由拒绝路径穿越", async () => {
      for (const bad of ["..%2Fpackage.json", "..%2f..%2fetc%2fpasswd", "nope.txt"]) {
        const res = await fetch(`${BASE}/content/${bad}`);
        assert(res.status >= 400, `「${bad}」返回 ${res.status}，应为 4xx`);
      }
    });

    await check("不存在的内容包返回 404", async () => {
      const res = await fetch(`${BASE}/content/does-not-exist.json`);
      assert(res.status === 404, `状态码 ${res.status}`);
    });

    /* ---------------------------------------------------- §G 离线能力 */
    log("\n§G 离线能力（规范 §13）");

    /*
     * 重要说明：Chrome 的 setOfflineMode 会在网络栈**低于** Service Worker 的
     * 位置切断连接，loopback 也不例外。所以在离线模拟下导航一定得到
     * ERR_INTERNET_DISCONNECTED——这测不出应用是否具备离线能力，只能测出
     * 浏览器把网线拔了。
     *
     * 真正需要证明的是：SW 已注册并接管、外壳与内容包进了缓存、
     * 且缓存的响应确实是可用的 HTTP 响应。下面按这三件事分别验证。
     */

    await check("Service Worker 已注册并接管页面", async () => {
      await page.goto(BASE, { waitUntil: "networkidle2" });
      const state = await waitFor(
        async () =>
          page.evaluate(async () => {
            if (!("serviceWorker" in navigator)) return null;
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg?.active) return null;
            return {
              scope: reg.scope,
              active: reg.active.state,
              controlling: Boolean(navigator.serviceWorker.controller),
            };
          }),
        { timeout: 20_000, message: "Service Worker 未在 20s 内注册并激活" },
      );
      assert(state, "SW 未就绪");
      assert(state.active === "activated", `SW 状态为 ${state.active}，期望 activated`);
    });

    await check("Service Worker 已缓存应用外壳", async () => {
      // 先确保至少一次成功的导航被 SW 写入外壳缓存。
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(2500);

      const shell = await waitFor(
        async () =>
          page.evaluate(async () => {
            if (!window.caches) return null;
            const names = await window.caches.keys();
            if (!names.length) return null;
            const c = await window.caches.open("mos-shell-v1");
            const hit = await c.match("/");
            if (!hit) return null;
            return { buckets: names, status: hit.status };
          }),
        { timeout: 15_000, message: "外壳缓存中没有根路径" },
      );
      assert(shell, "外壳未缓存");
      assert(shell.status === 200, `缓存响应状态码 ${shell.status}`);
    });

    await check("Service Worker 已缓存游戏内容包", async () => {
      const pack = await waitFor(
        async () =>
          page.evaluate(async () => {
            for (const name of await window.caches.keys()) {
              const c = await window.caches.open(name);
              const keys = await c.keys();
              const hit = keys.find((r) => r.url.includes("/content/demo-hunt.json"));
              if (hit) {
                const res = await c.match(hit);
                return { bucket: name, status: res?.status };
              }
            }
            return null;
          }),
        { timeout: 15_000, message: "内容包未被任何缓存桶收录" },
      );
      assert(pack, "内容包未缓存");
      assert(pack.status === 200, `内容包缓存响应状态码 ${pack.status}`);
    });

    await check("缓存中的外壳是一份可解析的 HTML", async () => {
      // 这一步真正验证「离线时玩家看到的是应用而不是浏览器报错页」：
      // 直接从缓存取出响应并解析，不经过网络。
      const ok = await page.evaluate(async () => {
        const c = await window.caches.open("mos-shell-v1");
        const hit = await c.match("/");
        if (!hit) return "未命中";
        const text = await hit.text();
        return text.includes("<div id=\"__next\"") || text.includes("<!DOCTYPE html") || text.includes("<html");
      });
      assert(ok === true, `缓存的 HTML 不完整: ${ok}`);
    });

    /* ---------------------------------------------------- §H 移动端视口 */
    log("\n§H 移动端适配（规范 §17）");
    const routes = ["/", "/map", "/quest", "/bag", "/select"];
    for (const width of [360, 390, 430]) {
      await check(`${width}px 下无横向溢出`, async () => {
        await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
        for (const route of routes) {
          await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2" });
          await sleep(600);
          const { scrollWidth, clientWidth } = await overflow(page);
          assert(
            scrollWidth <= clientWidth + 2,
            `${route} 溢出：scrollWidth=${scrollWidth} clientWidth=${clientWidth}`,
          );
        }
      });
    }

    await check("底部导航在三主页面可用（规范 §12：地图/任务/背包）", async () => {
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      for (const route of ["/map", "/quest", "/bag"]) {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2" });
        await sleep(900);
        const tabs = await page.evaluate(() => {
          const nav = document.querySelector('nav[aria-label="主导航"]');
          if (!nav) return -1;
          return Array.from(nav.querySelectorAll("a")).map((a) => a.textContent?.trim() ?? "");
        });
        assert(tabs !== -1, `${route} 缺少 nav[aria-label="主导航"]`);
        assert(
          Array.isArray(tabs) && tabs.length >= 3,
          `${route} 底部导航项数量为 ${tabs?.length}，期望 3`,
        );
        for (const label of ["地图", "任务", "背包"]) {
          assert(
            tabs.some((t) => t.includes(label)),
            `${route} 底部导航缺少「${label}」，实际：${JSON.stringify(tabs)}`,
          );
        }
      }
    });

    await check("情境流程页不显示底部导航（保持专注）", async () => {
      for (const route of ["/scene/scene-a", "/challenge/scene-a", "/reward/scene-a"]) {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2" });
        await sleep(600);
        const has = await page.evaluate(
          () => Boolean(document.querySelector('nav[aria-label="主导航"]')),
        );
        assert(!has, `${route} 不应显示底部导航`);
      }
    });

    await shot(page, "05-mobile-390");

    /* ---------------------------------------------------- §I 控制台整洁 */
    await check("全程无未捕获的 JS 错误", async () => {
      assert(pageErrors.length === 0, `pageerror: ${pageErrors.join(" | ")}`);
    });

    await check("无 404 资源请求（排除已知探测）", async () => {
      const bad = consoleErrors.filter(
        (e) => /404|Failed to load resource/.test(e) && !/favicon/.test(e),
      );
      assert(bad.length === 0, `控制台报错：\n${bad.join("\n")}`);
    });
  } finally {
    await browser.close();
  }

  /* ---------------------------------------------------- 汇总 */
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const total = results.length;

  const summary = {
    base: BASE,
    ranAt: new Date().toISOString(),
    total,
    passed,
    failed: failed.length,
    passRate: total ? `${((passed / total) * 100).toFixed(1)}%` : "0%",
    results,
    screenshots: shots,
  };
  writeFileSync(path.join(ARTIFACTS, "e2e-summary.json"), JSON.stringify(summary, null, 2));

  log(`\n${"─".repeat(60)}`);
  log(`总计 ${total} 项，通过 ${passed}，失败 ${failed.length}`);
  if (failed.length) {
    log("\n失败项：");
    for (const f of failed) log(`  ✗ ${f.name}\n      ${f.error}`);
  }
  log(`\n报告: ${path.join(ARTIFACTS, "e2e-summary.json")}`);
  log(`截图: ${ARTIFACTS}`);

  process.exit(failed.length ? 1 : 0);
}

/* ------------------------------------------------------------------ 环境 */

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("找不到 Chrome/Edge 可执行文件，请设置 CHROME_PATH 环境变量。");
}

main().catch((err) => {
  console.error("\n套件崩溃:", err);
  process.exit(1);
});
