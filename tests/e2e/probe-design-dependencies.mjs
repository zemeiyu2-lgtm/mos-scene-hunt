/**
 * 一次性探针：验证 /design 的「前置场景」配置在真实浏览器里可用，
 * 并且选择结果真的写进本机存档、重新打开后准确回显。
 *   node tests/e2e/run-probe.mjs probe-design-dependencies.mjs
 *
 * 覆盖单测覆盖不到的部分：复选框是否真的渲染出来、点击是否改变草稿、
 * 「仅保存到本机」是否落库、深链重新打开后勾选状态是否恢复。
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const GAME_ID = "dep-probe";
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

/** A minimal valid 3-scene pack the designer can open via ?game=<id>. */
const PACK = {
  id: GAME_ID,
  language: "zh-CN",
  title: "前置场景探针",
  description: "探针用游戏",
  version: "0.1.0",
  estimatedMinutes: 15,
  difficulty: "easy",
  startLocation: { lat: 14.5832, lng: 120.9794, radius: 30, name: "起点" },
  huntArea: { center: { lat: 14.5832, lng: 120.9794 }, radiusMeters: 350, shape: "circle", name: "区域" },
  entrySceneId: "p-1",
  scenes: [
    {
      id: "p-1",
      title: "第一站",
      story: "故事一",
      location: { lat: 14.5832, lng: 120.9794, radius: 20, name: "点一" },
      nextSceneId: "p-2",
      challenge: { type: "choice", question: "问题一", options: ["A", "B"], answer: 0 },
      reward: { type: "keyword", title: "线索一", value: "线索一" },
    },
    {
      id: "p-2",
      title: "第二站",
      story: "故事二",
      location: { lat: 14.5842, lng: 120.9794, radius: 20, name: "点二" },
      nextSceneId: "p-3",
      challenge: { type: "choice", question: "问题二", options: ["A", "B"], answer: 0 },
      reward: { type: "keyword", title: "线索二", value: "线索二" },
    },
    {
      id: "p-3",
      title: "第三站",
      story: "故事三",
      location: { lat: 14.5852, lng: 120.9794, radius: 20, name: "点三" },
      nextSceneId: null,
      challenge: { type: "choice", question: "问题三", options: ["A", "B"], answer: 0 },
      reward: { type: "keyword", title: "线索三", value: "线索三" },
    },
  ],
};

/** Click the first button/chip whose text contains `text`. */
async function clickByText(page, text) {
  const clicked = await page.evaluate((needle) => {
    const nodes = Array.from(document.querySelectorAll("button"));
    const hit = nodes.find((n) => (n.textContent ?? "").includes(needle));
    if (!hit) return false;
    hit.click();
    return true;
  }, text);
  assert(clicked, `找不到包含「${text}」的按钮`);
  await new Promise((r) => setTimeout(r, 250));
}

/** Snapshot of the prerequisite section for the currently selected scene. */
async function requiresSection(page) {
  return page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll("div"));
    const block = blocks.find((d) => d.textContent?.startsWith("前置场景（可选）"));
    if (!block) return null;
    return {
      text: block.textContent ?? "",
      checkboxes: Array.from(block.querySelectorAll("input[type=checkbox]")).map((input) => ({
        checked: input.checked,
        disabled: input.disabled,
        label: input.closest("label")?.textContent ?? "",
      })),
    };
  });
}

async function storedRequires(page) {
  return page.evaluate((gameId) => {
    const raw = window.localStorage.getItem(`mos-scene-hunt:authoring:${gameId}`);
    if (!raw) return "MISSING";
    const game = JSON.parse(raw);
    const scene = game.scenes.find((s) => s.id === "p-3");
    return scene?.requires ?? null;
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
  await new Promise((r) => setTimeout(r, 600));

  await check("设计页打开后存在「前置场景（可选）」区块", async () => {
    const section = await requiresSection(page);
    assert(section, "未找到前置场景区块");
  });

  await check("起点场景提示不能设置前置，且不显示勾选项", async () => {
    const section = await requiresSection(page);
    assert(section, "未找到前置场景区块");
    assert(section.text.includes("起点场景"), `缺少起点说明：${section.text.slice(0, 80)}`);
    assert(section.checkboxes.length === 0, "起点场景不应出现勾选项");
  });

  await check("切换到第三站后列出另外两个场景作为候选", async () => {
    await clickByText(page, "3. 第三站");
    const section = await requiresSection(page);
    assert(section, "未找到前置场景区块");
    assert(section.checkboxes.length === 2, `候选数量应为 2，实际 ${section.checkboxes.length}`);
    assert(section.text.includes("第一站") && section.text.includes("第二站"), "候选项缺少场景名称");
  });

  await check("勾选第一站后显示已选数量", async () => {
    await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("label")).find((l) =>
        (l.textContent ?? "").includes("第一站"),
      );
      label?.querySelector("input[type=checkbox]")?.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    const section = await requiresSection(page);
    assert(section, "未找到前置场景区块");
    assert(
      section.checkboxes.some((c) => c.checked && c.label.includes("第一站")),
      "第一站未被勾选",
    );
    assert(section.text.includes("需先完成 1 个前置场景"), `缺少已选提示：${section.text.slice(0, 120)}`);
  });

  await check("保存到本机后，存档里写入 requires", async () => {
    await clickByText(page, "仅保存到本机");
    await new Promise((r) => setTimeout(r, 500));
    const requires = await storedRequires(page);
    assert(Array.isArray(requires) && requires.join(",") === "p-1", `存档 requires=${JSON.stringify(requires)}`);
  });

  await check("重新打开（深链）后勾选状态准确回显", async () => {
    await page.goto(`${BASE}/design?game=${GAME_ID}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 600));
    await clickByText(page, "3. 第三站");
    const section = await requiresSection(page);
    assert(section, "未找到前置场景区块");
    assert(
      section.checkboxes.some((c) => c.checked && c.label.includes("第一站")),
      "重新打开后第一站的勾选丢失",
    );
  });

  await check("取消勾选并保存后，requires 从存档移除", async () => {
    await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("label")).find((l) =>
        (l.textContent ?? "").includes("第一站"),
      );
      label?.querySelector("input[type=checkbox]")?.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    await clickByText(page, "仅保存到本机");
    await new Promise((r) => setTimeout(r, 500));
    const requires = await storedRequires(page);
    assert(requires === null, `取消后仍存在 requires=${JSON.stringify(requires)}`);
  });

  await check("全程无页面级 JS 错误", async () => {
    assert(errors.length === 0, errors.join("\n"));
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "probe-design-dependencies.png"), fullPage: false });
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
log(`\n探针结果：${results.length} 项，通过 ${passed}，失败 ${results.length - passed}`);
writeFileSync(
  path.join(ARTIFACTS, "probe-design-dependencies.json"),
  JSON.stringify({ base: BASE, results }, null, 2),
);
if (errors.length) log(`页面错误：\n${errors.join("\n")}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
