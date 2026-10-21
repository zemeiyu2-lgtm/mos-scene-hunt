/**
 * 第二轮小修探针：分享诊断、默认 15 米、退出回游戏中心并恢复指针、蓝色常显尾巴。
 * 需要 `next start -p 3102`（生产构建）或 E2E_BASE_URL 指向已部署环境。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3102";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: mkdtempSync(join(tmpdir(), "mos-r3-")),
  args: ["--disable-dev-shm-usage", "--no-first-run", "--use-fake-ui-for-media-stream"],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
await browser.defaultBrowserContext().overridePermissions(BASE, ["geolocation"]);
const page = await browser.newPage();
// 全程注入固定模拟位置：在探索区内、但站在所有触发圈之外（避免「到达自动
// 弹题」抢先把玩家带去情境页——那是上一轮已验证的功能，不是本探针对象）
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setGeolocationOverride", {
  latitude: 14.5836,
  longitude: 120.9794,
  accuracy: 8,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};
const click = (needle) =>
  page.evaluate((n) => {
    const b = [...document.querySelectorAll("button, a")].find((x) => (x.innerText || "").includes(n));
    if (!b) return false;
    b.click();
    return true;
  }, needle);
const bodyText = () => page.evaluate(() => document.body.innerText);

/* ---- R1/R2：分享链接接收端 ---- */
// R1 截断载荷 → 必须显示可读的失败原因，而不是静默换成示范游戏
await page.goto(`${BASE}/select#hunt=g.BROKENTRUNCATEDPAYLOADxx`, { waitUntil: "networkidle2", timeout: 90000 });
await sleep(3500);
const r1 = await bodyText();
check("R1 损坏分享链接显示失败原因", r1.includes("分享链接未能打开") && r1.includes("截断"));
// R2 完整合法载荷（j. 未压缩格式，浏览器端编码）→ 恢复出正确游戏
const validPack = {
  id: "round3-share-check",
  version: "1.0.0",
  title: "第二轮·分享恢复验证",
  description: "验证分享链接在接收端可以完整还原。",
  language: "zh-CN",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30 },
  entrySceneId: "s1",
  scenes: [
    {
      id: "s1",
      title: "验证站",
      story: "到达后看到这段话。",
      location: { lat: 14.58305, lng: 120.97936, radius: 15 },
      nextSceneId: null,
      challenge: { type: "keyword", question: "口令？", answer: "同行" },
      reward: { type: "keyword", title: "线索", value: "同行" },
    },
  ],
};
const shareUrl = await page.evaluate((g) => {
  const raw = JSON.stringify(g);
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const payload = "j." + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return location.origin + "/select#hunt=" + payload;
}, validPack);
// 同一路径仅 hash 变化不会触发页面重载；先离开再进入，模拟接收者新开标签页
await page.goto("about:blank");
await page.goto(shareUrl, { waitUntil: "networkidle2", timeout: 90000 });
await sleep(3500);
const r2 = await bodyText();
check("R2 有效分享链接恢复正确游戏", r2.includes("第二轮·分享恢复验证"));
check("R3 有效链接不显示失败横幅", !r2.includes("分享链接未能打开"));

/* ---- R4：新建游戏默认 15 米 ---- */
await page.goto(`${BASE}/design`, { waitUntil: "networkidle2", timeout: 90000 });
await sleep(4000);
await click("＋ 新建空白游戏");
await sleep(1800);
const r4 = await page.evaluate(() => {
  const sliders = [...document.querySelectorAll('input[type="range"][min="10"]')];
  const first = sliders[0];
  const label = document.body.innerText.includes("15 m");
  return { slider: first ? first.value : null, label };
});
check("R4 新建空白游戏首个场景默认 15 米", r4.slider === "15" && r4.label, JSON.stringify(r4));

