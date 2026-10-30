/**
 * V1.0 模块 H 探针：真人存档保护 / 演示奖励隔离（决策 D-001/D-002/D-011）。
 *
 * 真实 Chrome 交互验证：
 *   A. 演示期间存档隔离（字节级）：
 *      1. 预置真人进度（完成第 1 站），快照全部玩家键的原始内容 + SHA-256
 *      2. 通过 kiosk 深链 ?demo=1 运行完整自动演示（全部站点完成、出现演示结束页）
 *      3. 演示结束后【不重进玩家模式、不触发 hydration】，在同一演示页面上下文中
 *         直接读取 localStorage 玩家键，对比原始内容与 SHA-256
 *      要求：逐字节一致（原始字符串相等且 SHA-256 相等）
 *   B. 重进真人游戏（语义级）：
 *      1. 以玩家模式重新进入，触发 hydration/reconcile
 *      2. 比较完成站点、奖励 id、背包、关键词等有效进度
 *      3. 记录 lastUpdatedAt 等归一化变化（要求：有效进度不丢失，归一化须如实记录）
 *   另：演示状态只存在于 sessionStorage 的 demo 命名空间；退出回游戏中心。
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
/** The app resolves the active pack from this pointer (not ?game=). */
const CURRENT_KEY = "mos-scene-hunt:current-authored-game";

mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (m) => process.stdout.write(m + "\n");
/** 归一化记录（如实写入 summary，不虚报）。 */
const normalizationNote = {};

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
    // reward id 格式见 lib/game/state.ts rewardId(): `${sceneId}:${type}:${value}`
    g1: { sceneId: "g1", status: "completed", attempts: 1, grantedRewardIds: ["g1:keyword:线索甲"], completedAt: 111 },
    g2: { sceneId: "g2", status: "locked", attempts: 0, grantedRewardIds: [] },
  },
  // 背包条目是对象记录（lib/game/state.ts InventoryItem），不是字符串。
  inventory: [{ id: "keyword:线索甲", type: "keyword", title: "线索", value: "线索甲", sceneId: "g1" }],
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

/**
 * Player keys with SHA-256 digests (computed in-page via crypto.subtle).
 * Byte-level evidence: raw string equality AND digest equality.
 */
