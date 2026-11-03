/**
 * Mobile touch probe — real touchscreen events (not mouse) on the bench map:
 * tap-to-pick (authoring) and one-finger drag pan, at iPhone-class viewport.
 *
 *   node tools/probe-mobile-touch.mjs --out ../bench-outage/mobile-touch
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
const OUT = arg("out", "../bench-outage/mobile-touch");

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setUserAgent(
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
);

await page.goto(`${BASE}/dev/map-bench`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => window.__mosMapMetrics?.readyMs !== null, { timeout: 40000 }).catch(() => {});
await sleep(2200);

const report = { base: BASE, capturedAt: new Date().toISOString(), engine: null, checks: {} };
report.engine = await page.evaluate(() => window.__mosMapEngine ?? null);

// --- touch drag pan
const before = await page.evaluate(() => window.__mosMap?.getCenter?.() ?? null);
const touchStart = { x: 195, y: 430 };
await page.touchscreen.touchStart(touchStart.x, touchStart.y);
for (let step = 1; step <= 10; step += 1) {
  await page.touchscreen.touchMove(touchStart.x + step * 6, touchStart.y + step * 7);
  await sleep(30);
}
await page.touchscreen.touchEnd();
await sleep(1200);
const after = await page.evaluate(() => window.__mosMap?.getCenter?.() ?? null);
report.checks.touchDrag = {
  before,
  after,
  moved: Boolean(
    before && after && Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng) > 0.00001,
  ),
};
await page.screenshot({ path: path.join(OUT, "touch-1-drag.png") });

// --- touch tap authoring pick
await page.evaluate(() => {
  const toggle = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "创作者选点",
  );
  toggle?.click();
});
await sleep(2600);
await page.touchscreen.tap(180, 420);
await sleep(900);
report.checks.touchTap = await page.evaluate(
  () => document.querySelector('[data-testid="click-readout"]')?.textContent ?? "",
);
await page.screenshot({ path: path.join(OUT, "touch-2-tap-authoring.png") });

await browser.close();
fs.writeFileSync(path.join(OUT, "report-mobile-touch.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
