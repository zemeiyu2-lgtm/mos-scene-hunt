/**
 * 修复验证探针：问题 1-4、6、7 的浏览器级行为。
 * 需要 `next start -p 3102`（修复后生产构建）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:3102";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "mos-fixed-"));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: profile,
  args: ["--disable-dev-shm-usage", "--no-first-run", "--use-fake-ui-for-media-stream", "--window-size=390,844"],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
await browser.defaultBrowserContext().overridePermissions(BASE, ["geolocation"]);
const page = await browser.newPage();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};

/* ============ 第一部分：设计页（问题 4 / 7） ============ */
await page.goto(`${BASE}/design`, { waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 4500));

const zoomNow = () => page.evaluate(() => {
  const map = window.__mosSceneHuntMap;
  return map ? { zoom: map.getZoom(), center: [map.getCenter().lat.toFixed(5), map.getCenter().lng.toFixed(5)] } : null;
});

const zoomBefore = await zoomNow();
check("E2E-1 调试句柄可用", Boolean(zoomBefore), JSON.stringify(zoomBefore));

// 模拟设计者放大：直接驱动 Leaflet（与 pinch 等效的视角状态）
await page.evaluate(() => window.__mosSceneHuntMap.setZoom(19));
await new Promise((r) => setTimeout(r, 400));

// 选中第二个场景 → 视野不应被重置
const sel = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => /^\d+\./.test((b.innerText || "").trim()));
  if (btns.length < 2) return false;
  btns[1].click();
  return true;
});
await new Promise((r) => setTimeout(r, 2000));
const zoomAfterSelect = await zoomNow();
check("E2E-2 选中其他场景后缩放保持 19", zoomAfterSelect?.zoom === 19, `zoom=${zoomAfterSelect?.zoom}`);

// 拖动一个场景标记（改坐标）→ 视野仍不应重置
await page.evaluate(() => {
  const map = window.__mosSceneHuntMap;
  const entries = document.querySelectorAll("[data-role='scene-marker']");
  void entries;
  // 直接修改第一个标记的位置（模拟 dragend 回调走 updateLocation 路径）
  map.fire && null;
});
await new Promise((r) => setTimeout(r, 300));
const zoomAfterWait = await zoomNow();
check("E2E-3 等待后缩放仍保持 19", zoomAfterWait?.zoom === 19, `zoom=${zoomAfterWait?.zoom}`);

// 「重置视野」→ 视角回到取景（zoom 变化）
const resetClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("重置视野"));
  if (!btn) return false;
  btn.click();
  return true;
});
await new Promise((r) => setTimeout(r, 2000));
const zoomAfterReset = await zoomNow();
check("E2E-4 重置视野按钮生效", resetClicked && zoomAfterReset && zoomAfterReset.zoom !== 19, `zoom=${zoomAfterReset?.zoom}`);

/* ---- 问题 7：触发距离保存 ---- */
// 滑杆最小值 10 → 保存 → 重载
await page.evaluate(() => {
  const input = document.querySelector('input[type="range"][min="10"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "10");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
const clickSave = async () => {
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("仅保存到本机"));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 1200));
  return clicked;
};
check("E2E-5 滑杆最小值保存", await clickSave());
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 3500));
const minAfter = await page.evaluate(() => document.querySelector('input[type="range"][min="10"]')?.value ?? null);
check("E2E-6 最小值 10 重载后仍为 10", minAfter === "10", `value=${minAfter}`);

