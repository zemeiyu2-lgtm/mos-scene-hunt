/**
 * 深链接验收探针：「游戏中心 → 继续设计 → /design?game=<id>」
 *
 * 用真实 Chrome 走完整交互链，验证：
 *   1. 本机游戏列表同时出现两款测试游戏
 *   2. 点「继续设计」后编辑器载入的是被选中的那一款（标题 / 场景 / 故事）
 *   3. 修改场景名并「仅保存到本机」后，写入的是该游戏自己的存档键
 *   4. 另一款测试游戏的内容没有被串改
 *   5. 返回游戏中心再次打开，内容仍是刚才保存的那一款
 *
 * 数据隔离：只写入 probe-alpha / probe-beta 两个测试键，结束时删除；
 * 使用独立的临时 user-data-dir，绝不接触用户真实浏览器配置。
 *
 * 运行：node tests/e2e/probe-design-deeplink.mjs（需 E2E_BASE_URL 指向运行中的服务）
 */

import puppeteer from "puppeteer-core";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const PREFIX = "mos-scene-hunt:authoring:";

mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const scene = (id, title, story, nextSceneId = null) => ({
  id,
  title,
  story,
  location: { lat: 14.58305, lng: 120.97936, radius: 20, name: title },
  nextSceneId,
  challenge: { type: "choice", question: "探针问题？", options: ["甲", "乙"], answer: 0 },
  reward: { type: "keyword", title: "线索", value: "线索" },
});

const game = (id, title, description, scenes) => ({
  id,
  language: "zh-CN",
  title,
  description,
  version: "0.1.0",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "探针起点" },
  entrySceneId: scenes[0].id,
  scenes,
});

const GAMES = [
  game("probe-alpha", "探针·甲", "甲款测试游戏", [scene("a1", "甲站", "ALPHA-STORY")]),
  game("probe-beta", "探针·乙", "乙款测试游戏", [
    scene("b1", "乙站一", "BETA-STORY-1", "b2"),
    scene("b2", "乙站二", "BETA-STORY-2"),
  ]),
];

/** Read the value of the input/textarea inside the <label> whose text starts with `prefix`. */
async function fieldValue(page, prefix) {
  return page.evaluate((p) => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().startsWith(p),
    );
    if (!label) return null;
    const field = label.querySelector("input, textarea");
    return field ? field.value : null;
  }, prefix);
}

/** React-safe controlled-input write (native setter + input event). */
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
  await sleep(120);
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
  await sleep(320);
}

/** Click 「继续设计」 inside the 本机游戏 card that carries `title`. */
async function continueDesign(page, title) {
  const info = await page.evaluate((t) => {
    const card = Array.from(document.querySelectorAll("article")).find((a) =>
      (a.textContent ?? "").includes(t),
    );
    if (!card) return { ok: false, why: "card" };
    const link = Array.from(card.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").includes("继续设计"),
    );
    if (!link) return { ok: false, why: "link" };
    link.scrollIntoView({ block: "center" });
    link.click();
    return { ok: true };
  }, title);
  assert(info.ok, `游戏卡片「${title}」的继续设计入口缺失（${info.why}）`);
  await page.waitForFunction(() => window.location.pathname === "/design", { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const label = Array.from(document.querySelectorAll("label")).find((l) =>
        (l.textContent ?? "").trim().startsWith("场景名称"),
      );
      return Boolean(label?.querySelector("input")?.value);
    },
    { timeout: 20000 },
  );
  await sleep(250);
}

