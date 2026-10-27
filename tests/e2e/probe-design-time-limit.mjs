/**
 * 一次性探针：验证 /design 的「限时（秒）」配置在真实浏览器里可用。
 *   node tests/e2e/run-probe.mjs probe-design-time-limit.mjs
 *
 * 覆盖单测覆盖不到的部分：输入框是否真的渲染、输入是否写进本机存档、
 * 重新打开是否回显、非法值是否被拦下（不写脏数据）。
 */

import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const GAME_ID = "time-probe";
const LIMIT_INPUT = 'input[aria-label="限时秒数"]';

mkdirSync(ARTIFACTS, { recursive: true });

const results = [];
const errors = [];
const log = (m) => process.stdout.write(m + "\n");

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PACK = {
  id: GAME_ID,
  language: "zh-CN",
  title: "限时配置探针",
  description: "探针用游戏",
  version: "0.1.0",
  estimatedMinutes: 15,
  difficulty: "easy",
  startLocation: { lat: 14.5832, lng: 120.9794, radius: 30, name: "起点" },
  huntArea: { center: { lat: 14.5832, lng: 120.9794 }, radiusMeters: 350, shape: "circle", name: "区域" },
  entrySceneId: "t-1",
  scenes: [
    {
      id: "t-1",
      title: "第一站",
      story: "故事一",
      location: { lat: 14.5832, lng: 120.9794, radius: 20, name: "点一" },
      nextSceneId: null,
      challenge: { type: "choice", question: "问题一", options: ["A", "B"], answer: 0 },
      reward: { type: "keyword", title: "线索一", value: "线索一" },
    },
  ],
};

async function clickByText(page, text) {
  const clicked = await page.evaluate((needle) => {
    const hit = Array.from(document.querySelectorAll("button")).find((n) =>
      (n.textContent ?? "").includes(needle),
    );
    if (!hit) return false;
    hit.click();
    return true;
  }, text);
  assert(clicked, `找不到包含「${text}」的按钮`);
  await sleep(250);
}

async function limitInputValue(page) {
  const el = await page.$(LIMIT_INPUT);
  if (!el) return null;
  return page.$eval(LIMIT_INPUT, (n) => n.value);
}

async function setLimit(page, text) {
  await page.$eval(LIMIT_INPUT, (el) => {
    el.focus();
    el.select();
  });
  // Typing replaces the selection in one go, so "90" -> "0" is a single change
  // event instead of a transient empty value (which legitimately means 不限时).
  if (text) await page.keyboard.type(String(text), { delay: 40 });
  else await page.keyboard.press("Backspace");
  await sleep(300);
}

async function storedLimit(page) {
  return page.evaluate((gameId) => {
    const raw = window.localStorage.getItem(`mos-scene-hunt:authoring:${gameId}`);
    if (!raw) return "MISSING";
    const game = JSON.parse(raw);
    const scene = game.scenes.find((s) => s.id === "t-1");
    return scene?.challenge?.timeLimitSeconds ?? null;
  }, GAME_ID);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (game) => window.localStorage.setItem(`mos-scene-hunt:authoring:${game.id}`, JSON.stringify(game)),
    PACK,
  );
  await page.goto(`${BASE}/design?game=${GAME_ID}`, { waitUntil: "networkidle2" });
  await sleep(700);

  await check("1. 挑战区块渲染出「限时（秒）」输入框，默认留空", async () => {
    const el = await page.$(LIMIT_INPUT);
    assert(el, "找不到限时输入框");
    const value = await limitInputValue(page);
    assert(value === "", `新题目限时应为空，实际 "${value}"`);
    const body = await page.evaluate(() => document.body.innerText);
    assert(body.includes("限时（秒，留空为不限时）"), "缺少限时字段标签");
  });

  await check("2. 填写 90 后保存到本机，存档写入 timeLimitSeconds", async () => {
    await setLimit(page, "90");
    await clickByText(page, "保存到本机");
    await sleep(600);
    const stored = await storedLimit(page);
    assert(stored === 90, `存档 timeLimitSeconds=${JSON.stringify(stored)}`);
  });

  await check("3. 重新打开（深链）后输入框回显 90", async () => {
    await page.goto(`${BASE}/design?game=${GAME_ID}`, { waitUntil: "networkidle2" });
    await sleep(700);
    const value = await limitInputValue(page);
    assert(value === "90", `回显值应为 "90"，实际 "${value}"`);
    const body = await page.evaluate(() => document.body.innerText);
    assert(body.includes("超时后本次作答作废"), "缺少限时说明文案");
  });

  await check("4. 填 0 时给出错误提示，且不会被保存", async () => {
    await setLimit(page, "0");
    const body = await page.evaluate(() => document.body.innerText);
    assert(body.includes("限时必须大于 0 秒"), `没有错误提示：${body.slice(0, 200)}`);
    await clickByText(page, "保存到本机");
    await sleep(600);
    const stored = await storedLimit(page);
    assert(stored === 90, `非法值被写进了存档：${JSON.stringify(stored)}`);
  });

  await check("5. 清空后保存，字段从存档移除（回到不限时）", async () => {
    await setLimit(page, "");
    await clickByText(page, "保存到本机");
    await sleep(600);
    const stored = await storedLimit(page);
    assert(stored === null, `清空后仍存在 timeLimitSeconds=${JSON.stringify(stored)}`);
  });

  await check("6. 全程无页面级 JS 错误", async () => {
    assert(errors.length === 0, errors.join("\n"));
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "probe-design-time-limit.png"), fullPage: false });
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
log(`\n探针结果：${results.length} 项，通过 ${passed}，失败 ${results.length - passed}`);
if (passed !== results.length) process.exitCode = 1;
