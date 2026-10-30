/**
 * V1.0 模块 H 探针：真人存档保护 / 演示奖励隔离（决策 D-001/D-002/D-011）。
 *
 * 真实 Chrome 交互验证：
 *   1. 预置真人进度（完成第 1 站）并快照全部玩家键（save 键逐字节、save-index）
 *   2. 通过 kiosk 深链 ?demo=1 运行完整自动演示（全部站点完成、出现演示结束页）
 *   3. 演示结束后：真人存档逐字节一致；save-index 一致（演示不进恢复列表）
 *   4. 演示状态只存在于 sessionStorage 的 demo 命名空间，不污染 localStorage
 *   5. 退出演示后重进玩家页：进度仍为预置值（继续寻宝可见）
 *
 * 运行：E2E_BASE_URL=http://127.0.0.1:3102 node tests/e2e/probe-demo-isolation.mjs
 * 需要 NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1 构建的产物（tests/e2e/run.mjs 的构建即满足）。
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const SEED_ID = "probe-demo-iso";
const SAVE_KEY = `mos-scene-hunt:save:${SEED_ID}`;
const INDEX_KEY = "mos-scene-hunt:save-index";
const AUTHORING_KEY = `mos-scene-hunt:authoring:${SEED_ID}`;

mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (m) => process.stdout.write(m + "\n");

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    log(`  ✓ ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, error: msg });
    log(`  ✗ ${name}\n      ${msg}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const SEED_GAME = {
  id: SEED_ID,
  language: "zh-CN",
  title: "探针·演示隔离",
  description: "验证自动演示不写真人存档",
  version: "0.1.0",
  startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
  entrySceneId: "g1",
  scenes: [
    {
      id: "g1",
      title: "隔离站点一",
      story: "ISO-STORY-1",
      location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "站点一" },
      nextSceneId: "g2",
      challenge: { type: "choice", question: "隔离问题一？", options: ["甲", "乙"], answer: 1 },
      reward: { type: "keyword", title: "线索", value: "线索甲" },
    },
    {
      id: "g2",
      title: "隔离站点二",
      story: "ISO-STORY-2",
      location: { lat: 14.5845, lng: 120.9802, radius: 20, name: "站点二" },
      nextSceneId: null,
      challenge: { type: "choice", question: "隔离问题二？", options: ["甲", "乙"], answer: 0 },
      reward: { type: "keyword", title: "线索", value: "线索乙" },
    },
  ],
};

const SEED_STATE = {
  gameId: SEED_ID,
  gameVersion: "0.1.0",
  currentSceneId: null,
  scenes: {
    g1: { sceneId: "g1", status: "completed", attempts: 1, grantedRewardIds: ["r-g1"], completedAt: 111 },
    g2: { sceneId: "g2", status: "locked", attempts: 0, grantedRewardIds: [] },
  },
  inventory: ["线索甲"],
  keywords: ["线索甲"],
  startedAt: 1,
  lastUpdatedAt: 1,
};

/** Only player-owned keys - never the demo namespace (which is sessionStorage). */
async function snapshotPlayerKeys(page) {
  return page.evaluate((indexKey) => {
    const out = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key === null) continue;
      if (key.startsWith("mos-scene-hunt:save:") || key === indexKey) {
        out[key] = window.localStorage.getItem(key);
      }
    }
    return out;
  }, INDEX_KEY);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  userDataDir: mkdtempSync(path.join(tmpdir(), "mos-demo-iso-")),
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  await check("预置真人进度与本地包，记录快照", async () => {
    await page.goto(`${BASE}/select?game=${SEED_ID}`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      (authoringKey, saveKey, gameJson, stateJson, indexKey) => {
        window.localStorage.setItem(authoringKey, gameJson);
        const envelope = {
          schemaVersion: 1,
          savedAt: Date.now(),
          gameId: JSON.parse(gameJson).id,
          gameVersion: "0.1.0",
          state: JSON.parse(stateJson),
        };
        window.localStorage.setItem(saveKey, JSON.stringify(envelope));
        // save-index：真人在列表里；演示之后必须原样。
        window.localStorage.setItem(
          indexKey,
          JSON.stringify([
            { gameId: JSON.parse(gameJson).id, title: "探针·演示隔离", completedScenes: 1, totalScenes: 2, lastPlayedAt: 1 },
          ]),
        );
      },
      AUTHORING_KEY,
      SAVE_KEY,
      JSON.stringify(SEED_GAME),
      JSON.stringify(SEED_STATE),
      INDEX_KEY,
    );
    const snap = await snapshotPlayerKeys(page);
    assert(Object.keys(snap).includes(SAVE_KEY), "save 键应已写入");
  });

  let snapshotBefore = null;
  await check("快照玩家键（演示前）", async () => {
    snapshotBefore = await snapshotPlayerKeys(page);
    assert(snapshotBefore[SAVE_KEY].includes('"completed"'), "快照应包含已完成进度");
  });

  await check("运行完整自动演示至结束页（≤3 分钟）", async () => {
    await page.goto(`${BASE}/select?game=${SEED_ID}&demo=1`, { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + 180_000;
    let finished = false;
    while (Date.now() < deadline) {
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      if (text.includes("演示完成")) {
        finished = true;
        break;
      }
      await sleep(1500);
    }
    assert(finished, "3 分钟内未看到演示结束页");
  });

  await check("演示后真人存档逐字节一致（D-001）", async () => {
    const after = await snapshotPlayerKeys(page);
    const before = JSON.stringify(snapshotBefore);
    const later = JSON.stringify(after);
    assert(before === later, `玩家键发生变化：\n前=${before}\n后=${later}`);
  });

  await check("演示状态只在 demo 命名空间（D-012）", async () => {
    const probe = await page.evaluate((seedId) => {
      return {
        demoSession: window.sessionStorage.getItem(`mos-scene-hunt:demo:${seedId}`),
        playerSaveTouched: window.localStorage.getItem(`mos-scene-hunt:save:${seedId}`),
      };
    }, SEED_ID);
    assert(probe.demoSession !== null, "sessionStorage 应有 demo 存档");
    assert(probe.playerSaveTouched === snapshotBefore[SAVE_KEY], "localStorage 玩家存档不得变化");
  });

  await check("退出演示回到游戏中心", async () => {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((b) => (b.textContent ?? "").includes("返回游戏中心"));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
    assert(clicked, "未找到「返回游戏中心」按钮");
    await page.waitForFunction(
      () => window.location.pathname === "/games",
      { timeout: 20_000 },
    );
  });

  await check("退出后重进玩家页：进度保持（D-002/D-011）", async () => {
    await page.goto(`${BASE}/select?game=${SEED_ID}`, { waitUntil: "domcontentloaded" });
    await sleep(1200);
    const after = await snapshotPlayerKeys(page);
    assert(
      JSON.stringify(after) === JSON.stringify(snapshotBefore),
      "退出演示后玩家键必须与演示前一致",
    );
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    assert(text.includes("继续寻宝"), "应显示「继续寻宝」（已有真人进度）");
  });
} finally {
  await browser.close().catch(() => {});
}

const pass = results.filter((r) => r.ok).length;
const summary = {
  probe: "demo-isolation",
  ranAt: new Date().toISOString(),
  pass,
  total: results.length,
  ok: pass === results.length,
  results,
};
writeFileSync(path.join(ARTIFACTS, "probe-demo-isolation-summary.json"), JSON.stringify(summary, null, 2));
log(`\n结果: ${pass}/${results.length} 通过 → tests/e2e/artifacts/probe-demo-isolation-summary.json`);
process.exit(summary.ok ? 0 : 1);
