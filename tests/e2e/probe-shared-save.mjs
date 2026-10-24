/**
 * 分享游戏入库验收探针（第一批：显式保存到本机游戏库）
 *
 * 覆盖：
 *  S0 分享链接打开后仍可试玩，且不会自动入库（F + 无自动保存）
 *  S1 点击保存 → 显示已保存（A）
 *  S2 本机库读回内容与分享内容逐字节一致（A 读回验证）
 *  S3 刷新后仍识别为已保存，按钮不可重复点击（E/G）
 *  S4 重复保存不产生重复记录（D）
 *  S5 同 ID 不同内容的本机游戏绝不被覆盖（冲突保护）
 *  S6 保存不影响既有玩家进度（H）
 *  S7 保存后仍能正常开始寻宝进入地图（试玩流程不受影响）
 *  S8 全程无脚本错误
 *
 * 运行：E2E_BASE_URL=http://127.0.0.1:3102 node tests/e2e/probe-shared-save.mjs
 * 数据隔离：临时 user-data-dir + qa-shared-* 测试 ID，不接触真实数据。
 */

import puppeteer from "puppeteer-core";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";
const SAVE_PREFIX = "mos-scene-hunt:save:";

mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (m) => process.stdout.write(m + "\n");

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    log(`  ✓ ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    results.push({ name, ok: false, error: msg });
    log(`  ✗ ${name}\n      ${msg}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function until(fn, deadlineMs = 15000, step = 300) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > deadlineMs) return null;
    await sleep(step);
  }
}

