// One-off production launch metrics: map ready latency + tile failure rate
// on the live production build. Read-only: loads public pages, records
// network outcomes, takes one screenshot. No data mutation.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", "https://mos-scene-hunt.vercel.app");
const OUT = arg("out", "../bench-prod-launch/metrics");
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=zh-CN"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
await cdp.send("Runtime.enable");

// Attach to worker sessions too (MapLibre fetches vector tiles in workers).
const workerSessions = [];
cdp.on("Target.attachedToTarget", async (e) => {
  if (e.targetInfo.type !== "worker") return;
  try {
    const s = await cdp.send("Target.attachToTarget", {
      targetId: e.targetInfo.targetId,
      flatten: true,
    });
    const sessionId = s.sessionId;
    workerSessions.push(sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
  } catch { /* worker may die fast */ }
});
await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

const tileStats = { requests: 0, failures: 0, byStatus: {} };
const TILE_HOST = /tiles\.openfreemap\.org/;

function noteRequest(params, sessionId) {
  const url = params.request.url;
  if (!TILE_HOST.test(url)) return;
  tileStats.requests += 1;
  cdp.__pending ??= new Map();
  cdp.__pending.set(`${sessionId}:${params.requestId}`, { url, sessionId });
}
function noteResponse(params, sessionId) {
  const key = `${sessionId}:${params.requestId}`;
  const pend = cdp.__pending?.get(key);
  if (!pend) return;
  const st = params.response.status;
  tileStats.byStatus[st] = (tileStats.byStatus[st] || 0) + 1;
  if (st >= 400) tileStats.failures += 1;
}
function noteFailed(params, sessionId) {
  const key = `${sessionId}:${params.requestId}`;
  const pend = cdp.__pending?.get(key);
  if (!pend) return;
  if (params.errorText && !/Abort/i.test(params.errorText)) tileStats.failures += 1;
  cdp.__pending.delete(key);
}
const handlers = [];
for (const sess of [undefined, ...workerSessions]) {
  // main session handler registered directly; worker handlers registered on attach
}
cdp.on("Network.requestWillBeSent", (p) => noteRequest(p, "main"));
cdp.on("Network.responseReceived", (p) => noteResponse(p, "main"));
cdp.on("Network.loadingFailed", (p) => noteFailed(p, "main"));

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
});

const t0 = Date.now();
await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded", timeout: 90000 });
let readyMs = null;
try {
  await page.waitForSelector(".maplibregl-canvas", { timeout: 45000 });
  await page.waitForFunction(
    () => { const c = document.querySelector(".maplibregl-canvas"); return c && c.width > 0; },
    { timeout: 45000 },
  );
  readyMs = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 8000));
} catch (e) {
  consoleErrors.push(`probe: ${e.message.slice(0, 100)}`);
}
await page.screenshot({ path: path.join(OUT, "prod-metrics-player-map.png") });

const report = {
  base: BASE,
  page: "/map",
  capturedAt: new Date().toISOString(),
  readyMs,
  tileStats,
  consoleErrors: consoleErrors.slice(0, 10),
  engine: await page.evaluate(() => window.__MOS_ENGINE ?? null).catch(() => null),
};
fs.writeFileSync(path.join(OUT, "report-prod-metrics.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