async function hashPlayerKeys(page) {
  return page.evaluate(async (indexKey) => {
    const raw = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key === null) continue;
      if (key.startsWith("mos-scene-hunt:save:") || key === indexKey) {
        raw[key] = window.localStorage.getItem(key);
      }
    }
    const sha256 = {};
    for (const [k, v] of Object.entries(raw)) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v ?? ""));
      sha256[k] = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    return { raw, sha256 };
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
      (authoringKey, saveKey, currentKey, gameJson, stateJson, indexKey) => {
        window.localStorage.setItem(authoringKey, gameJson);
        // 模拟设计者「保存并立即试玩」后的真实指针状态。
        window.localStorage.setItem(currentKey, JSON.parse(gameJson).id);
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
      CURRENT_KEY,
      JSON.stringify(SEED_GAME),
      JSON.stringify(SEED_STATE),
      INDEX_KEY,
    );
    const snap = await snapshotPlayerKeys(page);
    assert(Object.keys(snap).includes(SAVE_KEY), "save 键应已写入");
  });

  let snapshotBefore = null;
  await check("快照玩家键（演示前）：原始内容 + SHA-256", async () => {
    snapshotBefore = await hashPlayerKeys(page);
    assert(snapshotBefore.raw[SAVE_KEY].includes('"completed"'), "快照应包含已完成进度");
    assert(snapshotBefore.sha256[SAVE_KEY]?.length === 64, "SHA-256 应已计算");
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

  // A 项字节级证据：此处发生在演示结束页上，期间【没有】任何玩家模式导航、
  // 没有 hydration——直接在当前演示页面上下文里 evaluate 读取 localStorage。
  await check("A·演示后真人存档逐字节一致（原始内容 + SHA-256，D-001）", async () => {
    const after = await hashPlayerKeys(page);
    const beforeRaw = JSON.stringify(snapshotBefore.raw);
    const afterRaw = JSON.stringify(after.raw);
    assert(beforeRaw === afterRaw, `玩家键原始内容变化：\n前=${beforeRaw}\n后=${afterRaw}`);
    const beforeHash = JSON.stringify(snapshotBefore.sha256);
    const afterHash = JSON.stringify(after.sha256);
    assert(beforeHash === afterHash, `玩家键 SHA-256 变化：\n前=${beforeHash}\n后=${afterHash}`);
    normalizationNote.saveSha256Before = snapshotBefore.sha256[SAVE_KEY];
    normalizationNote.saveSha256After = after.sha256[SAVE_KEY];
  });

  await check("演示状态只在 demo 命名空间（D-012）", async () => {
    const probe = await page.evaluate((seedId) => {
      return {
        demoSession: window.sessionStorage.getItem(`mos-scene-hunt:demo:${seedId}`),
        playerSaveTouched: window.localStorage.getItem(`mos-scene-hunt:save:${seedId}`),
      };
    }, SEED_ID);
    assert(probe.demoSession !== null, "sessionStorage 应有 demo 存档");
    assert(probe.playerSaveTouched === snapshotBefore.raw[SAVE_KEY], "localStorage 玩家存档不得变化");
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

  /**
   * B 项语义级证据：以玩家模式重进触发 hydration/reconcile 后，比较有效进度。
   *
   * 已知归一化（产品既有行为，非演示造成；演示造成的字节级变化已在上证为 0）：
   * reconcile 会按包内奖励 id 重建背包条目并刷新 lastUpdatedAt。
   * 本检查断言有效进度不丢失，并把归一化差异如实记录进 summary。
   */
  await check("B·重进玩家页：有效进度完整 + 记录归一化（D-002/D-011）", async () => {
    const before = JSON.parse(snapshotBefore.raw[SAVE_KEY]).state;
    await page.goto(`${BASE}/select?game=${SEED_ID}`, { waitUntil: "domcontentloaded" });
    await sleep(1200);
    const after = await page.evaluate((saveKey) => {
      const raw = window.localStorage.getItem(saveKey);
      const parsed = raw ? JSON.parse(raw) : null;
      const s = parsed?.state ?? null;
      if (!s) return null;
      return {
        startedAt: s.startedAt ?? null,
        lastUpdatedAt: s.lastUpdatedAt ?? null,
        statuses: Object.fromEntries(Object.entries(s.scenes ?? {}).map(([id, x]) => [id, x.status])),
        grantedRewardIds: Object.fromEntries(
          Object.entries(s.scenes ?? {}).map(([id, x]) => [id, x.grantedRewardIds ?? []]),
        ),
        inventoryIds: (s.inventory ?? []).map((it) => it.id).sort(),
        keywords: [...(s.keywords ?? [])].sort(),
        completedAt: Object.fromEntries(
          Object.entries(s.scenes ?? {}).map(([id, x]) => [id, x.completedAt ?? null]),
        ),
      };
    }, SAVE_KEY);
    assert(after !== null, "重进后应有真人存档");
    // 有效进度断言
    assert(after.statuses.g1 === "completed", `g1 应保持 completed，实际 ${after.statuses.g1}`);
    assert(after.statuses.g2 === "locked", `g2 应仍为 locked，实际 ${after.statuses.g2}`);
    assert(after.completedAt.g1 === 111, "g1 完成时间戳应不变");
    assert(after.startedAt === before.startedAt, "startedAt 应不变");
    assert(
      JSON.stringify(after.grantedRewardIds) === JSON.stringify({
        g1: before.scenes.g1.grantedRewardIds,
        g2: [],
      }),
      `奖励 id 应不变：${JSON.stringify(after.grantedRewardIds)}`,
    );
    assert(
      JSON.stringify(after.keywords) === JSON.stringify(["线索甲"]),
      `关键词应保留：${JSON.stringify(after.keywords)}`,
    );
    assert(
      JSON.stringify(after.inventoryIds) === JSON.stringify(["keyword:线索甲"]),
      `背包应保留：${JSON.stringify(after.inventoryIds)}`,
    );
    // 归一化记录（不作为失败条件）
    normalizationNote.reenteredLastUpdatedAt = {
      before: before.lastUpdatedAt,
      after: after.lastUpdatedAt,
      changed: before.lastUpdatedAt !== after.lastUpdatedAt,
    };
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
  evidence: normalizationNote,
};
writeFileSync(path.join(ARTIFACTS, "probe-demo-isolation-summary.json"), JSON.stringify(summary, null, 2));
log(`\n结果: ${pass}/${results.length} 通过 → tests/e2e/artifacts/probe-demo-isolation-summary.json`);
process.exit(summary.ok ? 0 : 1);
