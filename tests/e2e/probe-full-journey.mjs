/**
 * 完整游戏流程验收探针（设计者 → 存档 → 玩家 → 导出/导入 → 分享）
 *
 * 覆盖：A 创建 / B 保存恢复 / C 玩家全流程（GPS 模拟器驱动，模拟环境） /
 * D 导出导入 / E 分享链接与二维码（浏览器层）。
 *
 * 运行前提：生产构建需 NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1（项目 spec 第 9 节
 * 认可的测试机制），面板在页面上明确标注"模拟定位中 · 非真实位置"。
 * 数据隔离：临时 user-data-dir + 独立测试 ID（qa-journey-*），不接触真实数据。
 * 运行：E2E_BASE_URL=http://127.0.0.1:3102 node tests/e2e/probe-full-journey.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const PREFIX = "mos-scene-hunt:authoring:";

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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: mkdtempSync(path.join(tmpdir(), "mos-journey-")),
  args: ["--no-sandbox", "--no-proxy-server", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const pageErrors = [];
async function watchErrors(page) {
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("net::")) pageErrors.push(m.text().slice(0, 160));
  });
}

/* ---------------- generic UI helpers ---------------- */

async function setFieldValue(page, prefix, value, scopeSelector) {
  const ok = await page.evaluate(
    (p, v, scope) => {
      const root = scope ? document.querySelector(scope) : document;
      const label = Array.from(root.querySelectorAll("label")).find((l) =>
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
    scopeSelector ?? null,
  );
  assert(ok, `找不到字段：${prefix}`);
  await sleep(200);
}

async function fieldValue(page, prefix, scopeSelector) {
  return page.evaluate(
    (p, scope) => {
      const root = scope ? document.querySelector(scope) : document;
      const label = Array.from(root.querySelectorAll("label")).find((l) =>
        (l.textContent ?? "").trim().startsWith(p),
      );
      return label?.querySelector("input, textarea")?.value ?? null;
    },
    prefix,
    scopeSelector ?? null,
  );
}

async function setAriaValue(page, ariaLabel, value) {
  const ok = await page.evaluate(
    (l, v) => {
      const field = document.querySelector(`[aria-label="${l}"]`);
      if (!field) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, v);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    ariaLabel,
    value,
  );
  assert(ok, `找不到 aria-label 字段：${ariaLabel}`);
  await sleep(200);
}

async function clickByText(page, selector, needle) {
  const info = await page.evaluate(
    (sel, text) => {
      const el = Array.from(document.querySelectorAll(sel)).find(
        (n) => (n.textContent ?? "").includes(text) && n.offsetParent !== null && !n.disabled,
      );
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    },
    selector,
    needle,
  );
  assert(info, `找不到可点击元素：${selector} 含「${needle}」`);
  await sleep(400);
}

async function clickAria(page, label) {
  const ok = await page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`);
    if (!el || el.disabled) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, label);
  assert(ok, `找不到 aria-label=${label}`);
  await sleep(300);
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const alertText = (page) =>
  page.evaluate(() => document.querySelector('[role="alert"]')?.innerText ?? null);

/** Open the GPS simulator panel and jump to a scene by its chip label. */
async function simulateAt(page, chipNeedle) {
  const opened = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("GPS 模拟器"),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  assert(opened, "找不到 GPS 模拟器入口（构建未开启 NEXT_PUBLIC_ENABLE_GPS_SIMULATOR?）");
  await sleep(400);
  const enabled = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").includes("启用模拟定位"),
    );
    const box = label?.querySelector('input[type="checkbox"]');
    if (!box) return false;
    if (!box.checked) box.click();
    return true;
  });
  assert(enabled, "找不到「启用模拟定位」开关");
  await sleep(300);
  const clicked = await page.evaluate((needle) => {
    const chip = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim().startsWith(needle),
    );
    if (!chip) return false;
    chip.click();
    return true;
  }, chipNeedle);
  assert(clicked, `模拟器里找不到场景按钮「${chipNeedle}」`);
  await sleep(600);
}

/** 从地图展开任务面板并进入指定场景的故事页。
 *  到达后场景可能处于 arrived（面板给「解锁情境」）或 challenging
 *  （已从到站弹窗进入过挑战，面板给「查看任务详情」→ 任务列表），两条路径都要能走通。 */
async function openSceneStoryFromMap(page, sceneTitle) {
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="展开任务详情"]');
    if (b) b.click();
  });
  await sleep(500);
  const unlock = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((n) =>
      (n.textContent ?? "").includes("解锁情境"),
    );
    if (b) { b.click(); return true; }
    return false;
  });
  if (unlock) {
    await until(async () => (await page.url()).includes("/scene/"), 10000);
  } else {
    await clickByText(page, "a", "查看任务详情");
    await until(async () => (await page.url()).includes("/quest"), 10000);
    await sleep(800);
    await clickByText(page, "a", sceneTitle);
    await until(async () => (await page.url()).includes("/scene/"), 10000);
  }
  await sleep(1200);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 950, deviceScaleFactor: 2 });
  await watchErrors(page);

  /* ================================================== A. 创建游戏 */
  log("— A. 创建游戏 —");

  let gameId = null;
  await check("A1 从创作库进入设计器并新建空白游戏", async () => {
    await page.goto(`${BASE}/create`, { waitUntil: "networkidle2" });
    await sleep(1000);
    assert((await bodyText(page)).includes("创作库"), "创作库未渲染");
    await clickByText(page, "a", "进入设计器");
    await until(async () => (await page.url()).includes("/design"), 10000);
    await sleep(1500);
    await clickByText(page, "button", "＋ 新建空白游戏");
    const text = await until(async () => {
      const t = await bodyText(page);
      const m = t.match(/ID：\s*(my-hunt-[a-z0-9-]+)/);
      return m ? m[1] : null;
    }, 8000);
    assert(text, "点击新建后没有出现空白游戏提示（含 ID）");
    gameId = text;
    log(`      新游戏 ID：${gameId}`);
  });

  await check("A2 设置游戏名称", async () => {
    await setFieldValue(page, "游戏名称", "验收·全流程A线");
    assert((await fieldValue(page, "游戏名称")) === "验收·全流程A线", "名称未生效");
  });

  await check("A3 场景一：标题/故事/坐标/挑战/奖励", async () => {
    await setFieldValue(page, "场景名称", "钟楼广场");
    await setFieldValue(page, "现场名称", "钟楼");
    await setFieldValue(page, "到达后故事", "JOURNEY-STORY-1 站在钟楼下，听整点的钟声。");
    await setFieldValue(page, "纬度", "14.58305");
    await setFieldValue(page, "经度", "120.97936");
    await setFieldValue(page, "问题", "钟楼上有几盏灯？");
    await setAriaValue(page, "选项 1", "三盏");
    await setAriaValue(page, "选项 2", "四盏");
    await setAriaValue(page, "选项 3", "五盏");
    await clickAria(page, "把选项 1 设为正确答案");
    await setFieldValue(page, "奖励名称", "铜钥匙");
    await setFieldValue(page, "奖励内容", "黄铜做的旧钥匙");
  });

  await check("A4 场景二：关键词题与奖励", async () => {
    await clickByText(page, "button", "＋增加场景");
    await sleep(500);
    await clickByText(page, "button", "2. ");
    await sleep(400);
    await setFieldValue(page, "场景名称", "喷泉步道");
    await setFieldValue(page, "现场名称", "喷泉");
    await setFieldValue(page, "到达后故事", "JOURNEY-STORY-2 喷泉的水声盖过了人群。");
    await setFieldValue(page, "纬度", "14.58420");
    await setFieldValue(page, "经度", "120.98010");
    await clickByText(page, "button", "关键词题");
    await setFieldValue(page, "可接受的答案", "喷泉");
    await setFieldValue(page, "奖励名称", "花园徽章");
    await setFieldValue(page, "奖励内容", "喷泉边的徽章");
  });

  await check("A4b 地图上设置圆形游戏区域（发布前置条件）", async () => {
    await clickByText(page, "button", "圆形区域");
    await sleep(600);
    assert(
      (await bodyText(page)).includes("点击地图上任意一点"),
      "进入圆形区域模式后未出现放置提示",
    );
    // 视野不再随编辑自动重取景后，标记可能停在屏幕中央；
    // 逐个尝试离所有场景标记至少 60px 的空白点，点击后确认放置成功再继续。
    let placed = false;
    for (let attempt = 0; attempt < 6 && !placed; attempt++) {
      const spot = await page.evaluate((skip) => {
        const el = document.querySelector(".leaflet-container");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const markers = [...document.querySelectorAll("[data-role='scene-marker']")].map((m) => {
          const b = m.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        });
        const candidates = [];
        for (let fy = 0.15; fy <= 0.85; fy += 0.1) {
          for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
            const p = { x: r.x + r.width * fx, y: r.y + r.height * fy };
            if (markers.every((m) => Math.hypot(m.x - p.x, m.y - p.y) > 60)) candidates.push(p);
          }
        }
        const hitOk = (p) => {
          const e = document.elementFromPoint(p.x, p.y);
          return !!e && !!e.closest(".leaflet-container");
        };
        return candidates.filter(hitOk).slice(skip, skip + 1)[0] ?? null;
      }, attempt);
      if (!spot) continue;
      await page.mouse.click(spot.x, spot.y);
      await sleep(900);
      const text = await bodyText(page);
      placed = text.includes("250m") || !text.includes("点击地图上任意一点");
    }
    assert(placed, "在地图空白处点击后圆形区域仍未放置");
    // 半径预设 250m，覆盖两个相距约 140m 的场景
    await clickByText(page, "button", "250m");
    // 区域保存在编辑草稿中，保存后一起落盘；这里只确认 UI 进入已完成状态
    const text = await bodyText(page);
    assert(!text.includes("点击地图设置圆心"), "圆形区域未被确认");
  });

  await check("A5 保存成功且无校验错误", async () => {
    await clickByText(page, "button", "保存到本机");
    await sleep(500);
    assert((await alertText(page)) === null, `出现错误提示：${await alertText(page)}`);
    const raw = await page.evaluate((k) => window.localStorage.getItem(k), `${PREFIX}${gameId}`);
    assert(raw, "存档键不存在");
    const game = JSON.parse(raw);
    assert(game.title === "验收·全流程A线", `存档标题不符：${game.title}`);
    assert(game.scenes.length === 2, `存档场景数：${game.scenes.length}`);
    assert(game.huntArea?.shape === "circle", "圆形区域未保存");
    assert(game.scenes[0].challenge.answer === 0, "场景一正确答案未保存");
    assert(game.scenes[0].challenge.options.join("|") === "三盏|四盏|五盏", "场景一选项未保存");
    assert(game.scenes[0].nextSceneId === game.scenes[1].id, "场景一未链到场景二");
    assert(game.scenes[1].challenge.type === "keyword", "场景二题型不符");
  });

  /* ================================================== B. 保存恢复 */
  log("— B. 保存后恢复 —");

  await check("B1 游戏中心列出该游戏", async () => {
    await page.goto(`${BASE}/games`, { waitUntil: "networkidle2" });
    await sleep(1200);
    assert((await bodyText(page)).includes("验收·全流程A线"), "游戏中心没有列出该游戏");
  });

  await check("B2 继续设计载入相同内容", async () => {
    await clickByText(page, "a", "继续设计");
    await until(async () => (await page.url()).includes(`game=${gameId}`), 10000);
    await sleep(1800);
    assert((await fieldValue(page, "游戏名称")) === "验收·全流程A线", "名称不符");
    const chips = await bodyText(page);
    assert(chips.includes("钟楼广场") && chips.includes("喷泉步道"), "场景列表不符");
    await clickByText(page, "button", "2. ");
    await sleep(300);
    assert(
      (await fieldValue(page, "到达后故事"))?.includes("JOURNEY-STORY-2"),
      "场景二故事不符",
    );
  });

  await check("B3 刷新后内容仍在", async () => {
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(2000);
    assert((await fieldValue(page, "游戏名称")) === "验收·全流程A线", "刷新后名称丢失");
    assert((await bodyText(page)).includes("喷泉步道"), "刷新后场景丢失");
  });

  /* ================================================== C. 玩家流程（模拟 GPS） */
  log("— C. 玩家流程（GPS 模拟，非真实户外） —");

  await check("C1 玩家入口显示该游戏并可开始", async () => {
    await page.goto(`${BASE}/select`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const text = await bodyText(page);
    assert(text.includes("验收·全流程A线"), "玩家选择页不是这款游戏");
    assert(text.includes("钟楼广场"), "选择页没有场景信息");
    await clickByText(page, "button", "开始寻宝");
    await until(async () => (await page.url()).includes("/map"), 10000);
    await sleep(1500);
  });

  await check("C2 传送抵达：地图弹到站提示，不自动跳转", async () => {
    await simulateAt(page, "1. 钟楼");
    // 到站 UX 变更（feature/arrival-modal-sound）：地图不再自动跳情境页，
    // 而是就地弹出「目标已发现」卡片。保护不变：到达仍然必须在原地给出
    // 明确反馈，并且反馈里必须点名当前目标。
    await until(async () => Boolean(await page.$('[data-testid="arrival-prompt"]')), 12000);
    assert(
      (await page.url()).replace(/\/$/, "").endsWith("/map"),
      `到站后不应离开地图，实际 URL：${page.url()}`,
    );
    const promptText = await page.evaluate(
      () => document.querySelector('[data-testid="arrival-prompt"]')?.innerText ?? "",
    );
    assert(promptText.includes("目标已发现"), "到站弹窗没有标题");
    assert(promptText.includes("钟楼广场"), `到站弹窗没有点名目标：\n${promptText}`);
  });

  await check("C2b 到站弹窗点「查看任务」进入情境页", async () => {
    await clickByText(page, "button", "查看任务");
    await until(async () => (await page.url()).includes("/scene/"), 10000);
    await sleep(1300);
    assert((await bodyText(page)).includes("钟楼"), "情境页看不到场景内容");
  });

  await check("C2c 返回地图后仍标注模拟定位，且不再被弹走", async () => {
    // 模拟定位徽标是安全标注：模拟 fix 生效期间回到地图必须可见，
    // 不得因到站提示丢失 simulated 标志。
    // 情境页的退出按钮是「稍后再做」（自动进挑战链路已随到站弹窗下线）。
    await clickByText(page, "button", "稍后再做");
    await until(async () => (await page.url()).replace(/\/$/, "").endsWith("/map"), 10000);
    await sleep(1200);
    // 同一到站事件已经提示过：回到地图不得再弹一次、更不得把玩家带走。
    const promptAgain = await page.$('[data-testid="arrival-prompt"]');
    assert(!promptAgain, "回到地图后同一到站事件又弹了一次（判重失效）");
    assert((await page.url()).replace(/\/$/, "").endsWith("/map"), "回到地图后被自动弹走");
    assert((await bodyText(page)).includes("模拟定位中"), "地图页没有标注模拟定位");
  });

  await check("C3 展开任务面板→进入情境故事页", async () => {
    await openSceneStoryFromMap(page, "钟楼广场");
    const text = await bodyText(page);
    assert(text.includes("JOURNEY-STORY-1"), "故事一未显示");
    assert(text.includes("钟楼广场"), "场景标题不符");
  });

  await check("C4 选择题作答正确→奖励页", async () => {
    await clickByText(page, "button", "开始任务");
    await until(async () => (await page.url()).includes("/challenge/"), 10000);
    await sleep(1200);
    assert((await bodyText(page)).includes("钟楼上有几盏灯"), "题目未加载");
    await clickByText(page, "button", "三盏");
    await clickByText(page, "button", "提交答案");
    await until(async () => (await page.url()).includes("/reward/"), 12000);
    await sleep(1200);
    const text = await bodyText(page);
    assert(text.includes("铜钥匙"), "奖励一未显示");
  });

  await check("C5 下一站导航回到地图", async () => {
    await clickByText(page, "button", "去寻找下一站");
    await until(async () => (await page.url()).replace(/\/$/, "").endsWith("/map"), 10000);
    await sleep(1200);
  });

  await check("C6 第二站：到站弹窗→故事二→关键词题→完成", async () => {
    await simulateAt(page, "2. 喷泉");
    await until(async () => Boolean(await page.$('[data-testid="arrival-prompt"]')), 12000);
    assert(
      (await page.url()).replace(/\/$/, "").endsWith("/map"),
      `第二站到站后不应离开地图，实际 URL：${page.url()}`,
    );
    const promptText = await page.evaluate(
      () => document.querySelector('[data-testid="arrival-prompt"]')?.innerText ?? "",
    );
    assert(promptText.includes("喷泉步道"), `到站弹窗没有点名第二站：\n${promptText}`);
    await clickByText(page, "button", "查看任务");
    await until(async () => (await page.url()).includes("/scene/"), 10000);
    await sleep(1200);
    assert((await bodyText(page)).includes("JOURNEY-STORY-2"), "故事二未显示");
    await clickByText(page, "button", "开始任务");
    await until(async () => (await page.url()).includes("/challenge/"), 10000);
    await sleep(1000);
    await page.evaluate(() => {
      const el = document.querySelector("#answer-input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "喷泉");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickByText(page, "button", "提交答案");
    await until(async () => (await page.url()).includes("/reward/"), 12000);
    await sleep(1200);
    assert((await bodyText(page)).includes("花园徽章"), "奖励二未显示");
  });

  await check("C7 行李页确认两份奖励（游戏完成）", async () => {
    await page.goto(`${BASE}/bag`, { waitUntil: "networkidle2" });
    await sleep(1200);
    const text = await bodyText(page);
    assert(text.includes("铜钥匙"), "行李里没有钥匙");
    assert(text.includes("花园徽章"), "行李里没有徽章");
  });

  /* ================================================== D. 导出与导入 */
  log("— D. 导出与导入 —");

  const downloadFile = path.join(ARTIFACTS, `${gameId}.json`);
  await check("D1 导出游戏包下载成功且内容完整", async () => {
    await page.goto(`${BASE}/design?game=${gameId}`, { waitUntil: "networkidle2" });
    await sleep(1800);
    const client = await page.createCDPSession();
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: ARTIFACTS,
    });
    await clickByText(page, "button", "导出游戏包");
    const appeared = await until(() => existsSync(downloadFile), 10000, 250);
    assert(appeared, "导出文件未生成");
    await sleep(400);
    const pack = JSON.parse(readFileSync(downloadFile, "utf8"));
    assert(pack.format === "mos-scene-hunt-game", "导出缺少包格式标记");
    assert(pack.game.id === gameId, "导出游戏 ID 不符");
    assert(pack.game.scenes.length === 2, "导出场景数不符");
    assert(pack.game.scenes[0].challenge.options.join("|") === "三盏|四盏|五盏", "导出选项不符");
  });

  await check("D2 导入游戏包：同 ID 不同内容拒绝覆盖（第二批冲突保护）", async () => {
    // 先本地改名保存，再导入旧导出文件：同 ID 不同内容必须拒绝导入，
    // 本机游戏原样保留（覆盖安装语义已在第二批移除，改为显式冲突提示）。
    await setFieldValue(page, "游戏名称", "验收·本地改名");
    await clickByText(page, "button", "保存到本机");
    await sleep(400);
    let raw = await page.evaluate((k) => window.localStorage.getItem(k), `${PREFIX}${gameId}`);
    assert(JSON.parse(raw).title === "验收·本地改名", "改名保存失败");

    const pack = readFileSync(downloadFile, "utf8");
    await clickByText(page, "button", "导入游戏包"); // 展开折叠区
    await sleep(400);
    await page.evaluate(
      (sel) => document.querySelector(sel)?.scrollIntoView({ block: "center" }),
      "#package-import",
    );
    const ok = await page.evaluate((text) => {
      const ta = document.querySelector("#package-import textarea");
      if (!ta) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, pack);
    assert(ok, "找不到导入文本框");
    await clickByText(page, "button", "校验并导入");
    await sleep(700);
    const text = await bodyText(page);
    assert(text.includes("未导入"), "同 ID 不同内容未被拒绝导入");
    assert(text.includes("内容不同"), "冲突提示缺少原因说明");
    raw = await page.evaluate((k) => window.localStorage.getItem(k), `${PREFIX}${gameId}`);
    assert(raw && JSON.parse(raw).title === "验收·本地改名", "本机同 ID 游戏被覆盖");

    // 用作者自己的保存路径把标题改回，后续 D3/E 段继续使用该游戏。
    await setFieldValue(page, "游戏名称", "验收·全流程A线");
    await clickByText(page, "button", "保存到本机");
    await sleep(400);
    raw = await page.evaluate((k) => window.localStorage.getItem(k), `${PREFIX}${gameId}`);
    assert(JSON.parse(raw).title === "验收·全流程A线", "恢复标题失败");
  });

  await check("D2b 导入游戏包：新 ID 按包内 ID 写入，不产生随机 ID", async () => {
    const packObj = JSON.parse(readFileSync(downloadFile, "utf8"));
    packObj.game.id = `${gameId}-imported`;
    const ok = await page.evaluate((text) => {
      const ta = document.querySelector("#package-import textarea");
      if (!ta) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, JSON.stringify(packObj));
    assert(ok, "找不到导入文本框");
    await clickByText(page, "button", "校验并导入");
    await sleep(700);
    assert((await bodyText(page)).includes("已导入「验收·全流程A线」"), "新 ID 导入提示异常");
    const raw = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      `${PREFIX}${gameId}-imported`,
    );
    assert(raw && JSON.parse(raw).id === `${gameId}-imported`, "导入未按包内 ID 写入");
  });

  await check("D3 导入后的游戏可从玩家端进入", async () => {
    await page.goto(`${BASE}/select`, { waitUntil: "networkidle2" });
    await sleep(1500);
    assert((await bodyText(page)).includes("验收·全流程A线"), "导入后玩家端看不到游戏");
  });

  /* ================================================== E. 分享链接与二维码 */
  log("— E. 分享链接与二维码 —");

  let shareUrl = null;
  await check("E1 生成分享链接指向本游戏", async () => {
    await page.goto(`${BASE}/design?game=${gameId}`, { waitUntil: "networkidle2" });
    await sleep(1800);
    await clickByText(page, "button", "发布并分享");
    shareUrl = await until(
      async () =>
        page.evaluate(() => {
          const ps = Array.from(document.querySelectorAll("p"));
          const label = ps.find((p) => (p.textContent ?? "").trim() === "分享链接");
          return label?.nextElementSibling?.innerText ?? null;
        }),
      15000,
    );
    assert(shareUrl, "分享链接未出现");
    assert(shareUrl.includes("/select#hunt="), `链接不是玩家入口：${shareUrl.slice(0, 90)}`);
    const canvas = await page.evaluate(() => Boolean(document.querySelector("canvas")));
    assert(canvas, "二维码画布未渲染");
  });

  await check("E2 链接载荷解码后是本游戏（含 ID 与场景）", async () => {
    const hash = shareUrl.split("#hunt=")[1];
    const [kind, encoded] = hash.split(".");
    const bytes = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const raw =
      kind === "g" ? gunzipSync(bytes).toString("utf8") : Buffer.from(encoded, "base64url").toString("utf8");
    const game = JSON.parse(raw);
    assert(game.id === gameId, "分享载荷 ID 不符");
    assert(game.title === "验收·全流程A线", "分享载荷标题不符");
    assert(game.scenes.length === 2, "分享载荷场景数不符");
  });

  await check("E3 新玩家（全新档案）通过链接进入正确游戏", async () => {
    const context = await browser.createBrowserContext();
    const visitor = await context.newPage();
    await watchErrors(visitor);
    await visitor.setViewport({ width: 430, height: 950 });
    await visitor.goto(shareUrl, { waitUntil: "networkidle2" });
    await sleep(2000);
    const text = await bodyText(visitor);
    assert(text.includes("验收·全流程A线"), "新玩家看到的不是分享的游戏");
    await visitor.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((n) =>
        (n.textContent ?? "").includes("开始寻宝"),
      );
      b?.click();
    });
    await until(async () => (await visitor.url()).includes("/map"), 10000);
    await sleep(1500);
    const mapText = await bodyText(visitor);
    assert(mapText.includes("钟楼"), "新玩家地图上没有该游戏场景");
    const authored = await visitor.evaluate(
      (p) => Object.keys(window.localStorage).filter((k) => k.startsWith(p)).length,
      PREFIX,
    );
    assert(authored === 0, "分享链接不应要求接收方先有本机存档");
    await visitor.close();
    await context.close();
  });

  await check("E4 作者存档未受分享影响", async () => {
    const raw = await page.evaluate((k) => window.localStorage.getItem(k), `${PREFIX}${gameId}`);
    const game = JSON.parse(raw);
    assert(game.title === "验收·全流程A线", "作者存档被改动");
  });

  await check("E5 全程无脚本错误", async () => {
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
