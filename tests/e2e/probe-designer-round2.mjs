/**
 * 设计者工具第二轮探针：新建空白游戏 + 未保存保护 + 挑战编辑
 *
 * 真实 Chrome 交互验证：
 *   1. 从已有游戏打开设计页，「新建空白游戏」不覆盖原存档，且分配独立 ID
 *   2. 有未保存修改时先询问：取消 / 放弃修改 / 保存并新建 三条路径
 *   3. 挑战题型可切换（选择题 / 关键词题 / 文本题），选项可增删、正确答案可指定
 *   4. 保存后重新加载，题型与答案仍正确，且原存档未被串改
 *   5. 保存的空白游戏出现在游戏中心，并能成为玩家端当前游戏
 *
 * 数据隔离：只使用 probe-existing / 每次新建的 my-hunt-* 测试键，结束后全部清理；
 * 独立临时 user-data-dir，不接触用户真实浏览器配置。
 *
 * 运行：node tests/e2e/probe-designer-round2.mjs（需 E2E_BASE_URL 指向运行中的服务）
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
const SEED_ID = "probe-existing";

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
  title: "探针·现有游戏",
  description: "已有存档，用于检查是否被覆盖",
  version: "0.1.0",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
  entrySceneId: "e1",
  scenes: [
    {
      id: "e1",
      title: "现有站点",
      story: "EXISTING-STORY",
      location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "现有站点" },
      nextSceneId: null,
      challenge: { type: "choice", question: "现有题目？", options: ["甲", "乙"], answer: 1 },
      reward: { type: "keyword", title: "线索", value: "线索" },
    },
  ],
};

async function fieldValue(page, prefix) {
  return page.evaluate((p) => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().startsWith(p),
    );
    const field = label?.querySelector("input, textarea");
    return field ? field.value : null;
  }, prefix);
}

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
  await sleep(150);
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
  await sleep(350);
}

async function clickAria(page, label) {
  const ok = await page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`);
    if (!el || el.disabled) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, label);
  assert(ok, `找不到可点击元素：aria-label=${label}`);
  await sleep(300);
}

/** Snapshot of the challenge editor for the selected scene. */
async function challengeSnapshot(page) {
  return page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="题型"]');
    const pressed = group
      ? Array.from(group.querySelectorAll("button")).find(
          (b) => b.getAttribute("aria-pressed") === "true",
        )
      : null;
    const radios = Array.from(document.querySelectorAll('button[role="radio"]'));
    const checkedAt = radios.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const options = Array.from(document.querySelectorAll('input[aria-label^="选项 "]')).map(
      (i) => i.value,
    );
    const answerLabel = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().startsWith("可接受的答案"),
    );
    const answerField = answerLabel?.querySelector("textarea");
    const idParagraph = Array.from(document.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").includes("存档 ID"),
    );
    return {
      type: pressed ? (pressed.textContent ?? "").trim() : null,
      options,
      correctIndex: checkedAt,
      answer: answerField ? answerField.value : null,
      gameId: idParagraph?.querySelector(".font-mono")?.textContent?.trim() ?? null,
      dialog: Boolean(document.querySelector('[role="alertdialog"]')),
    };
  });
}

async function storedGame(page, id) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, PREFIX + id);
}

const userDataDir = mkdtempSync(path.join(tmpdir(), "mos-probe-round2-"));
const consoleErrors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,960"],
});

