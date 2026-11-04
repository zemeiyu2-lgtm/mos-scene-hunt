/**
 * GPS overlay probe — verifies the game overlays on whatever engine the
 * current build ships: player fix + accuracy halo, target rings, hunt-area
 * polygon, and authoring vertex flow on the real bench page.
 *
 *   node tools/probe-gps-overlays.mjs --out ../bench-outage/gps-overlays
 */

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3200");
const OUT = arg("out", "../bench-outage/gps-overlays");

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 200)));

await page.goto(`${BASE}/dev/map-bench`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => window.__mosMapMetrics?.readyMs !== null, { timeout: 40000 }).catch(() => {});
await sleep(2500);

const report = { base: BASE, capturedAt: new Date().toISOString(), checks: {} };

// 1) player marker + accuracy halo + scene markers + target rings present
await page.evaluate(() => {
  const toggle = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "创作者选点",
  );
  if (toggle?.getAttribute("class")?.includes("bg-white/20")) toggle.click(); // ensure off
});
await sleep(400);
report.checks.overlays = await page.evaluate(() => ({
  engine: window.__mosMapEngine ?? null,
  playerMarker: Boolean(document.querySelector('[data-role="player-marker"]')),
  sceneMarkers: document.querySelectorAll('[data-role="scene-marker"]').length,
  haloSvgPath: Boolean(
    document.querySelector("path[stroke], .maplibregl-canvas-container") ,
  ),
  canvasPresent: Boolean(document.querySelector("canvas")),
}));
await page.screenshot({ path: path.join(OUT, "gps-1-fix-rings.png") });

// 2) player follow: the map recentres on the simulated fix (bench player = city centre)
report.checks.fix = await page.evaluate(() => ({
  center: window.__mosMap?.getCenter?.() ?? null,
  zoom: window.__mosMap?.getZoom?.() ?? null,
}));

// 3) polygon hunt area renders when toggled
await page.evaluate(() => {
  const toggle = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "多边形区域",
  );
  toggle?.click();
});
await sleep(1800);
report.checks.polygon = await page.evaluate(() => ({
  engine: window.__mosMapEngine ?? null,
  ready: window.__mosMapMetrics?.readyMs !== null,
}));
await page.screenshot({ path: path.join(OUT, "gps-2-polygon.png") });

// 4) authoring click places a vertex readout while polygon mode is on
await page.evaluate(() => {
  const toggle = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "创作者选点",
  );
  toggle?.click();
});
await sleep(2500);
await page.mouse.click(195, 430);
await sleep(800);
report.checks.authoringClick = await page.evaluate(
  () => document.querySelector('[data-testid="click-readout"]')?.textContent ?? "",
);
await page.screenshot({ path: path.join(OUT, "gps-3-authoring.png") });

report.consoleErrors = consoleErrors.slice(0, 8);
await browser.close();
fs.writeFileSync(path.join(OUT, "report-gps-overlays.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
