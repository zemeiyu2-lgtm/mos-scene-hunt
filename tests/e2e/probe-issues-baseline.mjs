/**
 * 复现探针（基线）：触发距离最小值保存 + 创作地图缩放被重置。
 * 需要先 `next start -p 3102`（生产构建）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:3102";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "mos-probe-"));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: profile,
  args: ["--disable-dev-shm-usage", "--no-first-run", "--window-size=390,844"],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();

const log = (...a) => console.log(...a);

// ---- 场景 A：触发距离最小值保存 ----
await page.goto(`${BASE}/design`, { waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 4000));

// 找到第一个触发距离滑杆并拖到最小值 10
const setSlider = await page.evaluate(() => {
  const input = document.querySelector('input[type="range"][min="10"]');
  if (!input) return "slider-missing";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "10");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input.value;
});
log("滑杆设为:", setSlider);

// 读取该场景当前显示半径（滑杆所在卡片里的 tabular 文本）
const beforeSave = await page.evaluate(() => {
  const card = document.querySelector('input[type="range"][min="10"]')?.closest(".rounded-xl");
  return card?.querySelector(".tabular")?.textContent?.trim() ?? null;
});
log("保存前显示:", beforeSave);

// 点「仅保存到本机」
const saveClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("仅保存到本机"));
  if (!btn || btn.disabled) return btn ? "disabled" : "missing";
  btn.click();
  return "clicked";
});
log("保存按钮:", saveClicked);
await new Promise((r) => setTimeout(r, 1500));

// 保存失败提示？
const saveFailure = await page.evaluate(() => {
  const alert = document.querySelector('[role="alert"]');
  return alert ? alert.textContent.slice(0, 200) : null;
});
log("保存失败提示:", saveFailure);

// 重新载入，读回半径
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 4000));
const afterReload = await page.evaluate(() => {
  const input = document.querySelector('input[type="range"][min="10"]');
  const card = input?.closest(".rounded-xl");
  return { slider: input?.value ?? null, label: card?.querySelector(".tabular")?.textContent?.trim() ?? null };
});
log("重载后滑杆值/显示:", JSON.stringify(afterReload));

// ---- 场景 B：选中另一场景后地图是否被重新取景 ----
// 用瓦片容器的 transform 之外的办法：比较两个场景标记的屏幕位置 + 地图容器内部 Leaflet 状态。
// Leaflet 把 zoom 写在 map 对象上，这里从 DOM 无法直接读，改用标记像素位置差。
const markerPos = async () =>
  page.evaluate(() => {
    const markers = [...document.querySelectorAll("[data-role='scene-marker']")];
    return markers.map((m) => {
      const r = m.getBoundingClientRect();
      return `${r.x.toFixed(0)},${r.y.toFixed(0)}`;
    });
  });

const posBefore = await markerPos();
log("选择前标记位置:", posBefore.join(" | "));

// 点击第二个场景的标题按钮（触发选中）
const sel = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => /^\d+\./.test((b.innerText || "").trim()));
  if (btns.length < 2) return "not-enough-scenes";
  btns[1].click();
  return "clicked-scene-2";
});
log("选中:", sel);
await new Promise((r) => setTimeout(r, 2500));
const posAfter = await markerPos();
log("选择后标记位置:", posAfter.join(" | "));
log(
  "视野是否被重置:",
  posBefore.join("|") !== posAfter.join("|") ? "是（发生重新取景）" : "否（保持原视野）",
);

await page.screenshot({ path: "tests/e2e/artifacts/probe-baseline-design.png" });
await browser.close();