/** 构造与 lib/content/share.ts 同格式的自包含分享链接（gzip + base64url）。 */
function buildShareUrl(baseUrl, game) {
  const b64 = gzipSync(Buffer.from(JSON.stringify(game), "utf8"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${baseUrl}/select#hunt=g.${b64}`;
}

/** 与单元测试同构的合法最小游戏包。 */
function makeGame(id, title) {
  return {
    id,
    version: "1.0.0",
    title,
    description: "分享入库探针专用游戏。",
    language: "zh-CN",
    estimatedMinutes: 20,
    startLocation: { lat: 14.584481, lng: 120.9794 },
    entrySceneId: "gate",
    huntArea: {
      center: { lat: 14.584481, lng: 120.9794 },
      radiusMeters: 120,
      shape: "polygon",
      points: [
        { lat: 14.585, lng: 120.979 },
        { lat: 14.585, lng: 120.98 },
        { lat: 14.584, lng: 120.98 },
      ],
      name: "探针区域",
    },
    scenes: [
      {
        id: "gate",
        title: "大门",
        story: "集合点。",
        location: { lat: 14.584481, lng: 120.9794, radius: 15, name: "大门" },
        nextSceneId: "pond",
        challenge: {
          type: "choice",
          question: "这是哪里？",
          options: ["大门", "水池"],
          answer: 0,
        },
        reward: { type: "keyword", title: "起点", value: "门" },
      },
      {
        id: "pond",
        title: "水池",
        story: "第二站。",
        location: { lat: 14.5846, lng: 120.9798, radius: 20, name: "水池" },
        nextSceneId: null,
        challenge: { type: "keyword", question: "写下关键词", answer: "水" },
        reward: { type: "keyword", title: "线索", value: "水" },
      },
    ],
  };
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

/**
 * 完整重新加载目标地址。
 * /select → /select#hunt=… 属于 hash 导航，Next.js 不会重挂载页面，
 * provider 也就不会重新解析分享载荷；必须先离开再进入，模拟真实的新开链接。
 */
async function gotoFresh(page, url) {
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
}

async function clickButtonByText(page, text) {
  const ok = await page.evaluate((t) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (node) => (node.innerText ?? "").trim() === t && !node.disabled,
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  assert(ok, `找不到可点击按钮「${text}」`);
}

const GAME_ID = "qa-shared-save-1";
const game = makeGame(GAME_ID, "验收·分享入库");
const conflicting = makeGame(GAME_ID, "验收·分享入库（本机旧版）");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: mkdtempSync(path.join(tmpdir(), "mos-shared-save-")),
  args: ["--no-sandbox", "--no-proxy-server", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const pageErrors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("net::")) pageErrors.push(m.text().slice(0, 160));
  });

  const authoringRaw = () =>
    page.evaluate((k) => window.localStorage.getItem(k), `${AUTHORING_PREFIX}${GAME_ID}`);

  /* ---------------- S5 前置：预置同 ID 不同内容的本机游戏 ---------------- */
  await gotoFresh(page, `${BASE}/select`);
  await page.evaluate(
    (key, value) => window.localStorage.setItem(key, value),
    `${AUTHORING_PREFIX}${GAME_ID}`,
    JSON.stringify(conflicting),
  );

  await check("S5a 同 ID 不同内容：显示冲突且不覆盖本机游戏", async () => {
    await gotoFresh(page, buildShareUrl(BASE, game));
    await until(async () => (await bodyText(page)).includes("内容不同"), 10000);
    const text = await bodyText(page);
    assert(text.includes("没有保存"), "冲突提示缺少「没有保存」说明");
    assert(text.includes("未保存"), "冲突态按钮未切换为「未保存」");
    const before = await authoringRaw();
    assert(before !== null && JSON.parse(before).title === conflicting.title, "预置本机游戏丢失");
    // 冲突态按钮必须禁用，不允许再次写入
    const disabled = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find((node) =>
        (node.innerText ?? "").includes("未保存"),
      );
      return button ? button.disabled : null;
    });
    assert(disabled === true, "冲突态按钮仍可点击");
  });

  await check("S5b 清理冲突预置后可正常保存（回到主流程前置态）", async () => {
    await page.evaluate((key) => window.localStorage.removeItem(key), `${AUTHORING_PREFIX}${GAME_ID}`);
    assert((await authoringRaw()) === null, "清理失败");
  });

  /* ---------------- S6 前置：预置玩家进度（真实 GameState 形态） ---------------- */
  const progressState = {
    gameId: GAME_ID,
    gameVersion: "1.0.0",
    currentSceneId: null,
    scenes: {
      gate: {
        sceneId: "gate",
        status: "completed",
        attempts: 1,
        grantedRewardIds: ["r-gate"],
        completedAt: 1699999999000,
      },
      pond: { sceneId: "pond", status: "locked", attempts: 0, grantedRewardIds: [] },
    },
    inventory: [{ id: "r-gate", title: "起点", sceneId: "gate" }],
    keywords: [],
    startedAt: 1699999999000,
    lastUpdatedAt: 1699999999000,
  };
  const progress = JSON.stringify({
    schemaVersion: 1,
    savedAt: 1700000000000,
    gameId: GAME_ID,
    gameVersion: "1.0.0",
    state: progressState,
  });
  await page.evaluate(
    (key, value) => window.localStorage.setItem(key, value),
    `${SAVE_PREFIX}${encodeURIComponent(GAME_ID)}`,
    progress,
  );

  await check("S0 打开分享链接可试玩且不自动入库", async () => {
    await gotoFresh(page, buildShareUrl(BASE, game));
    await until(async () => (await bodyText(page)).includes("保存到我的游戏"));
    const text = await bodyText(page);
    assert(text.includes("朋友分享"), "缺少分享来源标注");
    // 已有进度时按钮显示「继续寻宝」，无进度时为「开始寻宝」——两者都算试玩入口可用。
    assert(/开始寻宝|继续寻宝/.test(text), "试玩入口不可用");
    assert(text.includes("大门"), "游戏内容未加载");
    assert((await authoringRaw()) === null, "打开分享链接就自动写入了本机库");
  });

  await check("S1 点击保存后显示已保存", async () => {
    await clickButtonByText(page, "保存到我的游戏");
    const saved = await until(async () => (await bodyText(page)).includes("已保存"), 8000);
    assert(saved, "保存后未出现成功反馈");
  });

  await check("S2 本机库读回内容与分享内容一致", async () => {
    const raw = await authoringRaw();
    assert(raw !== null, "本机库没有该游戏");
    const stored = JSON.parse(raw);
    assert(stored.title === game.title && stored.scenes.length === game.scenes.length, "读回内容不一致");
    assert(raw === JSON.stringify(game), "存储字节与分享内容不一致");
  });

  await check("S4 没有重复记录", async () => {
    const count = await page.evaluate(
      (p, id) =>
        Object.keys(window.localStorage).filter((k) => k === `${p}${id}`).length,
      AUTHORING_PREFIX,
      GAME_ID,
    );
    assert(count === 1, `本机库出现 ${count} 条记录`);
  });

  await check("S6 玩家进度未被重置或覆盖", async () => {
    // 载入游戏时 provider 会按 reconcile 规则重序列化存档（既有行为），
    // 因此按语义断言：已完成的站点、奖励与背包内容必须原样保留。
    const after = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      `${SAVE_PREFIX}${encodeURIComponent(GAME_ID)}`,
    );
    assert(after !== null, "玩家存档被删除");
    const envelope = JSON.parse(after);
    assert(envelope.state.scenes.gate.status === "completed", "已完成站点被重置");
    assert(
      envelope.state.inventory.some((item) => item.id === "r-gate"),
      "背包奖励丢失",
    );
    assert(envelope.state.gameId === GAME_ID, "存档归属被改动");
  });

  await check("S3 刷新后仍识别为已保存且按钮禁用", async () => {
    await page.reload({ waitUntil: "networkidle2" });
    await until(async () => (await bodyText(page)).includes("已保存"), 10000);
    const disabled = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find((node) =>
        (node.innerText ?? "").includes("已保存"),
      );
      return button ? button.disabled : null;
    });
    assert(disabled === true, "已保存态按钮仍可点击");
  });

  await check("S7 保存后仍能正常开始寻宝进入地图", async () => {
    // 既有进度存在时按钮为「继续寻宝」；两个文案都点得到才算入口正常。
    const clicked = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find((node) =>
        /开始寻宝|继续寻宝/.test(node.innerText ?? ""),
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    });
    assert(clicked, "找不到可点击的寻宝入口按钮");
    const onMap = await until(
      async () => (await page.url()).replace(/\/$/, "").endsWith("/map"),
      10000,
    );
    assert(onMap, "点击寻宝入口后未进入 /map");
  });

  await check("S8 全程无脚本错误", async () => {
    const real = pageErrors.filter((e) => !e.includes("favicon"));
    assert(real.length === 0, `页面报错：${real.slice(0, 3).join(" | ")}`);
  });

  // 清理：本探针使用独立临时档案，真实用户数据不受影响；档案目录随临时目录回收。
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