/* ---- R5：退出 → 游戏中心 → 重进恢复指针 ---- */
// 注入带进度的游戏：场景一已完成，指针停在场景二
const pack = {
  id: "round3-exit-check",
  language: "zh-CN",
  title: "第二轮·退出恢复验证",
  description: "验证退出后从游戏中心重进可恢复。",
  author: "MOS",
  version: "1.0",
  difficulty: "进阶",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
  huntArea: { shape: "circle", center: { lat: 14.58325, lng: 120.97953 }, radiusMeters: 250 },
  entrySceneId: "s1",
  scenes: [
    {
      id: "s1",
      title: "一站·喷泉",
      story: "一。",
      location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "测试点一" },
      nextSceneId: "s2",
      challenge: { type: "choice", question: "1+1=?", options: ["2", "3"], answer: 0 },
      reward: { type: "keyword", title: "线索一", value: "喷泉" },
    },
    {
      id: "s2",
      title: "二站·钟亭",
      story: "二。",
      location: { lat: 14.58345, lng: 120.9797, radius: 20, name: "测试点二" },
      nextSceneId: null,
      challenge: { type: "keyword", question: "几口钟？", answer: ["一"] },
      reward: { type: "keyword", title: "线索二", value: "钟亭" },
    },
  ],
};
const state = {
  gameId: "round3-exit-check",
  gameVersion: "1.0",
  currentSceneId: "s2",
  scenes: {
    s1: { sceneId: "s1", status: "completed", attempts: 1, grantedRewardIds: ["keyword:喷泉"], arrivedAt: 1700000000000 },
    s2: { sceneId: "s2", status: "arrived", attempts: 0, grantedRewardIds: [], arrivedAt: 1700000001000 },
  },
  inventory: [{
    id: "keyword:喷泉", type: "keyword", title: "线索一", value: "喷泉",
    sceneId: "s1", acquiredAt: 1700000000000,
  }],
  keywords: ["喷泉"],
  startedAt: 1700000000000,
  lastUpdatedAt: 1700000001000,
};
await page.evaluate(([p, s]) => {
  localStorage.setItem("mos-scene-hunt:authoring:round3-exit-check", JSON.stringify(p));
  localStorage.setItem("mos-scene-hunt:current-authored-game", "round3-exit-check");
  localStorage.setItem(
    "mos-scene-hunt:save:round3-exit-check",
    JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), gameId: p.id, gameVersion: p.version, state: s }),
  );
}, [pack, state]);
await page.goto(`${BASE}/quest`, { waitUntil: "networkidle2", timeout: 90000 });
await sleep(3500);
check("R5 退出入口存在", await click("退出"));
await sleep(600);
const dialogText = await bodyText();
check("R6 退出确认框出现", dialogText.includes("退出本次寻宝？"));
check("R7 确认框可取消", await click("继续游戏"));
await sleep(600);
check("R8 取消后仍在任务页", page.url().includes("/quest"));
check("R9 再次打开确认并退出到游戏中心", (await click("退出")) && await sleep(600) === undefined && await click("退出并回到游戏中心"));
await sleep(2500);
check("R10 退出落在游戏中心", page.url().includes("/games") && (await bodyText()).includes("游戏中心"));

// 从游戏中心重进：开始游戏 → 继续寻宝 → 指针应停在二站
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.innerText || "").includes("开始游戏") &&
      b.closest("article")?.innerText.includes("第二轮·退出恢复验证"),
  );
  btn?.click();
});
await sleep(3000);
check("R11 重进后到达简报页", page.url().includes("/select"));
const beginLabel = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /开始寻宝|继续寻宝/.test((x.innerText || "").trim()));
  return b ? b.innerText.trim() : "missing";
});
check("R12 有进度时按钮为继续寻宝", beginLabel === "继续寻宝", beginLabel);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /开始寻宝|继续寻宝/.test((x.innerText || "").trim()));
  b?.click();
});
await sleep(4000);
check("R13 重进后回到地图", page.url().includes("/map"));
const r13 = await bodyText();
// 折叠任务卡显示目标标题与实时距离（无「当前目标：」前缀）；确认指针在二站
check(
  "R14 指针恢复在二站（而非一站）",
  r13.includes("二站·钟亭") && !r13.includes("当前目标：一站·喷泉") && !r13.includes("100 m\n一站·喷泉"),
  r13.slice(0, 60),
);

/* ---- R15：蓝色常显尾巴 ---- */
const r15 = await page.evaluate(() => {
  const marker = document.querySelector("[data-role='player-marker']");
  if (!marker) return { present: false };
  const divs = [...marker.querySelectorAll("div[aria-hidden='true']")];
  const tail = divs.find((d) => (d.getAttribute("style") || "").includes("rotate"));
  const style = tail?.getAttribute("style") ?? "";
  const inner = tail?.firstElementChild?.getAttribute("style") ?? "";
  return {
    present: true,
    hasTail: Boolean(tail),
    blue: style.includes("29,127,240") && inner.includes("29,127,240"),
    noHeading: style.includes("rotate(0deg)"), // 无指南针/航向时默认朝上（北）
  };
});
check("R15 尾巴默认显示且为蓝色", r15.present && r15.hasTail && r15.blue && r15.noHeading, JSON.stringify(r15));

await page.screenshot({ path: "tests/e2e/artifacts/probe-round3-map.png" });

/* ---- 汇总 ---- */
const failed = results.filter((r) => !r.ok);
console.log(`\n==== 汇总 ====`);
console.log(`${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
