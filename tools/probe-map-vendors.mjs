/**
 * Vendor bench probe: real screenshots + real network numbers per city/zoom.
 *
 * Usage:
 *   node tools/probe-map-vendors.mjs --mode openfreemap --out <dir> [--runs 2] [--base http://localhost:3200]
 *
 * It drives the shipped bundle through `/dev/map-bench` and reads only public
 * hooks (`window.__mosMap`, `window.__mosMapMetrics`) plus CDP network events.
 * Nothing is mocked: the tiles counted here are the tiles the browser painted.
 *
 * Why CDP and not `performance.getEntriesByType("resource")`: cross-origin
 * entries report `transferSize: 0` without `Timing-Allow-Origin`, which would
 * make OpenFreeMap/Cloudflare look free. CDP reports encoded lengths as the
 * browser actually received them.
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
const OUT = arg("out", `./probe-${MODE}`);
const RUNS = Number(arg("runs", "2"));
const ONLY = arg("city", null);

const CITIES = [
  { id: "manila", label: "Manila" },
  { id: "singapore", label: "Singapore" },
  { id: "new-york", label: "New York" },
];
const ZOOMS = [10, 12, 15, 17];
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 860, deviceScaleFactor: 1 };

const VENDOR_HOSTS =
  /openfreemap|protomaps|geoapify|tile\.openstreetmap|basemaps\.cartocdn|amap\.com|autonavi|localhost:\d+/;

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US", "--force-device-scale-factor=1"],
});

const report = {
  mode: MODE,
  base: BASE,
  capturedAt: new Date().toISOString(),
  userAgent: null,
  cities: [],
};

/** Per-phase network accounting for one page. */
async function attachNetwork(page) {
  const state = { requests: 0, bytes: 0, failures: 0, tileRequests: 0, tileBytes: 0, statuses: {}, urls: [] };

  // Vector tiles are fetched inside MapLibre's Web Workers. A page-level CDP
  // session never sees those (verified: a z16→z10 jump shows 0 CDP events while
  // `page.on("request")` shows 4 tile fetches), but puppeteer's page events do
  // — puppeteer forwards worker requests onto the page emitter. So: CDP is
  // used only to disable the HTTP cache, and counting happens on page events.
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });

  const disableWorkerCache = async () => {
    for (const worker of page.workers()) {
      try {
        await worker.client.send("Network.enable");
        await worker.client.send("Network.setCacheDisabled", { cacheDisabled: true });
      } catch {
        // A worker that terminated between listing and wiring is fine.
      }
    }
  };

  const record = (url, bytes) => {
    state.requests += 1;
    state.bytes += bytes;
    if (VENDOR_HOSTS.test(url)) {
      state.tileRequests += 1;
      state.tileBytes += bytes;
    }
    if (state.urls.length < 80) state.urls.push(`${bytes} ${url.slice(0, 120)}`);
  };

  page.on("requestfinished", (request) => {
    let bytes = 0;
    try {
      bytes = Number(request.response()?.headers()["content-length"] ?? 0);
      if (!Number.isFinite(bytes) || bytes <= 0) bytes = request.response()?.body()?.length ?? 0;
    } catch {
      bytes = 0;
    }
    record(request.url(), bytes);
  });
  page.on("requestfailed", (request) => {
    state.requests += 1;
    state.failures += 1;
    const key = `fail:${(request.failure()?.errorText || "unknown").slice(0, 40)}`;
    state.statuses[key] = 1;
  });

  return {
    disableWorkerCache,
    reset() {
      state.requests = 0;
      state.bytes = 0;
      state.failures = 0;
      state.tileRequests = 0;
      state.tileBytes = 0;
      state.statuses = {};
      state.urls = [];
    },
    snapshot() {
      return { ...state, statuses: { ...state.statuses }, urls: state.urls.slice(0, 24) };
    },
  };
}

