/**
 * 本机存储检查与「删除本地副本」的真实浏览器验收。
 *
 * 覆盖：
 *   1. 创作库/创作中心列出本机游戏包数量、总占用与单包大小
 *   2. 内嵌素材单独计量（作者唯一能压缩的部分）
 *   3. 容量估算只以「浏览器额度（估算）」出现，并声明不等于手机磁盘空间
 *   4. 删除确认框写明游戏名、只删本机、线上不受影响
 *   5. 删除只影响目标包，其他包与它们的进度原样保留；刷新后结果仍有效
 *   6. 删除过程中没有发出任何非 GET 请求（不可能触达线上删除/下架）
 *   7. 已发布的游戏：删除本地副本后 /api/games/<id> 仍返回 200 且版本不变
 *   8. 配额不足（在真实浏览器里模拟 QuotaExceededError）时提示清晰，
 *      且上一版存档逐字节未变
 *   9. 重复保存不会累积副本
 *
 * 运行：node tests/e2e/run-probe.mjs probe-local-storage.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const PREFIX = "mos-scene-hunt:authoring:";

const IDS = ["probe-ls-a", "probe-ls-b", "probe-ls-c", "probe-ls-d"];
const PUB_ID = "probe-ls-pub";

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

function makeGame(id, title, photoBytes = 0) {
  const game = {
    id,
    language: "zh-CN",
    title,
    description: "本机存储验收用游戏包",
    version: "0.1.0",
    startLocation: { lat: 14.58305, lng: 120.97936, radius: 30, name: "起点" },
    entrySceneId: "g1",
    scenes: [
      {
        id: "g1",
        title: "站点一",
        story: "STORAGE-PROBE",
        location: { lat: 14.58305, lng: 120.97936, radius: 20, name: "站点一" },
        nextSceneId: null,
        challenge: { type: "choice", question: "选哪个？", options: ["甲", "乙"], answer: 1 },
        reward: { type: "keyword", title: "线索", value: "线索" },
      },
    ],
  };
  if (photoBytes > 0) {
    game.scenes[0].media = [
      {
        id: "media-probe",
        kind: "image",
        title: "现场照片.jpg",
        url: "data:image/jpeg;base64," + "A".repeat(photoBytes),
        mimeType: "image/jpeg",
      },
    ];
  }
  return game;
}

const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const keysOf = (page) =>
  page.evaluate(() => {
    const out = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) out.push(key);
    }
    return out;
  });
const readPack = (page, id) =>
  page.evaluate((k) => window.localStorage.getItem(k), `${PREFIX}${id}`);

async function clickByText(page, selector, needle) {
  const info = await page.evaluate(
    (sel, text) => {
      const el = Array.from(document.querySelectorAll(sel)).find(
        (n) => (n.textContent ?? "").includes(text) && n.offsetParent !== null && !n.disabled,
      );
      if (!el) return { ok: false };
      el.scrollIntoView({ block: "center" });
      el.click();
      return { ok: true };
    },
    selector,
    needle,
  );
  assert(info.ok, `找不到可点击元素：${selector} 含「${needle}」`);
  await sleep(400);
}

/** Publish a pack so "已发布" can be proven, then read it back from the server. */
async function publish(game) {
  const response = await fetch(`${BASE}/api/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(game),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.versionId) {
    throw new Error(`发布失败：HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const publishedVersion = async (gameId) => {
  const response = await fetch(`${BASE}/api/games/${gameId}`, { cache: "no-store" });
  return { status: response.status, versionId: response.headers.get("X-Game-Version") };
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: mkdtempSync(path.join(tmpdir(), "mos-storage-")),
  args: ["--no-sandbox", "--no-proxy-server"],
});

let dialogMode = "accept";
const dialogs = [];
const requests = [];
let measurement = [];
let originEstimate = { supported: false };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    if (dialogMode === "accept") await dialog.accept();
    else await dialog.dismiss();
  });
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));

  // 配额开关：在真实浏览器的 Storage 上模拟 QuotaExceededError，默认关闭，
  // 只在第 9 项里打开，避免影响前面的真实写入。
  await page.evaluateOnNewDocument(() => {
    window.__mosQuotaArmed = false;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (window.__mosQuotaArmed) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });

  // ---------------------------------------------------------------- 准备数据
  await page.goto(`${BASE}/games`, { waitUntil: "networkidle2" });
  const seeds = [
    makeGame(IDS[0], "探针·存储甲"),
    makeGame(IDS[1], "探针·存储乙"),
    makeGame(IDS[2], "探针·存储丙", 150_000),
    makeGame(IDS[3], "探针·存储丁"),
  ];
  await page.evaluate((prefix, packs) => {
    for (const pack of packs) window.localStorage.setItem(prefix + pack.id, JSON.stringify(pack));
  }, PREFIX, seeds);

  const seededKeys = (await keysOf(page)).filter((key) => key.startsWith(PREFIX));
  assert(seededKeys.length === 4, `准备阶段应为 4 个本机包，实际 ${seededKeys.length}`);

  // ------------------------------------------------- 1. 列表、数量与总占用
  await page.goto(`${BASE}/create`, { waitUntil: "networkidle2" });
  await sleep(1500);

  await check("创作库列出 4 个本机游戏包，并给出总占用", async () => {
    const text = await bodyText(page);
    assert(/本地游戏包：4 个，占用约\s[\d.]+\s(KB|MB)/.test(text), `没有数量与总占用：${text.slice(0, 200)}`);
    for (const seed of seeds) assert(text.includes(seed.title), `缺少游戏包：${seed.title}`);
  });

  await check("单包大小逐个显示，内嵌素材单独计量", async () => {
    const text = await bodyText(page);
    const sizes = text.match(/个体验点 · 约\s[\d.]+\s(B|KB|MB)/g) ?? [];
    assert(sizes.length === 4, `应有 4 行单包占用，实际 ${sizes.length}`);
    assert(/内嵌素材 1 个（\d+%）/.test(text), "没有标出探针·存储丙的内嵌素材");
  });

  await check("容量只以「浏览器额度（估算）」出现，并说明不等于手机磁盘空间", async () => {
    const text = await bodyText(page);
    assert(text.includes("浏览器额度（估算）"), "没有显示浏览器额度");
    assert(text.includes("不是手机的可用磁盘空间"), "没有声明这是估算值");
    assert(!/最多\s*4\s*个/.test(text), "出现了固定数量上限的说法");
    await page.screenshot({ path: path.join(ARTIFACTS, "local-storage-panel.png"), fullPage: true });
  });

  await check("线上状态按服务端事实显示（均为未发布）", async () => {
    const text = await bodyText(page);
    const published = text.match(/线上已发布/g) ?? [];
    assert(published.length === 0, `未发布的游戏被标成已发布（出现 ${published.length} 次）`);
    assert((text.match(/线上未发布/g) ?? []).length === 4, "线上状态没有逐个显示");
  });

  // 供报告引用的真实测量值：每个包的字节、其中内嵌素材占比、以及浏览器
  // 自己报告的 origin 用量/额度。全部来自这个真实浏览器，不是估算的字符串。
  const measurementNow = await page.evaluate((prefix) => {
    const encoder = new TextEncoder();
    const packs = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(key) ?? "";
      let media = 0;
      try {
        const parsed = JSON.parse(raw);
        for (const scene of parsed.scenes ?? []) {
          for (const item of [...(scene.media ?? []), ...(scene.challenge?.media ?? [])]) {
            if (typeof item?.url === "string" && item.url.startsWith("data:")) media += item.url.length;
          }
        }
      } catch {
        /* ignore */
      }
      packs.push({
        id: key.slice(prefix.length),
        bytes: encoder.encode(raw).length,
        mediaBytes: media,
      });
    }
    return packs;
  }, PREFIX);
  measurement = measurementNow;

  await check("测量值可被报告引用（每包字节数 > 0）", async () => {
    assert(measurement.length === 4, `测量到 ${measurement.length} 个包`);
    assert(measurement.every((pack) => pack.bytes > 0), "存在 0 字节的包");
    const heavy = measurement.find((pack) => pack.mediaBytes > 0);
    assert(heavy && heavy.mediaBytes > 150_000, "内嵌素材没有被计入");
    log(
      `      实测：${measurement
        .map((pack) => `${pack.id}=${(pack.bytes / 1024).toFixed(1)}KB(素材 ${(pack.mediaBytes / 1024).toFixed(0)}KB)`)
        .join("，")}`,
    );
  });

  // ------------------------------------------------------ 2. 删除本地副本
  const beforeDelete = await readPack(page, IDS[0]);
  const otherBefore = await readPack(page, IDS[1]);
  requests.length = 0;
  dialogMode = "accept";
  dialogs.length = 0;

  await check("删除前确认框写明游戏名、只删本机、线上不受影响", async () => {
    const card = await page.evaluateHandle((title) => {
      const heading = Array.from(document.querySelectorAll("p, h3")).find(
        (n) => n.textContent?.trim() === title,
      );
      return heading?.closest("div.rounded-xl") ?? null;
    }, "探针·存储甲");
    const element = card.asElement();
    assert(element, "找不到探针·存储甲的卡片");
    const clicked = await element.evaluate((node) => {
      const button = Array.from(node.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("删除本地副本"),
      );
      if (!button) return false;
      button.click();
      return true;
    });
    assert(clicked, "卡片里没有「删除本地副本」按钮");
    await sleep(800);

    assert(dialogs.length === 1, `确认框没有出现（dialogs=${dialogs.length}）`);
    const message = dialogs[0];
    assert(message.includes("探针·存储甲"), `确认框没有写明游戏名：${message}`);
    assert(message.includes("只会删除这台设备当前浏览器里的副本"), `没有说明只删本机：${message}`);
    assert(message.includes("线上"), `没有说明线上不受影响：${message}`);
    log(`      确认框原文：${message.split("\n").filter(Boolean).slice(0, 3).join(" / ")}`);
  });

  await check("删除只作用于这一份，其他包逐字节保留", async () => {
    assert((await readPack(page, IDS[0])) === null, "目标包仍在存储里");
    assert((await readPack(page, IDS[1])) === otherBefore, "另一个包的内容被改动了");
    const remaining = (await keysOf(page)).filter((key) => key.startsWith(PREFIX));
    assert(remaining.length === 3, `应剩 3 个本机包，实际 ${remaining.length}`);
    assert(!beforeDelete || beforeDelete.length > 0, "前置数据异常");
  });

  await check("列表与占用立刻刷新为 3 个", async () => {
    const text = await bodyText(page);
    assert(text.includes("本地游戏包：3 个"), `列表没有刷新：${text.slice(0, 160)}`);
    // The status line legitimately quotes the deleted title, so count the
    // delete buttons instead of searching the whole page for the name.
    const deleteButtons = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("button")).filter((button) =>
          button.textContent?.includes("删除本地副本"),
        ).length,
    );
    assert(deleteButtons === 3, `列表里还有 ${deleteButtons} 个可删除项，应为 3`);
  });

  await check("删除过程中没有任何非 GET 请求", async () => {
    const writes = requests.filter((request) => request.method !== "GET");
    assert(writes.length === 0, `出现了写请求：${JSON.stringify(writes.slice(0, 3))}`);
    const apiCalls = requests.filter((request) => request.url.includes("/api/"));
    assert(
      apiCalls.every((request) => /\/api\/games\//.test(request.url)),
      `出现了非只读的 API 调用：${JSON.stringify(apiCalls.slice(0, 3))}`,
    );
  });

  await check("重新打开创作库后删除结果仍然有效", async () => {
    await page.goto(`${BASE}/create`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const text = await bodyText(page);
    assert(text.includes("本地游戏包：3 个"), `重新打开后数量不对：${text.slice(0, 160)}`);
    assert(!text.includes("探针·存储甲"), "重新打开后被删除的游戏又出现了");
  });

  // ------------------------------------- 3. 已发布游戏：删本地不动线上
  const published = await publish(makeGame(PUB_ID, "探针·已发布"));
  await page.evaluate((prefix, key, value) => window.localStorage.setItem(prefix + key, value), PREFIX, PUB_ID, JSON.stringify(makeGame(PUB_ID, "探针·已发布")));

  await check("已发布的本机包在面板上标为「线上已发布」", async () => {
    await page.goto(`${BASE}/create`, { waitUntil: "networkidle2" });
    await sleep(1800);
    const text = await bodyText(page);
    assert(text.includes("线上已发布"), "面板没有标出线上已发布");
    assert(text.includes("打开线上版本"), "没有提供打开线上版本的入口");
  });

  await check("删除本地副本后，线上版本仍返回 200 且版本号不变", async () => {
    const before = await publishedVersion(PUB_ID);
    assert(before.status === 200, `删除前线上读取失败：${before.status}`);
    assert(before.versionId === published.versionId, "删除前版本号不符");

    dialogMode = "accept";
    await page.evaluateHandle((title) => {
      const heading = Array.from(document.querySelectorAll("p, h3")).find(
        (n) => n.textContent?.trim() === title,
      );
      const card = heading?.closest("div.rounded-xl");
      const button = card
        ? Array.from(card.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("删除本地副本"),
          )
        : null;
      button?.click();
    }, "探针·已发布");
    await sleep(1200);

    assert((await readPack(page, PUB_ID)) === null, "本机副本没有被删除");

    const after = await publishedVersion(PUB_ID);
    assert(after.status === 200, `删除本地副本后线上读取失败：${after.status}`);
    assert(after.versionId === published.versionId, `线上版本被改动：${before.versionId} → ${after.versionId}`);

    const playUrl = `${BASE}/select#cloud=${PUB_ID}.${published.versionId}`;
    const playResponse = await fetch(playUrl, { cache: "no-store" });
    assert(playResponse.status === 200, `线上游玩链接打不开：${playResponse.status}`);
  });

  // ---------------------------------------------- 4. 重复保存不累积副本
  await check("重复保存同一份游戏不会累积副本", async () => {
    await page.goto(`${BASE}/design?game=${IDS[1]}`, { waitUntil: "networkidle2" });
    await sleep(2000);
    for (let i = 0; i < 2; i++) {
      // Loaded-from-storage drafts start in the saved state, so the label is
      // 「✓ 已保存到本机」; match on the stable part.
      await clickByText(page, "button", "保存到本机");
      await sleep(500);
    }
    const keys = (await keysOf(page)).filter((key) => key === PREFIX + IDS[1]);
    assert(keys.length === 1, `同一个 ID 出现了 ${keys.length} 个存储键`);
    const text = await bodyText(page);
    assert(text.includes("已保存到本机") || text.includes("已保存"), "保存后没有成功提示");
  });

  // ------------------------------------- 5. 配额不足：提示清晰、旧版无损
  const packBefore = await readPack(page, IDS[1]);
  await page.evaluate(() => {
    window.__mosQuotaArmed = true;
  });
  await clickByText(page, "button", "保存到本机");
  await sleep(800);

  await check("配额不足时出现可执行的提示，而不是「保存失败」", async () => {
    const alert = await page.evaluate(() => {
      const el = document.querySelector('[role="alert"]');
      return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
    });
    assert(alert, "配额不足时没有任何提示");
    assert(alert.includes("本机存储已满"), `提示没有说明原因：${alert}`);
    assert(/约\s[\d.]+\s(B|KB|MB)/.test(alert), `提示没有给出这一份的大小：${alert}`);
    assert(alert.includes("删除不再需要的本地副本"), `提示没有给出处理方式：${alert}`);
    assert(alert.includes("上一版没有被改动"), `提示没有安抚旧数据：${alert}`);
    log(`      提示原文：${alert.slice(0, 120)}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "local-storage-quota.png"), fullPage: true });
  });

  await check("配额不足时上一版存档逐字节未变，且仍可读", async () => {
    await page.evaluate(() => {
      window.__mosQuotaArmed = false;
    });
    const packAfter = await readPack(page, IDS[1]);
    assert(packAfter === packBefore, "保存失败后旧存档被改动了");
  });

  await check("页面没有因为配额异常崩溃", async () => {
    assert(pageErrors.length === 0, `页面报错：${pageErrors.slice(0, 2).join(" | ")}`);
  });

  // ------------------------------------------------ 6. 其他入口无回归
  await check("游戏中心的本机游戏仍可正常使用", async () => {
    await page.goto(`${BASE}/games`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const text = await bodyText(page);
    assert(text.includes("本机游戏"), "游戏中心缺少本机游戏区块");
    assert(text.includes("探针·存储乙"), "本机游戏列表没有显示已保存的游戏");
    assert(pageErrors.length === 0, `页面报错：${pageErrors.slice(0, 2).join(" | ")}`);
  });

  originEstimate = await page.evaluate(async () => {
    const storage = navigator.storage;
    if (!storage?.estimate) return { supported: false };
    const estimate = await storage.estimate();
    const persisted = storage.persisted ? await storage.persisted() : null;
    return { supported: true, usage: estimate.usage ?? null, quota: estimate.quota ?? null, persisted };
  });
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const summary = {
  base: BASE,
  ranAt: new Date().toISOString(),
  total: results.length,
  passed,
  failed,
  measurement,
  originEstimate,
  results,
};
writeFileSync(
  path.join(ARTIFACTS, "probe-local-storage-summary.json"),
  JSON.stringify(summary, null, 2),
);
log(`\n${failed === 0 ? "全部通过" : "存在失败"}：${passed}/${results.length}`);
process.exit(failed === 0 ? 0 : 1);
