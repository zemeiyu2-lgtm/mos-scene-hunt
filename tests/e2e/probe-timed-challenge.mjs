/**
 * 限时挑战 V1.0 探针：在真实浏览器里跑完整计时链路。
 *
 * 覆盖：进入题目即开始计时 / 超时后不能提交 / 超时只判一次 / 重试重新获得完整
 * 时限 / 刷新不重置时钟 / 时限内正常完成 / 已完成题目不再计时 / 未限时题目保持
 * 原有玩法。
 *
 * 用法：node tests/e2e/run-probe.mjs probe-timed-challenge.mjs
 * （需要先有构建产物；run-probe.mjs 会复用或重建 .next）
 */

import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const GAME_ID = "timed-probe";
const AUTHORING_KEY = `mos-scene-hunt:authoring:${GAME_ID}`;
const CURRENT_KEY = "mos-scene-hunt:current-authored-game";
const SAVE_KEY = `mos-scene-hunt:save:${encodeURIComponent(GAME_ID)}`;

/** 8 秒足够人类点击，又让探针不必等太久。 */
const LIMIT_SECONDS = 8;

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGame() {
  const base = { lat: 14.584481, lng: 120.9794, radius: 20 };
  return {
    id: GAME_ID,
    version: "1.0.0",
    title: "限时探针",
    description: "限时挑战验收用的两个场景。",
    language: "zh-CN",
    startLocation: { lat: base.lat, lng: base.lng, name: "起点" },
    entrySceneId: "s1",
    scenes: [
      {
        id: "s1",
        title: "第一站",
        story: "第一站的故事。",
        location: { ...base, name: "第一站" },
        nextSceneId: "s2",
        challenge: {
          type: "choice",
          question: "第一站：限时问题？",
          options: ["甲", "乙", "丙"],
          answer: 0,
          timeLimitSeconds: LIMIT_SECONDS,
        },
        reward: { type: "keyword", title: "第一站线索", value: "one" },
      },
      {
        id: "s2",
        title: "第二站",
        story: "第二站的故事。",
        location: { lat: base.lat + 0.002, lng: base.lng, radius: 20, name: "第二站" },
        nextSceneId: null,
        challenge: {
          type: "choice",
          question: "第二站：不限时问题？",
          options: ["甲", "乙"],
          answer: 0,
        },
        reward: { type: "keyword", title: "第二站线索", value: "two" },
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Page helpers                                                       */
/* ------------------------------------------------------------------ */

async function remainingText(page) {
  return page
    .$eval('[data-role="challenge-remaining"]', (el) => el.textContent.trim())
    .catch(() => null);
}

function clockSeconds(text) {
  if (!text || !/^\d+:\d{2}$/.test(text)) return null;
  const [m, s] = text.split(":").map(Number);
  return m * 60 + s;
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function saveOf(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SAVE_KEY);
}

async function clickByText(page, text) {
  const handle = await page.evaluateHandle((label) => {
    return (
      Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes(label),
      ) ?? null
    );
  }, text);
  const el = handle.asElement();
  assert(el, `找不到按钮「${text}」`);
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await sleep(120);
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function waitForChallenge(page) {
  await page.waitForSelector('[data-role="challenge-timer"], [data-role="challenge-expired"], #answer-input, .choice-card', {
    timeout: 15000,
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

  // ---------- 0. 干净起点：写入限时探针包 ----------
  await page.goto(`${BASE}/select`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (authKey, currentKey, gameId, game) => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("mos-scene-hunt:save:") || k.startsWith("mos-scene-hunt:authoring:")) {
          localStorage.removeItem(k);
        }
      }
      localStorage.removeItem("mos-scene-hunt:current-authored-game");
      localStorage.setItem(authKey, JSON.stringify(game));
      localStorage.setItem(currentKey, gameId);
    },
    AUTHORING_KEY,
    CURRENT_KEY,
    GAME_ID,
    buildGame(),
  );

  // ---------- 1. 进入题目即开始计时 ----------
  await page.goto(`${BASE}/challenge/s1`, { waitUntil: "domcontentloaded" });
  await waitForChallenge(page);
  await sleep(600);

  await check("1. 限时题目进入后立即显示倒计时（第 1 次尝试）", async () => {
    const t = await bodyText(page);
    assert(t.includes("限时作答"), `没有倒计时条：${t.slice(0, 300)}`);
    assert(t.includes("第 1 次尝试"), `没有显示第 1 次尝试：${t.slice(0, 300)}`);
    const secs = clockSeconds(await remainingText(page));
    assert(secs !== null, "剩余时间未渲染成 m:ss");
    assert(secs <= LIMIT_SECONDS && secs >= LIMIT_SECONDS - 3, `初始剩余 ${secs}s 不接近 ${LIMIT_SECONDS}s`);
  });

  const initialRemaining = clockSeconds(await remainingText(page));

  await check("2. 计时来自状态而不是每次渲染重置", async () => {
    await sleep(2200);
    const later = clockSeconds(await remainingText(page));
    assert(later !== null && later < initialRemaining, `剩余时间没有递减：${initialRemaining} -> ${later}`);
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "timed-01-running.png") });

  // ---------- 2. 超时 ----------
  await check("3. 到点后出现超时提示与重试入口", async () => {
    await page.waitForSelector('[data-role="challenge-expired"]', { timeout: LIMIT_SECONDS * 1000 + 6000 });
    const t = await bodyText(page);
    assert(t.includes("时间到"), `没有超时提示：${t.slice(0, 300)}`);
    assert(t.includes("重试"), "没有重试入口");
  });

  await check("4. 超时后不能再提交本次作答", async () => {
    const disabled = await page.evaluate(() => {
      const notFound = [];
      const buttons = Array.from(document.querySelectorAll("button"));
      const submit = buttons.find((b) => (b.textContent ?? "").trim() === "已超时");
      if (!submit) notFound.push("提交按钮文案未变成「已超时」");
      else if (!submit.disabled) notFound.push("提交按钮仍可点击");
      const options = Array.from(document.querySelectorAll(".choice-card"));
      if (options.length === 0) notFound.push("找不到选项");
      else if (!options.every((b) => b.disabled)) notFound.push("超时后选项仍可点击");
      return notFound;
    });
    assert(disabled.length === 0, disabled.join("；"));
  });

  await check("5. 存档记录了这次失败尝试，且没有发放奖励", async () => {
    await sleep(600); // 存档写入有 250ms 防抖
    const env = await saveOf(page);
    assert(env?.state, "没有存档");
    const progress = env.state.scenes.s1;
    assert(progress.status === "challenging", `状态应为 challenging，实际 ${progress.status}`);
    assert(progress.attempts === 1, `失败次数应为 1，实际 ${progress.attempts}`);
    assert(typeof progress.timedOutAt === "number", "没有记录超时时刻");
    assert(progress.attemptStartedAt === undefined, "超时后不应仍保留计时起点");
    assert((env.state.inventory ?? []).length === 0, "超时不应发放任何奖励");
    assert((env.state.scenes.s2?.status ?? "locked") !== "completed", "超时不应推进下一站");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "timed-02-expired.png") });

  // ---------- 3. 重试 ----------
  await check("6. 重试重新获得完整时限（第 2 次尝试）", async () => {
    await clickByText(page, "重试");
    await page.waitForSelector('[data-role="challenge-timer"]', { timeout: 5000 });
    await sleep(500);
    const t = await bodyText(page);
    assert(t.includes("第 2 次尝试"), `重试后没有进入第 2 次尝试：${t.slice(0, 300)}`);
    const secs = clockSeconds(await remainingText(page));
    assert(secs !== null && secs >= LIMIT_SECONDS - 2, `重试后剩余 ${secs}s，没有重新计满 ${LIMIT_SECONDS}s`);
  });

  await check("7. 重试清空了上一轮的选择，旧状态没有带进新尝试", async () => {
    const pressed = await page.$$eval(".choice-card", (nodes) =>
      nodes.map((n) => n.getAttribute("aria-pressed")),
    );
    assert(pressed.every((v) => v === "false"), `上一轮的选项仍处于选中态：${pressed.join(",")}`);
  });

  // ---------- 4. 刷新 ----------
  await sleep(1200);
  const beforeReload = clockSeconds(await remainingText(page));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForChallenge(page);
  await sleep(600);

  await check("8. 刷新后继续原来的计时，不会获得额外时间", async () => {
    const after = clockSeconds(await remainingText(page));
    assert(beforeReload !== null && after !== null, "刷新前后都无法读取剩余时间");
    assert(after <= beforeReload, `刷新后剩余时间变多了：${beforeReload}s -> ${after}s`);
    const t = await bodyText(page);
    assert(t.includes("第 2 次尝试"), `刷新后丢失了尝试次数：${t.slice(0, 300)}`);
  });

  // ---------- 5. 时限内完成 ----------
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_KEY);
  await page.goto(`${BASE}/challenge/s1`, { waitUntil: "domcontentloaded" });
  await waitForChallenge(page);
  await sleep(500);

  await check("9. 时限内答对：正常完成并停止计时", async () => {
    const secs = clockSeconds(await remainingText(page));
    assert(secs !== null && secs >= 5, `新尝试没有拿到完整时限：${secs}s`);
    await page.click(".choice-card");
    await sleep(150);
    await clickByText(page, "提交答案");
    await page.waitForFunction(() => location.pathname.startsWith("/reward/"), { timeout: 8000 });
    assert(page.url().includes("/reward/s1"), `未进入奖励页：${page.url()}`);
  });

  await check("10. 已完成的限时题目不再计时，也不会重复发奖", async () => {
    await page.goto(`${BASE}/challenge/s1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("你已完成这个任务"), {
      timeout: 15000,
    });
    const t = await bodyText(page);
    assert(t.includes("你已完成这个任务"), `已完成状态没有生效：${t.slice(0, 300)}`);
    assert(!t.includes("限时作答"), "已完成的题目仍在计时");
    const env = await saveOf(page);
    const rewards = (env?.state?.inventory ?? []).filter((i) => i.sceneId === "s1");
    assert(rewards.length === 1, `奖励数量应为 1，实际 ${rewards.length}`);
  });

  // ---------- 6. 未限时题目 ----------
  await check("11. 未设置时限的题目保持原有玩法（无倒计时、可正常提交）", async () => {
    await page.goto(`${BASE}/challenge/s2`, { waitUntil: "domcontentloaded" });
    await waitForChallenge(page);
    await sleep(500);
    const t = await bodyText(page);
    assert(!t.includes("限时作答"), `未限时题目出现了倒计时：${t.slice(0, 300)}`);
    assert(!t.includes("时间到"), "未限时题目出现了超时提示");
    await page.click(".choice-card");
    await sleep(150);
    await clickByText(page, "提交答案");
    await page.waitForFunction(() => location.pathname.startsWith("/reward/"), { timeout: 8000 });
    assert(page.url().includes("/reward/s2"), `未限时题目未正常完成：${page.url()}`);
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "timed-03-untimed.png") });

  await check("12. 全程无页面级 JS 错误", async () => {
    assert(errors.length === 0, errors.slice(0, 3).join(" | "));
  });
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
log(`\n探针结果：${results.length} 项，通过 ${passed}，失败 ${results.length - passed}`);
if (passed !== results.length) process.exitCode = 1;