const userDataDir = mkdtempSync(path.join(tmpdir(), "mos-probe-deeplink-"));
const consoleErrors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,960"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push("console.error: " + m.text());
  });

  log("· 打开游戏中心");
  await page.goto(BASE + "/games", { waitUntil: "networkidle2", timeout: 60000 });

  log("· 写入两款测试游戏到本机存档");
  await page.evaluate(
    (prefix, games) => {
      for (const g of games) localStorage.setItem(prefix + g.id, JSON.stringify(g));
    },
    PREFIX,
    GAMES,
  );
  await page.reload({ waitUntil: "networkidle2" });

  await check("游戏中心列出两款测试游戏", async () => {
    await page.waitForFunction(
      () => document.body.innerText.includes("探针·甲") && document.body.innerText.includes("探针·乙"),
      { timeout: 15000 },
    );
    const text = await page.evaluate(() => document.body.innerText);
    assert(text.includes("探针·甲") && text.includes("探针·乙"), "本机游戏列表缺少测试游戏");
  });

  await check("点「继续设计」（乙）后载入乙款内容", async () => {
    await continueDesign(page, "探针·乙");
    const url = page.url();
    assert(url.includes("/design?game=probe-beta"), `URL 未带 game 参数：${url}`);
    const title = await fieldValue(page, "场景名称");
    const story = await fieldValue(page, "到达后故事");
    assert(title === "乙站一", `场景名称应为「乙站一」，实际「${title}」`);
    assert(story === "BETA-STORY-1", `故事应为 BETA-STORY-1，实际「${story}」`);
    const chips = await page.evaluate(() => document.body.innerText);
    assert(chips.includes("乙站二"), "场景列表缺少乙款第二站，可能载入了别的游戏");
    assert(!chips.includes("甲站"), "编辑器中出现了甲款场景，说明串包");
  });

  await check("修改并保存后写入乙款自己的存档键", async () => {
    await setFieldValue(page, "场景名称", "乙站一·改");
    await clickByText(page, "button", "仅保存到本机");
    await sleep(600);
    const stored = await page.evaluate((prefix) => {
      const read = (k) => JSON.parse(localStorage.getItem(prefix + k) ?? "null");
      return { alpha: read("probe-alpha"), beta: read("probe-beta") };
    }, PREFIX);
    assert(stored.beta, "乙款存档丢失");
    assert(
      stored.beta.scenes[0].title === "乙站一·改",
      `乙款首站未更新：${stored.beta.scenes[0].title}`,
    );
    assert(stored.beta.title === "探针·乙", "乙款游戏标题被改动");
    assert(
      stored.beta.scenes[1].title === "乙站二",
      "乙款第二站被意外修改，保存目标可能错位",
    );
    assert(stored.alpha.scenes[0].title === "甲站", "甲款内容被串改");
    assert(stored.alpha.title === "探针·甲", "甲款标题被串改");
  });

  await check("返回游戏中心再次打开，仍是刚保存的乙款", async () => {
    await page.goto(BASE + "/games", { waitUntil: "networkidle2" });
    await sleep(400);
    await continueDesign(page, "探针·乙");
    const title = await fieldValue(page, "场景名称");
    assert(title === "乙站一·改", `重新打开后场景名称为「${title}」，期望「乙站一·改」`);
  });

  await check("切换到甲款继续设计，内容不串到乙款", async () => {
    await page.goto(BASE + "/games", { waitUntil: "networkidle2" });
    await sleep(400);
    await continueDesign(page, "探针·甲");
    const url = page.url();
    assert(url.includes("game=probe-alpha"), `URL 未指向甲款：${url}`);
    const title = await fieldValue(page, "场景名称");
    const story = await fieldValue(page, "到达后故事");
    assert(title === "甲站", `应为「甲站」，实际「${title}」`);
    assert(story === "ALPHA-STORY", `应为 ALPHA-STORY，实际「${story}」`);
    const text = await page.evaluate(() => document.body.innerText);
    assert(!text.includes("乙站一·改"), "甲款编辑器里出现了乙款内容，说明串包");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "probe-design-deeplink.png") });

  await check("页面无脚本错误", async () => {
    const fatal = consoleErrors.filter((e) => !e.includes("favicon") && !/-404/.test(e));
    assert(fatal.length === 0, "控制台错误：\n" + fatal.slice(0, 5).join("\n"));
  });
} finally {
  try {
    const pages = await browser.pages();
    const page = pages[0];
    if (page) {
      await page.evaluate(
        (prefix) => {
          for (const id of ["probe-alpha", "probe-beta"]) localStorage.removeItem(prefix + id);
        },
        PREFIX,
      );
    }
  } catch {
    /* cleanup is best effort */
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
log("");
for (const r of results) log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