async function shoot(page, name) {
  const handle = await page.$(".map-root");
  const file = path.join(OUT, `${name}.png`);
  if (handle) {
    const box = await handle.boundingBox();
    if (box && box.width > 40 && box.height > 40) {
      await page.screenshot({
        path: file,
        clip: {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.min(box.width, 2000),
          height: Math.min(box.height, 2000),
        },
      });
      return file;
    }
  }
  await page.screenshot({ path: file });
  return file;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readMetrics(page) {
  return await page.evaluate(() => {
    const metrics = window.__mosMapMetrics;
    const map = window.__mosMap;
    return {
      engine: metrics?.engine ?? window.__mosMapEngine ?? null,
      readyMs: metrics?.readyMs ?? null,
      idleMs: metrics?.idleMs ?? null,
      tileErrors: metrics?.tileErrors ?? null,
      bootErrors: metrics?.bootErrors ?? [],
      blocked: metrics?.blocked ?? null,
      zoom: map ? Math.round(map.getZoom() * 100) / 100 : null,
      center: map ? map.getCenter() : null,
    };
  });
}

async function openBench(viewport, cityId) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 240));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 240)}`));
  const net = await attachNetwork(page);
  const started = Date.now();
  await page.goto(`${BASE}/dev/map-bench`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page
    .waitForFunction(
      () => {
        const metrics = window.__mosMapMetrics;
        return Boolean(metrics && (metrics.readyMs !== null || metrics.blocked));
      },
      { timeout: 30000 },
    )
    .catch(() => {});
  const bootMs = Date.now() - started;
  // `idle` is the honest "tiles stopped moving" moment for vector engines.
  await page
    .waitForFunction(() => window.__mosMapMetrics?.idleMs !== null, { timeout: 20000 })
    .catch(() => {});
  await net.disableWorkerCache();
  // Select the city. The page boots on Manila by default, so every non-Manila
  // pass must actually move the viewport — a click here is the only honest way
  // to guarantee the tiles below belong to the city being reported.
  if (cityId && cityId !== "manila") {
    await page.evaluate((id) => {
      const button = document.querySelector(`[data-city="${id}"]`);
      if (button) button.click();
    }, cityId);
    await sleep(2600);
  }
  await sleep(500);
  return { page, net, consoleErrors, bootMs };
}

for (const city of CITIES) {
  if (ONLY && city.id !== ONLY) continue;
  const cityReport = { city: city.id, label: city.label, runs: [] };

  for (let run = 0; run < RUNS; run += 1) {
    const runReport = { run, zooms: [], interaction: null, authoring: null };

    // One cold load per zoom level. Jumping between zooms inside one page hits
    // MapLibre's in-memory tile cache and would report ~0 bytes, so every zoom
    // gets its own boot: that is also exactly the "first open at this zoom"
    // experience a player has.
    for (const zoom of ZOOMS) {
      const { page, net, consoleErrors } = await openBench(MOBILE, city.id);
      const boot = await readMetrics(page);
      const bootNet = net.snapshot();
      if (!report.userAgent) report.userAgent = await page.evaluate(() => navigator.userAgent);

      net.reset();
      const t0 = Date.now();
      await page.evaluate((z) => {
        const button = document.querySelector(`[data-zoom="${z}"]`);
        if (button) button.click();
      }, zoom);
      await page.waitForFunction(
        (z) => {
          const map = window.__mosMap;
          return map ? Math.abs(map.getZoom() - z) < 0.01 : false;
        },
        { timeout: 12000 },
        zoom,
      ).catch(() => {});
      // Settle: vector tiles keep arriving after the zoom level changes.
      await sleep(zoom >= 15 ? 2800 : 2200);
      const stats = net.snapshot();
      const metrics = await readMetrics(page);
      const shot = await shoot(page, `${MODE}-${city.id}-z${zoom}`);
      runReport.zooms.push({
        zoom,
        shot: path.basename(shot),
        bootReadyMs: boot.readyMs,
        bootIdleMs: boot.idleMs,
        bootNet: {
          requests: bootNet.requests,
          bytes: bootNet.bytes,
          tileRequests: bootNet.tileRequests,
          tileBytes: bootNet.tileBytes,
          failures: bootNet.failures,
        },
        zoomMs: Date.now() - t0,
        requests: stats.requests,
        bytes: stats.bytes,
        tileRequests: stats.tileRequests,
        tileBytes: stats.tileBytes,
        failures: stats.failures,
        statuses: stats.statuses,
        reportedZoom: metrics.zoom,
        tileErrors: metrics.tileErrors,
        blocked: metrics.blocked,
        consoleErrors,
      });
      await page.close();
    }

    // Interaction + authoring run on one warm page (cache disabled, so tiles
    // still come over the wire; the numbers here are about gesture response,
    // not transfer).
    {
      const { page, net, consoleErrors } = await openBench(MOBILE, city.id);
      const before = await page.evaluate(() => window.__mosMap?.getCenter() ?? null);
      await page.mouse.move(195, 430);
      await page.mouse.down();
      await page.mouse.move(255, 500, { steps: 14 });
      await page.mouse.up();
      await sleep(900);
      const after = await page.evaluate(() => window.__mosMap?.getCenter() ?? null);
      const moved =
        before && after
          ? Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng) > 0.00001
          : false;

      await page.evaluate(() => {
        const toggle = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "创作者选点",
        );
        toggle?.click();
      });
      await page
        .waitForFunction(() => window.__mosMapMetrics?.readyMs !== null, { timeout: 20000 })
        .catch(() => {});
      await sleep(1500);
      await page.mouse.click(195, 430);
      await sleep(700);
      const clickReadout = await page.evaluate(
        () => document.querySelector('[data-testid="click-readout"]')?.textContent ?? "",
      );
      const shot = await shoot(page, `${MODE}-${city.id}-authoring`);
      runReport.interaction = { centreMoved: moved, before, after };
      runReport.authoring = { clickReadout, shot: path.basename(shot), consoleErrors };
      await page.close();
    }

    cityReport.runs.push(runReport);
  }

  // Desktop pass: one screenshot per city at z15, so typography can be judged
  // at a realistic laptop width too.
  const { page, net, consoleErrors } = await openBench(DESKTOP, city.id);
  await page.evaluate(() => {
    const button = document.querySelector('[data-zoom="15"]');
    if (button) button.click();
  });
  await sleep(3000);
  await shoot(page, `${MODE}-${city.id}-desktop-z15`);
  cityReport.desktop = { ...(await readMetrics(page)), net: net.snapshot(), consoleErrors };
  await page.close();

  report.cities.push(cityReport);
  console.log(`done ${MODE} ${city.id}`);
}

await browser.close();
fs.writeFileSync(path.join(OUT, `report-${MODE}.json`), JSON.stringify(report, null, 2));
console.log(`wrote ${path.join(OUT, `report-${MODE}.json`)}`);
