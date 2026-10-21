/**
 * 设计者工具第三轮探针：保存可靠性门槛
 *
 * 真实 Chrome 交互验证：
 *   1. 名称清空后点保存：写入被拒绝，旧存档逐字节未变，界面出现可读的具体问题
 *   2. 改回合法名称后保存：写入成功，提示消失，重新加载仍是新内容
 *   3. 三种挑战类型都能通过门槛保存，并在重载后保持题型
 *   4. 游戏中心列表里仍能看到该游戏（存档没有变成“隐身”）
 *
 * 数据隔离：只使用 probe-save-guard 测试键，结束后清理；独立临时 user-data-dir。
 * 运行：E2E_BASE_URL=http://127.0.0.1:3102 node tests/e2e/probe-save-guard.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const PREFIX = "mos-scene-hunt:authoring:";
const SEED_ID = "probe-save-guard";

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
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, error: msg });
    log(`  ✗ ${name}\n      ${msg}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const SEED_GAME = {
  id: SEED_ID,
  language: "zh-CN",
  title: "探针·保存门槛",
  description: "用于验证保存校验的测试游戏",
  version: "0.1.0",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
  entrySceneId: "g1",
  scenes: [
    {
      id: "g1",
      title: "门槛站点",
      story: "GUARD-STORY",
      location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "门槛站点" },
      nextSceneId: null,
      challenge: { type: "choice", question: "保存门槛问题？", options: ["甲", "乙"], answer: 1 },
      reward: { type: "keyword", title: "线索", value: "线索" },
    },
  ],
};

async function setFieldValue(page, prefix, value) {
  const ok = await page.evaluate(
    (p, v) => {
      const label = Array.from(document.querySelectorAll("label")).find((l) =>
        (l.textContent ?? "").trim().startsWith(p),
      );
      const field = label?.querySelector("input, textarea");
      if (!field) return false;
      const proto =
        field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(field, v);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    prefix,
    value,
  );
  assert(ok, `找不到字段：${prefix}`);
  await sleep(200);
}

async function clickByText(page, selector, needle) {
  const info = await page.evaluate(
    (sel, text) => {
      const el = Array.from(document.querySelectorAll(sel)).find(
        (n) => (n.textContent ?? "").includes(text) && n.offsetParent !== null && !n.disabled,
      );
      if (!el) return { ok: false };
      el.scrollIntoView({ block: "center" });
      el.click();
      return { ok: true };
    },
    selector,
    needle,
  );
  assert(info.ok, `找不到可点击元素：${selector} 含「${needle}」`);
  await sleep(400);
}

const raw = (page) =>
  page.evaluate((k) => window.localStorage.getItem(k), `${PREFIX}${SEED_ID}`);

const alertText = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[role="alert"]');
    return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
  });

const parsed = async (page) => {
  const value = await raw(page);
  return value ? JSON.parse(value) : null;
};

const fieldValue = (page, prefix) =>
  page.evaluate((p) => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().startsWith(p),
    );
    return label?.querySelector("input, textarea")?.value ?? null;
  }, prefix);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: mkdtempSync(path.join(tmpdir(), "mos-guard-")),
  args: ["--no-sandbox", "--no-proxy-server"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/games`, { waitUntil: "networkidle2" });
  await page.evaluate(
    (k, value) => window.localStorage.setItem(k, value),
    `${PREFIX}${SEED_ID}`,
    JSON.stringify(SEED_GAME),
  );
  await page.goto(`${BASE}/design?game=${SEED_ID}`, { waitUntil: "networkidle2" });
  await sleep(2000);

  const before = await raw(page);

  await check("进入编辑器时载入的是草稿游戏", async () => {
    const title = await fieldValue(page, "游戏名称");
    assert(title === SEED_GAME.title, `编辑器名称是「${title}」`);
    const body = await page.evaluate(() => document.body.innerText);
    assert(body.includes("门槛站点"), "场景列表没有载入草稿游戏");
  });

  await check("名称清空后保存被拒绝，旧存档逐字节未变", async () => {
    await setFieldValue(page, "游戏名称", "");
    await clickByText(page, "button", "保存到本机");
    await sleep(300);
    const after = await raw(page);
    assert(after === before, "无效数据仍然被写入了存档（旧存档被覆盖）");
    const text = await alertText(page);
    assert(text, "界面没有出现任何错误提示");
    assert(text.includes("游戏名称"), `提示没有指出问题位置：${text}`);
    assert(!text.includes("存储空间"), `提示把校验失败误报成存储问题：${text}`);
    log(`      提示原文：${text.slice(0, 120)}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "save-guard-rejected.png") });
  });

  await check("修正名称后保存成功，提示消失", async () => {
    await setFieldValue(page, "游戏名称", "探针·保存门槛（已改）");
    await clickByText(page, "button", "保存到本机");
    await sleep(400);
    assert((await alertText(page)) === null, "保存成功后错误提示仍然存在");
    const game = await parsed(page);
    assert(game?.title === "探针·保存门槛（已改）", `存档标题未更新：${game?.title}`);
  });

  await check("重新加载后仍是修改后的内容（没有被丢弃）", async () => {
    await page.goto(`${BASE}/design?game=${SEED_ID}`, { waitUntil: "networkidle2" });
    await sleep(2000);
    const title = await fieldValue(page, "游戏名称");
    assert(title === "探针·保存门槛（已改）", `重新加载后名称是「${title}」`);
    const body = await page.evaluate(() => document.body.innerText);
    assert(body.includes("门槛站点"), "重新加载后场景丢失");
  });

  await check("三种挑战类型都能保存，重载后题型保持", async () => {
    for (const [label, type] of [
      ["文本题", "text"],
      ["关键词题", "keyword"],
      ["选择题", "choice"],
    ]) {
      await clickByText(page, "button", label);
      if (type !== "choice") {
        await setFieldValue(page, "可接受的答案", type === "text" ? "钟楼" : "钟楼\n钟塔");
      }
      await clickByText(page, "button", "保存到本机");
      await sleep(300);
      const game = await parsed(page);
      const savedType = game?.scenes?.[0]?.challenge?.type;
      assert(savedType === type, `切到${label}后存档题型是 ${savedType}，提示：${await alertText(page)}`);
    }
    await page.goto(`${BASE}/design?game=${SEED_ID}`, { waitUntil: "networkidle2" });
    await sleep(1800);
    const game = await parsed(page);
    assert(game?.scenes?.[0]?.challenge?.type === "choice", "重载后题型不是选择题");
  });

  await check("游戏中心仍能看到该游戏", async () => {
    await page.goto(`${BASE}/games`, { waitUntil: "networkidle2" });
    await sleep(1200);
    const body = await page.evaluate(() => document.body.innerText);
    assert(body.includes("探针·保存门槛（已改）"), "游戏没有出现在游戏中心列表");
  });

  await check("无脚本错误", async () => {
    assert(pageErrors.length === 0, `页面报错：${pageErrors.join(" | ")}`);
  });

  await page.evaluate((k) => window.localStorage.removeItem(k), `${PREFIX}${SEED_ID}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
