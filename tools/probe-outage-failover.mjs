/**
 * Outage / failover probe — vendor-bench acceptance addendum.
 *
 * Simulates a map-vendor outage against the real shipped bundle and verifies
 * that (a) the backup engine takes over, and (b) page-level game state
 * survives the swap.
 *
 *   node tools/probe-outage-failover.mjs --mode openfreemap  --out ../bench-outage/openfreemap
 *   node tools/probe-outage-failover.mjs --mode protomaps    --out ../bench-outage/protomaps
 *   node tools/probe-outage-failover.mjs --mode geoapify     --out ../bench-outage/geoapify
 *
 * Outage injection per mode (all on the *real* bundle, nothing mocked):
 *   openfreemap — CDP `Network.setBlockedURLs` blocks tiles.openfreemap.org,
 *                 so the style fetch fails and the boot timer must fire.
 *   protomaps   — the build was made with a dead PMTiles URL, so the pmtiles
 *                 protocol registration fails before the map even constructs.
 *   geoapify    — build has no vendor key, so the runtime key probe rejects
 *                 the vendor (the "quota exhausted / key revoked" case).
 *
 * State-retention evidence: a localStorage key is written before the fallback,
 * read after it; the authoring click readout (React state above the map) must
 * still respond on the backup engine.
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
const MODE = arg("mode", "openfreemap");
const OUT = arg("out", `../bench-outage/${MODE}`);

fs.mkdirSync(OUT, { recursive: true });

const BLOCK_PATTERNS = {
  openfreemap: ["tiles.openfreemap.org"],
  protomaps: [],
  geoapify: [],
};

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

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 240));
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 240)}`));

// Network accounting — page events (they include worker-driven tile fetches).
const osmHosts = /tile\.openstreetmap\.org|basemaps\.cartocdn/;
const vendorHosts = /openfreemap|protomaps|geoapify/;
const net = { osmTiles: 0, osmBytes: 0, vendorTiles: 0, vendorFailures: 0 };
page.on("requestfinished", (request) => {
  const url = request.url();
  const bytes = Number(request.response()?.headers()["content-length"] ?? 0) || 0;
  if (osmHosts.test(url)) {
    net.osmTiles += 1;
    net.osmBytes += bytes;
  } else if (vendorHosts.test(url)) {
    net.vendorTiles += 1;
  }
});
page.on("requestfailed", (request) => {
  if (vendorHosts.test(request.url()) || osmHosts.test(request.url())) net.vendorFailures += 1;
});

const client = await page.createCDPSession();
await client.send("Network.enable");
await client.send("Network.setCacheDisabled", { cacheDisabled: true });
if (BLOCK_PATTERNS[MODE]?.length) {
  await client.send("Network.setBlockedURLs", { urls: BLOCK_PATTERNS[MODE] });
}

const report = {
  mode: MODE,
  base: BASE,
  capturedAt: new Date().toISOString(),
  outageInjection: BLOCK_PATTERNS[MODE]?.length
    ? `CDP blocked: ${BLOCK_PATTERNS[MODE].join(", ")}`
    : MODE === "protomaps"
      ? "build-time dead PMTiles URL (registration fails)"
      : "no vendor key in build (probe rejects vendor)",
  steps: {},
};

// ---------------------------------------------------------------- phase 1
// Primary engine must fail (or geoapify must report blocked)…
await page.goto(`${BASE}/dev/map-bench`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.evaluate(() => {
  // Game state stands in: written BEFORE the swap, read AFTER it.
  localStorage.setItem(
    "mos-outage-probe",
    JSON.stringify({ playerFix: { lat: 14.5832, lng: 120.9794 }, progress: 2, writtenAt: Date.now() }),
  );
});

const primary = await page
  .waitForFunction(
    () => {
      const metrics = window.__mosMapMetrics;
      return Boolean(metrics && (metrics.readyMs !== null || metrics.blocked));
    },
    { timeout: 30000 },
  )
  .then(() => true)
  .catch(() => false);
await sleep(1500);

const primaryState = await page.evaluate(() => ({
  engine: window.__mosMapEngine ?? null,
  readyMs: window.__mosMapMetrics?.readyMs ?? null,
  blocked: window.__mosMapMetrics?.blocked ?? null,
  bootErrors: (window.__mosMapMetrics?.bootErrors ?? []).slice(0, 4),
}));
await page.screenshot({ path: path.join(OUT, `outage-${MODE}-1-primary.png`) });
report.steps.primary = {
  phaseObserved: primary,
  ...primaryState,
  shot: `outage-${MODE}-1-primary.png`,
};

// ---------------------------------------------------------------- phase 2
// …the fallback must take over.
const fallbackAppeared = await page
  .waitForSelector('[data-map-fallback]', { timeout: 45000 })
  .then(() => true)
  .catch(() => false);

const fallbackBooted = await page
  .waitForFunction(
    () => {
      const metrics = window.__mosMapMetrics;
      const engine = window.__mosMapEngine;
      return Boolean(
        metrics &&
          engine &&
          engine !== "maplibre-openfreemap" &&
          engine !== "maplibre-protomaps" &&
          engine !== "leaflet-geoapify" &&
          metrics.readyMs !== null,
      );
    },
    { timeout: 40000 },
  )
  .then(() => true)
  .catch(() => false);
await sleep(2500);

const fallbackState = await page.evaluate(() => ({
  fallbackAttr: document.querySelector("[data-map-fallback]")?.getAttribute("data-map-fallback") ?? null,
  banner: document.querySelector('[data-testid="map-fallback-banner"]')?.textContent ?? null,
  engine: window.__mosMapEngine ?? null,
  readyMs: window.__mosMapMetrics?.readyMs ?? null,
  blocked: window.__mosMapMetrics?.blocked ?? null,
  zoom: window.__mosMap?.getZoom?.() ?? null,
  center: window.__mosMap?.getCenter?.() ?? null,
  localStorageProbe: localStorage.getItem("mos-outage-probe"),
}));
await page.screenshot({ path: path.join(OUT, `outage-${MODE}-2-fallback.png`) });
report.steps.fallback = {
  fallbackAppeared,
  fallbackEngineReady: fallbackBooted,
  osmTilesServed: net.osmTiles,
  osmBytes: net.osmBytes,
  ...fallbackState,
  shot: `outage-${MODE}-2-fallback.png`,
};

// ---------------------------------------------------------------- phase 3
// The backup must be interactive AND page-level state must have survived:
// toggling 作者选点 remounts the map (a second outage cycle) — the React
// `clicked` state lives in the page above the map, so a successful click
// readout after the swap is direct evidence the game surface is intact.
await page.evaluate(() => {
  const toggle = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "创作者选点",
  );
  toggle?.click();
});
// After the remount the map may need to fail over again before it accepts
// clicks; wait for whichever engine wins to report ready.
await page
  .waitForFunction(
    () => Boolean(window.__mosMapMetrics?.readyMs !== null || window.__mosMapMetrics?.blocked),
    { timeout: 40000 },
  )
  .catch(() => {});
await page
  .waitForSelector('[data-map-fallback]', { timeout: 45000 })
  .catch(() => {});
await page
  .waitForFunction(() => window.__mosMapMetrics?.readyMs !== null, { timeout: 40000 })
  .catch(() => {});
await sleep(2000);

await page.mouse.click(195, 430);
await sleep(900);
const interaction = await page.evaluate(() => ({
  clickReadout: document.querySelector('[data-testid="click-readout"]')?.textContent ?? "",
  engine: window.__mosMapEngine ?? null,
  localStorageProbe: localStorage.getItem("mos-outage-probe"),
}));
await page.screenshot({ path: path.join(OUT, `outage-${MODE}-3-authoring.png`) });
report.steps.authoring = {
  ...interaction,
  clickReadoutHasCoordinate: /点击坐标：\s*[-\d.]+,\s*[-\d.]+/.test(interaction.clickReadout),
  stateSurvived: Boolean(interaction.localStorageProbe),
  shot: `outage-${MODE}-3-authoring.png`,
};

report.network = net;
report.consoleErrors = consoleErrors.slice(0, 10);

await browser.close();
fs.writeFileSync(path.join(OUT, `report-outage-${MODE}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.steps, null, 2));
console.log(`wrote ${path.join(OUT, `report-outage-${MODE}.json`)}`);
