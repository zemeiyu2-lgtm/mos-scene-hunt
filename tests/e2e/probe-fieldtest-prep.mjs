// 真机验收前置准备：创建独立测试游戏 → 生成分享链接 + 二维码 PNG。
// 只在本探针的浏览器档案里操作，不触碰任何真实用户数据。
import puppeteer from "puppeteer-core";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const BASE = process.env.E2E_LAN_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const GAME_ID = "fieldtest-alpha-1";
const GAME_TITLE = "真机验收·A线（测试可删）";
const PREFIX = "mos-scene-hunt:authoring:";
const ART = path.join(process.cwd(), "tests", "e2e", "artifacts");
mkdirSync(ART, { recursive: true });

// 两个相距约 50m 的相邻测试点（黎刹公园区域，与项目模板一致；用户可随时在设计器拖动改点）
const GAME = {
  id: GAME_ID,
  language: "zh-CN",
  title: GAME_TITLE,
  description: "真机验收专用测试游戏：两个相邻测试点，验收后可删除。",
  version: "0.1.0",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "A线起点（旗杆广场）" },
  entrySceneId: "ft-a1",
  scenes: [
    {
      id: "ft-a1",
      title: "测试点一·喷泉",
      story: "这是真机验收的第一站。找到喷泉附近的标识物，回答问题即可获得线索。",
      location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "测试点一" },
      nextSceneId: "ft-a2",
      challenge: { type: "choice", question: "真机验收：这一站是第几站？", options: ["第一站", "第二站"], answer: 0 },
      reward: { type: "keyword", title: "线索一", value: "向北走约50米" },
    },
    {
      id: "ft-a2",
      title: "测试点二·钟亭",
      story: "这是第二站，与上一站相邻。回答正确即完成整条测试线。",
      location: { lat: 14.58345, lng: 120.9797, radius: 20, name: "测试点二" },
      nextSceneId: null,
      challenge: { type: "keyword", question: "真机验收：输入本站关键词「钟亭」", answer: ["钟亭"] },
      reward: { type: "keyword", title: "线索二", value: "A线完成！" },
    },
  ],
  huntArea: { shape: "circle", center: { lat: 14.58325, lng: 120.97953 }, radiusMeters: 250 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  userDataDir: mkdtempSync(path.join(tmpdir(), "mos-probe-fieldtest-")),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  × ${name}\n    ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// 1. 种入测试游戏（独立 ID，不会与任何官方/用户游戏冲突）
await page.goto(BASE + "/games", { waitUntil: "networkidle2" });
await page.evaluate((key, game) => window.localStorage.setItem(key, JSON.stringify(game)), PREFIX + GAME_ID, GAME);
await page.reload({ waitUntil: "networkidle2" });
await sleep(1200);

await check("1 测试游戏出现在游戏中心", async () => {
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout: 15000 },
    GAME_TITLE,
  );
});

// 2. 深链接打开设计器确认载入
await page.goto(`${BASE}/design?game=${GAME_ID}`, { waitUntil: "networkidle2" });
await sleep(2000);
await check("2 设计器按深链接载入测试游戏", async () => {
  await page.waitForFunction(
    () => document.querySelectorAll("label input").length > 0,
    { timeout: 15000 },
  );
  const title = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll("label")).find((l) => (l.textContent ?? "").includes("游戏名称"));
    return label?.querySelector("input")?.value ?? "";
  });
  assert(title === GAME_TITLE, `设计器载入的游戏名称不符：${title}`);
});

// 3. 点击发布，生成分享链接 + 二维码
let shareUrl = null;
await check("3 发布并生成分享链接与二维码", async () => {
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("发布并分享"));
    if (!btn || btn.disabled) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  });
  assert(clicked, "找不到可点击的「发布并分享」按钮");
  for (let i = 0; i < 20 && !shareUrl; i++) {
    await sleep(400);
    shareUrl = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll("p"));
      const p = ps.find((n) => n.textContent?.startsWith("http") && n.textContent.includes("#hunt=g."));
      return p?.textContent ?? null;
    });
  }
  assert(shareUrl, "20 秒内未出现分享链接（发布可能被校验拦截）");
  const qr = await page.evaluate(() => {
    const c = document.querySelector("div.flex.justify-center canvas") ?? document.querySelector("canvas");
    return c ? c.toDataURL("image/png") : null;
  });
  assert(qr?.startsWith("data:image/png"), "二维码 canvas 未找到");
  writeFileSync(path.join(ART, "fieldtest-alpha-1-qr.png"), Buffer.from(qr.split(",")[1], "base64"));
  writeFileSync(path.join(ART, "fieldtest-alpha-1-link.txt"), shareUrl, "utf8");
});

// 4. 解码分享载荷，确认对应测试游戏
await check("4 分享链接载荷解码 = 测试游戏本体，且指向局域网地址", async () => {
  assert(shareUrl.startsWith(BASE), `分享链接 origin 不是 ${BASE}：${shareUrl.slice(0, 60)}`);
  const frag = shareUrl.split("#hunt=")[1];
  assert(frag?.startsWith("g."), `载荷格式异常：${frag?.slice(0, 12)}`);
  const b64 = frag.slice(2).replace(/-/g, "+").replace(/_/g, "/");
  const json = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
  const game = JSON.parse(json);
  assert(game.id === GAME_ID, `载荷游戏 ID 不符：${game.id}`);
  assert(game.scenes.length === 2 && game.huntArea?.shape === "circle", "载荷内容不完整");
  assert(game.scenes.every((s) => s.location.lat !== 0 && s.location.lng !== 0), "载荷存在 0,0 占位坐标");
});

// 5. 手机视角：本机回环地址也可访问（双地址一致性）
await check("5 回环地址同样可达（服务器绑定 0.0.0.0）", async () => {
  const loopback = process.env.E2E_BASE_URL;
  if (!loopback) return;
  const resp = await page.goto(loopback + "/games", { waitUntil: "domcontentloaded" });
  assert(resp.status() === 200, `回环地址返回 ${resp.status()}`);
});

assert(pageErrors.length === 0, `页面脚本错误：${pageErrors.join(" | ")}`);
console.log("  ✓ 6 无页面脚本错误");
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\nFAILED: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
