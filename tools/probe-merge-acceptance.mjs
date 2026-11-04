/**
 * Merge-acceptance visual probe — walks the real product screens on the merged
 * build and captures screenshots for the acceptance record.
 *
 *   node tools/probe-merge-acceptance.mjs --out ../../bench-merge-acceptance
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
const OUT = arg("out", "../../bench-merge-acceptance");

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"],
});

async function newPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  return page;
}

const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const report = { base: BASE, capturedAt: new Date().toISOString(), screens: {} };

/* 1) 首页 */
{
  const page = await newPage(MOBILE);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 90000 });
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, "product-1-home.png") });
  report.screens.home = { engine: await page.evaluate(() => window.__mosMapEngine ?? null) };
  await page.close();
}

/* 2) 玩家端地图页 */
{
  const page = await newPage(MOBILE);
  await page.goto(`${BASE}/map`, { waitUntil: "networkidle2", timeout: 90000 });
  await sleep(5000);
  await page.screenshot({ path: path.join(OUT, "product-2-player-map.png") });
  report.screens.playerMap = {
    engine: await page.evaluate(() => window.__mosMapEngine ?? null),
    playerMarker: await page.evaluate(
      () => document.querySelectorAll('[data-role="player-marker"], .player-marker').length,
    ),
    sceneMarkers: await page.evaluate(
      () => document.querySelectorAll('[data-role="scene-marker"]').length,
    ),
  };
  await page.close();
}

/* 3) 创作者端（含地图的创建/设计页） */
{
  const page = await newPage(MOBILE);
  for (const route of ["/create", "/design"]) {
    try {
      const resp = await page.goto(`${BASE}${route}`, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      if (resp && resp.status() < 400) {
        await sleep(4000);
        await page.screenshot({ path: path.join(OUT, `product-3-creator${route.replace("/", "-")}.png`) });
        report.screens[`creator${route.replace("/", "")}`] = {
          status: resp.status(),
          engine: await page.evaluate(() => window.__mosMapEngine ?? null),
        };
      }
    } catch {
      /* route may not exist */
    }
  }
  await page.close();
}

/* 4) 三个城市 × z15（bench 页真实走产品 MapView） */
{
  const page = await newPage(MOBILE);
  for (const city of ["manila", "singapore", "new-york"]) {
    await page.goto(`${BASE}/dev/map-bench`, { waitUntil: "networkidle2", timeout: 90000 });
    await page.waitForFunction(() => window.__mosMapMetrics?.readyMs !== null, { timeout: 40000 }).catch(() => {});
    await page.evaluate((id) => {
      const button = document.querySelector(`[data-city="${id}"]`);
      if (button) button.click();
    }, city);
    await sleep(1000);
    await page.evaluate(() => {
      const button = document.querySelector('[data-zoom="15"]');
      if (button) button.click();
    });
    await sleep(3500);
    await page.screenshot({ path: path.join(OUT, `product-4-${city}-z15.png`) });
    report.screens[`city-${city}`] = await page.evaluate(() => ({
      engine: window.__mosMapEngine ?? null,
      zoom: window.__mosMap?.getZoom?.() ?? null,
      center: window.__mosMap?.getCenter?.() ?? null,
    }));
  }
  await page.close();
}

/* 5) 移动端触控（拖动）在玩家视口 */
{
  const page = await newPage(MOBILE);
  await page.goto(`${BASE}/dev/map-bench`, { waitUntil: "networkidle2", timeout: 90000 });
  await page.waitForFunction(() => window.__mosMapMetrics?.readyMs !== null, { timeout: 40000 }).catch(() => {});
  await sleep(1500);
  const before = await page.evaluate(() => window.__mosMap?.getCenter?.() ?? null);
  await page.touchscreen.touchStart(195, 430);
  for (let step = 1; step <= 10; step += 1) {
    await page.touchscreen.touchMove(195 + step * 6, 430 + step * 7);
    await sleep(30);
  }
  await page.touchscreen.touchEnd();
  await sleep(1200);
  const after = await page.evaluate(() => window.__mosMap?.getCenter?.() ?? null);
  report.screens.touchDrag = {
    moved: Boolean(
      before && after && Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng) > 1e-5,
    ),
  };
  await page.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, "report-merge-acceptance.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