let blankId = null;
let savedBlankId = null;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push("console.error: " + m.text());
  });

  log("· 准备：写入一份已有存档并打开它的设计页");
  await page.goto(BASE + "/games", { waitUntil: "networkidle2", timeout: 60000 });
  await page.evaluate((prefix, game) => localStorage.setItem(prefix + game.id, JSON.stringify(game)), PREFIX, SEED_GAME);
  await page.goto(BASE + "/design?game=" + SEED_ID, { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => {
      const label = Array.from(document.querySelectorAll("label")).find((l) =>
        (l.textContent ?? "").trim().startsWith("场景名称"),
      );
      return Boolean(label?.querySelector("input")?.value);
    },
    { timeout: 20000 },
  );

  await check("「新建空白游戏」入口可见", async () => {
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes("新建空白游戏"),
      ),
    );
    assert(found, "页面上没有「新建空白游戏」按钮");
  });

  await check("新建后得到独立 ID 且不覆盖已有存档", async () => {
    await clickByText(page, "button", "新建空白游戏");
    const snap = await challengeSnapshot(page);
    assert(snap.gameId && snap.gameId.startsWith("my-hunt-"), `新游戏 ID 不符：${snap.gameId}`);
    assert(snap.gameId !== SEED_ID, "新游戏复用了已有存档 ID");
    blankId = snap.gameId;
    const title = await fieldValue(page, "游戏名称");
    assert(title === "未命名寻宝", `新游戏标题应为「未命名寻宝」，实际「${title}」`);
    const sceneTitle = await fieldValue(page, "场景名称");
    assert(sceneTitle === "第1站 · 新地点", `默认场景名不符：${sceneTitle}`);
    const stored = await storedGame(page, SEED_ID);
    assert(stored, "已有存档消失了");
    assert(stored.title === SEED_GAME.title, "已有存档标题被改动");
    assert(stored.scenes[0].title === "现有站点", "已有存档场景被改动");
    const leaked = await storedGame(page, blankId);
    assert(!leaked, "新建的空白游戏在保存前就写入了存储");
  });

  await check("有未保存修改时先询问，取消后草稿不丢", async () => {
    await setFieldValue(page, "场景名称", "草稿·未保存");
    await clickByText(page, "button", "新建空白游戏");
    let snap = await challengeSnapshot(page);
    assert(snap.dialog, "未出现未保存提醒");
    const stillThere = await fieldValue(page, "场景名称");
    assert(stillThere === "草稿·未保存", "询问期间草稿被改写");
    await clickByText(page, "button", "取消");
    snap = await challengeSnapshot(page);
    assert(!snap.dialog, "取消后提醒仍在");
    assert((await fieldValue(page, "场景名称")) === "草稿·未保存", "取消后草稿丢失");
  });

  await check("选择「放弃修改」后切换到全新空白游戏", async () => {
    await clickByText(page, "button", "新建空白游戏");
    await clickByText(page, "button", "放弃修改");
    const snap = await challengeSnapshot(page);
    assert(!snap.dialog, "放弃后提醒未关闭");
    assert(snap.gameId !== blankId, "放弃修改没有生成新游戏");
    blankId = snap.gameId;
    assert((await fieldValue(page, "场景名称")) === "第1站 · 新地点", "放弃后仍是旧草稿");
    assert((await fieldValue(page, "游戏名称")) === "未命名寻宝", "放弃后标题未重置");
  });

  await check("空白游戏默认挑战可编辑（选择题 3 选项，正确项为 A）", async () => {
    const snap = await challengeSnapshot(page);
    assert(snap.type === "选择题", `默认题型应为选择题，实际「${snap.type}」`);
    assert(snap.options.length === 3, `默认选项数应为 3，实际 ${snap.options.length}`);
    assert(snap.correctIndex === 0, `默认正确答案应为第 1 项，实际索引 ${snap.correctIndex}`);
  });

  await check("可指定正确答案、增删选项并保持答案指向同一条", async () => {
    await clickAria(page, "把选项 3 设为正确答案");
    let snap = await challengeSnapshot(page);
    assert(snap.correctIndex === 2, `正确答案未切到第 3 项：${snap.correctIndex}`);

    await clickByText(page, "button", "添加选项");
    snap = await challengeSnapshot(page);
    assert(snap.options.length === 4, `添加后选项数应为 4，实际 ${snap.options.length}`);
    assert(snap.correctIndex === 2, "添加选项后正确答案被改动");

    await clickAria(page, "删除选项 4");
    snap = await challengeSnapshot(page);
    assert(snap.options.length === 3, `删除后选项数应为 3，实际 ${snap.options.length}`);

    // Deleting an earlier option must shift the correct index, not the answer text.
    const correctBefore = snap.options[snap.correctIndex];
    await clickAria(page, "删除选项 1");
    snap = await challengeSnapshot(page);
    assert(snap.options.length === 2, `删除后选项数应为 2，实际 ${snap.options.length}`);
    assert(
      snap.options[snap.correctIndex] === correctBefore,
      `正确答案指向变了：${correctBefore} → ${snap.options[snap.correctIndex]}`,
    );
  });

  await check("题型可切换，且不残留旧字段", async () => {
    const initial = await challengeSnapshot(page);
    const correctText = initial.options[initial.correctIndex];
    await clickByText(page, "button", "文本题");
    let snap = await challengeSnapshot(page);
    assert(snap.type === "文本题", `题型未切换：${snap.type}`);
    assert(snap.options.length === 0, "文本题仍显示选择题选项");
    assert(snap.answer === correctText, `文本题答案未继承正确选项：${snap.answer}`);

    await setFieldValue(page, "可接受的答案（每行一个）", "钟楼\n钟塔");
    assert(
      (await fieldValue(page, "可接受的答案（每行一个）")) === "钟楼\n钟塔",
      "多行答案没有写进编辑器",
    );

    await clickByText(page, "button", "关键词题");
    snap = await challengeSnapshot(page);
    assert(snap.type === "关键词题", `题型未切到关键词题：${snap.type}`);
    assert(snap.answer === "钟楼\n钟塔", `答案在切换中丢失：${snap.answer}`);

    await clickByText(page, "button", "选择题");
    snap = await challengeSnapshot(page);
    assert(snap.type === "选择题", `题型未切回选择题：${snap.type}`);
    assert(
      snap.options.join("|") === "钟楼|钟塔",
      `选择题选项未由答案重建：${snap.options.join("|")}`,
    );
    assert(snap.correctIndex === 0, "切换回选择题后正确答案索引异常");

    // 选择题 → 文本题只继承「正确选项」：其余选项是错误项，不应变成可接受答案。
    await clickByText(page, "button", "文本题");
    snap = await challengeSnapshot(page);
    assert(snap.answer === "钟楼", `文本题应只继承正确答案，实际：${snap.answer}`);

    await setFieldValue(page, "可接受的答案（每行一个）", "钟楼\n钟塔");
  });

  await check("保存后写入该游戏自己的存档，原存档不受影响", async () => {
    await setFieldValue(page, "游戏名称", "探针·空白寻宝");
    await clickByText(page, "button", "仅保存到本机");
    await sleep(700);
    savedBlankId = blankId;
    const saved = await storedGame(page, blankId);
    assert(saved, "新游戏没有保存到本机");
    assert(saved.title === "探针·空白寻宝", `保存的标题不符：${saved.title}`);
    assert(saved.id === blankId, "保存的游戏 ID 与草稿不一致");
    const challenge = saved.scenes[0].challenge;
    assert(challenge.type === "text", `保存的题型不符：${challenge.type}`);
    assert(
      Array.isArray(challenge.answer) && challenge.answer.join("|") === "钟楼|钟塔",
      `保存的答案不符：${JSON.stringify(challenge.answer)}`,
    );
    assert(challenge.options === undefined, "文本题仍保存了 options 字段");

    const seed = await storedGame(page, SEED_ID);
    assert(seed.title === SEED_GAME.title, "原存档标题被串改");
    assert(
      seed.scenes[0].challenge.type === "choice" && seed.scenes[0].challenge.answer === 1,
      "原存档挑战被串改",
    );
  });

  await check("「保存并新建」会先保存再开一份新的独立游戏", async () => {
    const firstId = blankId;
    await setFieldValue(page, "场景名称", "第1站 · 已改");
    await clickByText(page, "button", "新建空白游戏");
    await clickByText(page, "button", "保存并新建");
    await sleep(700);
    const saved = await storedGame(page, firstId);
    assert(saved.scenes[0].title === "第1站 · 已改", "「保存并新建」没有先保存当前草稿");
    const snap = await challengeSnapshot(page);
    assert(snap.gameId && snap.gameId !== firstId, "没有切换到新的空白游戏");
    assert(!(await storedGame(page, snap.gameId)), "新空白游戏在保存前就写入了存储");
    blankId = snap.gameId;
  });

  await check("重新打开已保存的游戏，题型与答案仍在", async () => {
    await page.goto(BASE + "/design?game=" + encodeURIComponent(savedBlankId), {
      waitUntil: "networkidle2",
    });
    await page.waitForFunction(
      () => {
        const label = Array.from(document.querySelectorAll("label")).find((l) =>
          (l.textContent ?? "").trim().startsWith("场景名称"),
        );
        return Boolean(label?.querySelector("input")?.value);
      },
      { timeout: 20000 },
    );
    await sleep(300);
    const snap = await challengeSnapshot(page);
    assert((await fieldValue(page, "游戏名称")) === "探针·空白寻宝", "重开后游戏名称不符");
    assert(snap.type === "文本题", `重开后题型不符：${snap.type}`);
    assert(snap.answer === "钟楼\n钟塔", `重开后答案不符：${snap.answer}`);
    assert(snap.options.length === 0, "重开后仍残留选择题选项");
  });

  await check("游戏中心列出新游戏与原游戏", async () => {
    await page.goto(BASE + "/games", { waitUntil: "networkidle2" });
    await sleep(600);
    const text = await page.evaluate(() => document.body.innerText);
    assert(text.includes("探针·现有游戏"), "游戏中心缺少原游戏");
    assert(text.includes("探针·空白寻宝"), "游戏中心缺少新建的游戏");
  });

  await check("玩家端选择页显示的是这款新游戏", async () => {
    await page.goto(BASE + "/select", { waitUntil: "networkidle2" });
    await sleep(500);
    const text = await page.evaluate(() => document.body.innerText);
    assert(text.includes("探针·空白寻宝"), "玩家端未指向刚保存的新游戏");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "probe-designer-round2.png") });

  await check("页面无脚本错误", async () => {
    const fatal = consoleErrors.filter((e) => !e.includes("favicon"));
    assert(fatal.length === 0, "控制台错误：\n" + fatal.slice(0, 5).join("\n"));
  });
} finally {
  try {
    const pages = await browser.pages();
    const page = pages[0];
    if (page) {
      await page.evaluate((prefix) => {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (key === prefix + "probe-existing" || key.startsWith(prefix + "my-hunt-")) {
            doomed.push(key);
          }
        }
        for (const key of doomed) localStorage.removeItem(key);
        localStorage.removeItem("mos-scene-hunt:current-authored-game");
      }, PREFIX);
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