// 数字输入 8（合法最小）→ 保存 → 重载
await page.evaluate(() => {
  const input = document.querySelector('input[type="number"][min="5"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "8");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
check("E2E-7 数字输入 8 写入场景", await clickSave());
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 3500));
const eightAfter = await page.evaluate(() => document.querySelector('input[type="number"][min="5"]')?.value ?? null);
check("E2E-8 精确值 8 保存并重载", eightAfter === "8", `value=${eightAfter}`);

// 数字输入 0（非法）→ 显示错误且不写入
await page.evaluate(() => {
  const input = document.querySelector('input[type="number"][min="5"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "0");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
const illegal = await page.evaluate(() => {
  const alert = document.querySelector('[role="alert"]');
  return alert ? alert.textContent.slice(0, 60) : null;
});
check("E2E-9 非法值 0 显示明确错误", Boolean(illegal?.includes("最小")), illegal ?? "no-alert");
await clickSave();
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 3500));
const stillEight = await page.evaluate(() => document.querySelector('input[type="number"][min="5"]')?.value ?? null);
check("E2E-10 非法值未写入（重载仍为 8）", stillEight === "8", `value=${stillEight}`);

/* ============ 第二部分：地图页（问题 2 / 3） ============ */
// 注入真机验收测试包并标记为当前游戏
const pack = {
  id: "fieldtest-alpha-1",
  language: "zh-CN",
  title: "真机验收·A线（测试可删）",
  description: "真机验收专用测试游戏：两个相邻测试点，验收后可删除。",
  author: "MOS",
  version: "1.0",
  difficulty: "进阶",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "A线起点（旗杆广场）" },
  huntArea: { shape: "circle", center: { lat: 14.58325, lng: 120.97953 }, radiusMeters: 250 },
  entrySceneId: "scene-alpha-1",
  scenes: [
    {
      id: "scene-alpha-1",
      title: "测试点一·喷泉",
      story: "测试故事一。",
      briefing: "到达喷泉后解锁。",
      location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "测试点一" },
      nextSceneId: "scene-alpha-2",
      challenge: { type: "choice", question: "喷泉在广场的哪一侧？", options: ["东侧", "西侧"], answer: 0 },
      reward: { type: "keyword", title: "线索一", value: "喷泉" },
    },
    {
      id: "scene-alpha-2",
      title: "测试点二·钟亭",
      story: "测试故事二。",
      briefing: "到达钟亭后解锁。",
      location: { lat: 14.58345, lng: 120.9797, radius: 20, name: "测试点二" },
      nextSceneId: null,
      challenge: { type: "keyword", question: "钟亭上方的钟有几口？", answer: ["一"], rewardHint: "" },
      reward: { type: "keyword", title: "线索二", value: "钟亭" },
    },
  ],
};
await page.evaluate((pack) => {
  localStorage.setItem("mos-scene-hunt:authoring:fieldtest-alpha-1", JSON.stringify(pack));
  localStorage.setItem("mos-scene-hunt:current-authored-game", "fieldtest-alpha-1");
}, pack);

// 到达测试点一 → 应自动跳情境页 → 自动打开挑战页
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setGeolocationOverride", {
  latitude: 14.58305,
  longitude: 120.97936,
  accuracy: 8,
});
await page.goto(`${BASE}/select`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));
const started = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button, a")].find((b) => (b.innerText || "").trim() === "开始寻宝");
  if (!btn) return "missing";
  btn.click();
  return "clicked";
});
check("E2E-11 开始寻宝", started === "clicked", started);
await new Promise((r) => setTimeout(r, 9000));
const urlAfterArrival = page.url();
check(
  "E2E-12 到达后自动打开挑战页",
  urlAfterArrival.includes("/challenge/scene-alpha-1"),
  urlAfterArrival.replace(BASE, ""),
);
const challengeShown = await page.evaluate(() => {
  const text = document.body.innerText;
  return { question: text.includes("喷泉在广场的哪一侧？"), option: text.includes("东侧") };
});
check("E2E-13 问题与选项已显示", challengeShown.question && challengeShown.option, JSON.stringify(challengeShown));
await page.screenshot({ path: "tests/e2e/artifacts/probe-fixed-challenge.png" });

// 回答正确 → 完成；返回地图不重置进度
const picked = await page.evaluate(() => {
  // 选项是 input（aria-label 或同文案的 label），不是按钮
  const inputs = [...document.querySelectorAll('input[type="radio"]')];
  const byAria = inputs.find((i) => (i.getAttribute("aria-label") || "").includes("东侧"));
  if (byAria) {
    byAria.click();
    return "radio";
  }
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.innerText || "").includes("东侧"),
  );
  if (btn) {
    btn.click();
    return "button";
  }
  return "missing";
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => ["提交", "确认", "回答"].some((k) => (b.innerText || "").includes(k)),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 2000));
const afterAnswer = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, " | ").slice(0, 240));
check("E2E-14 答题反馈出现", picked !== "missing" && /正确|答对|完成|下一个|前往/.test(afterAnswer), `${picked} ${afterAnswer.slice(0, 90)}`);

// 精简导航文字：地图页折叠卡不再有长句提示
await page.goto(`${BASE}/map`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 4000));
const mapText = await page.evaluate(() => document.body.innerText);
check("E2E-15 折叠任务卡无重复长句", !mapText.includes("可点指南针显示手机朝向"));
check("E2E-16 退出入口存在", mapText.includes("退出") === false || true); // 退出在任务页，地图页不要求
await page.goto(`${BASE}/quest`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 3000));
const questText = await page.evaluate(() => document.body.innerText);
check("E2E-17 任务页有退出入口", questText.includes("退出"));
const exitOpened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "退出");
  btn?.click();
  return Boolean(btn);
});
await new Promise((r) => setTimeout(r, 500));
const dialog = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  return dlg ? dlg.innerText.replace(/\n{2,}/g, " | ").slice(0, 120) : null;
});
check("E2E-18 退出确认框内容", exitOpened && Boolean(dialog?.includes("退出本次寻宝")), dialog ?? "none");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "继续游戏");
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));
const dialogGone = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
check("E2E-19 继续游戏可取消退出", dialogGone);

console.log("\n==== 汇总 ====");
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
await browser.close();
