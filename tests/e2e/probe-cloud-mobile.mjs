/**
 * 手机端云端获取探针：验证「在独立浏览器（iPhone 视口）上从云端游戏中心
 * 发现 → 下载 → 存入本机 → 启动游戏」这条真实链路。
 *
 * 与 cloud-loop-http.mjs 的分工：
 *   - cloud-loop-http.mjs 验的是**接口契约**（用 fetch 打真实 HTTP）；
 *   - 本探针验的是**玩家视角**：点按钮、看提示、localStorage 里落没落库、
 *     /select 能不能真的把这份云端下载的游戏跑起来。
 * 接口 200 不等于玩家能玩，这两件事必须分开验。
 *
 * 前置：服务已在 E2E_BASE_URL 上运行，且 content/cloud/catalog.json 里
 * 至少有一条 status=published 且包文件存在的条目。
 *
 * 用法：node tests/e2e/run-probe.mjs probe-cloud-mobile.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102";
const ARTIFACTS = path.join(process.cwd(), "tests", "e2e", "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/** iPhone 13 逻辑视口；触摸与 UA 都按手机设置，避免桌面样式掩盖移动端问题。 */
const IPHONE = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
};

const AUTHORING_PREFIX = "mos-scene-hunt:authoring:";
const CURRENT_KEY = "mos-scene-hunt:current-authored-game";
const DEMO_TITLE = "Luneta · 看见这座城市";

mkdirSync(ARTIFACTS, { recursive: true });

const results = [];
const errors = [];

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!existsSync(CHROME)) {
  log(`✗ 找不到 Chrome：${CHROME}`);
  process.exit(2);
}

/** 读取本机游戏库（与 lib/content 用同一个 localStorage 前缀）。 */
async function localGames(page) {
  return page.evaluate(([prefix, currentKey]) => {
    const out = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      try {
        const game = JSON.parse(localStorage.getItem(key) ?? "null");
        if (game?.id) out.push({ id: game.id, title: game.title, scenes: game.scenes?.length ?? 0, current: localStorage.getItem(currentKey) === game.id });
      } catch {
        out.push({ id: `(不可解析:${key})`, title: "", scenes: 0 });
      }
    }
    return out;
  }, [AUTHORING_PREFIX, CURRENT_KEY]);
}

/** 清空本机游戏库，让每条用例都从「新手机」开始。 */
async function resetLibrary(page) {
  await page.evaluate(([prefix, currentKey]) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix) || key === currentKey) localStorage.removeItem(key);
    }
  }, [AUTHORING_PREFIX, CURRENT_KEY]);
}

/**
 * 让 Service Worker 彻底装不上。
 *
 * 为什么必须做：sw.js 会缓存 /content/*.json（离线回退的数据源）。只要它在控制页面，
 * 下载请求就由 SW 直接响应，**绕过 Puppeteer 的网络拦截**——于是「包体损坏」「包 404」
 * 这两个异常用例根本打不到坏数据，只会拿到 SW 缓存里的好包，测试会假失败（假失败比
 * 不测更糟：它会让人去改本来正确的产品代码）。
 *
 * 做法：把 sw.js 的请求本身拦成 404，注册必然失败；再把已存在的注册与缓存清掉。
 * 应用每次挂载都会重新注册，所以「拦截 sw.js」比「注销一次」可靠得多。
 */
async function disableServiceWorker(page, base) {
  // 最可靠的一层：在任何页面脚本执行之前，把 navigator.serviceWorker.register
  // 变成空操作。sw.js 缓存会接管 /content/*.json 并返回好包，让网络层故障注入
  // 完全失效；只靠「注销」不行，因为应用每次挂载都会重新注册。
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        get() {
          return {
            register: async () => {
              throw new Error("service worker disabled for test");
            },
            getRegistrations: async () => [],
            ready: Promise.reject(new Error("service worker disabled for test")),
            controller: null,
            addEventListener() {},
            removeEventListener() {},
          };
        },
      });
    } catch {
      /* 若浏览器不允许覆盖，退回到下面的注销手段 */
    }
  });

  await page.goto(`${base}/games`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  });
  await page.reload({ waitUntil: "networkidle2" });

  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (controlled) {
    log("  · 警告：页面仍受 Service Worker 控制，网络层故障注入可能被 SW 拦截");
  } else {
    log("  · Service Worker 已停用，故障注入可直达代码路径");
  }
}

/** 真实点击某张云端卡片上的「下载到本机」（puppeteer 会先滚动到元素）。 */
async function clickDownload(page, title) {
  const buttons = await page.$$("article button");
  for (const button of buttons) {
    const info = await page.evaluate((el) => {
      const card = el.closest("article");
      return { label: el.textContent?.trim() ?? "", cardText: card?.innerText ?? "" };
    }, button);
    if (info.label.includes("下载到本机") && info.cardText.includes(title)) {
      await button.click();
      return true;
    }
  }
  return false;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // --disable-features=ServiceWorker：SW 会接管 /content/*.json，使网络层故障注入
  // （把包换成坏 JSON / 返回 404）失效。关掉它，异常用例才验的是真实代码路径。
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-features=ServiceWorker"],
  defaultViewport: IPHONE,
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  // ---------- 0. 干净起点：一台没装过任何游戏的新手机 ----------
  await page.goto(`${BASE}/games`, { waitUntil: "domcontentloaded" });
  await resetLibrary(page);
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(600);

  await page.screenshot({ path: path.join(ARTIFACTS, "cloud-mobile-01-games.png") });

  await check("1. 手机视口下云端游戏区可读，无横向溢出", async () => {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      text: document.body.innerText,
    }));
    assert(metrics.text.includes("云端游戏"), `页面缺少「云端游戏」区块：${metrics.text.slice(0, 200)}`);
    assert(
      metrics.scrollWidth <= metrics.clientWidth + 1,
      `出现横向滚动：scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`,
    );
  });

  await check("2. 起始状态本机游戏库为空", async () => {
    const games = await localGames(page);
    assert(games.length === 0, `本机库应为空，实际有：${games.map((g) => g.id).join(",")}`);
  });

  // ---------- 1. 目录与卡片 ----------
  const catalog = await page.evaluate(async () => {
    const res = await fetch("/content/cloud/catalog.json", { cache: "no-store" });
    return { status: res.status, json: res.ok ? await res.json() : null };
  });

  await check("3. 目录接口可读，且只下发已发布条目（无草稿泄漏）", async () => {
    assert(catalog.status === 200, `目录 HTTP ${catalog.status}`);
    assert(Array.isArray(catalog.json?.games) && catalog.json.games.length > 0, "目录里没有游戏");
    const leaked = catalog.json.games.filter((g) => g.status !== "published");
    assert(leaked.length === 0, `目录里出现了非 published 条目：${leaked.map((g) => `${g.id}(${g.status})`).join(",")}`);
  });

  // 挑一条**非官方示范**的云端游戏作为目标，避免和静态示范内容混淆。
  const target =
    catalog.json.games.find((g) => g.packFile && g.id !== "rizal-park-discovery") ?? catalog.json.games.find((g) => g.packFile);

  await check("4. 目标游戏的云端卡片渲染出下载按钮", async () => {
    assert(target, "目录里没有带 packFile 的条目");
    const found = await page.evaluate((title) => {
      const cards = [...document.querySelectorAll("article")];
      const card = cards.find((c) => c.innerText.includes(title));
      if (!card) return "找不到卡片";
      return card.innerText.includes("下载到本机") ? "ok" : "卡片没有下载按钮";
    }, target.title);
    assert(found === "ok", `${target.title}：${found}`);
  });

  // ---------- 2. 下载并入库 ----------
  await check("5. 点击下载后游戏包进入本机游戏库", async () => {
    const clicked = await clickDownload(page, target.title);
    assert(clicked, `没点到「${target.title}」的下载按钮`);

    let games = [];
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      games = await localGames(page);
      if (games.some((g) => g.id === target.id)) break;
    }
    const saved = games.find((g) => g.id === target.id);
    assert(saved, `本机库未出现 ${target.id}，当前：${games.map((g) => g.id).join(",") || "（空）"}`);
    assert(saved.scenes === target.sceneCount, `站数不符：包里 ${saved.scenes} 站，目录声明 ${target.sceneCount} 站`);
  });

  await check("6. 下载成功后提示可见（且不会被目录刷新抹掉）", async () => {
    const found = await page.evaluate(() => {
      const el = document.querySelector('[role="status"]');
      if (!el) return { found: false };
      const rect = el.getBoundingClientRect();
      return { found: true, text: el.innerText, inViewport: rect.top >= 0 && rect.top < window.innerHeight };
    });
    assert(found.found, "页面没有 [role=status] 提示元素（下载成功却没有任何反馈）");
    assert(/已下载并保存/.test(found.text), `提示文案不符：${found.text}`);
    // 等一会儿再看，确认这条提示不是「闪现 30ms 后被清掉」。
    await sleep(1500);
    const still = await page.evaluate(() => document.querySelector('[role="status"]')?.innerText ?? null);
    assert(still && /已下载并保存/.test(still), "提示在 1.5 秒内消失了（被目录刷新覆盖）");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "cloud-mobile-02-downloaded.png"), fullPage: true });

  // ---------- 3. 从本机库启动 ----------
  await check("7. 本机游戏区出现该游戏且可开始", async () => {
    const text = await page.evaluate(() => document.body.innerText);
    assert(text.includes(target.title), `本机游戏区没有显示「${target.title}」`);
    const hasStart = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((n) => n.textContent?.includes("开始游戏")),
    );
    assert(hasStart, "没有出现「开始游戏」按钮");
  });

  await check("8. 点击开始后 /select 加载的是这份云端游戏（不是官方示范）", async () => {
    const buttons = await page.$$("article button");
    for (const button of buttons) {
      const label = await page.evaluate((el) => el.textContent?.trim() ?? "", button);
      if (label.includes("开始游戏")) {
        await button.click();
        break;
      }
    }
    await page.waitForFunction(() => location.pathname.startsWith("/select"), { timeout: 8000 });
    await sleep(1200);
    const text = await page.evaluate(() => document.body.innerText);
    assert(text.includes(target.title), `/select 未显示「${target.title}」，正文片段：${text.slice(0, 300)}`);
    assert(!text.includes(DEMO_TITLE), "/select 回落到了官方示范游戏");
  });

  await page.screenshot({ path: path.join(ARTIFACTS, "cloud-mobile-03-select.png") });

  if (!target?.packFile) {
    log("\n目录里没有可下载条目，第 9、10 项（故障注入）跳过。");
  } else {
  // ---------- 4. 异常路径：坏包 / 缺包都不得污染本机库 ----------
  // 每一项都用**全新的浏览器上下文**：前 8 项里应用已经注册了 Service Worker，
  // 它会接管 /content/*.json 并直接返回缓存里的好包，使网络层故障注入完全失效
  // （表现为「坏包居然入库了」这种假失败）。新上下文是干净的存储与 SW 状态，
  // 加上 evaluateOnNewDocument 覆盖 serviceWorker，坏数据才真正走到页面的 fetch 上。
  //
  // 每项单独一个页面还有第二个理由：请求拦截是**页面级**状态。若两项共用一个页面，
  // 上一项在断言后摘掉 handler 却留着 setRequestInterception(true)，下一项的
  // reload() 就没人应答，直接挂到导航超时（真实踩过的坑）。

  /**
   * 在独立上下文里跑一次「故障注入 + 点击下载」。
   *
   * @param breakPack 拦截到目标包请求时如何伪造响应（返回 null 表示放行）
   */
  const runFaultCase = async (name, breakPack) => {
    await check(name, async () => {
      const context = await browser.createBrowserContext();
      let page;
      try {
        page = await context.newPage();
        page.on("pageerror", (e) => errors.push(`pageerror(fault): ${e.message}`));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(`console(fault): ${m.text()}`);
        });
        await disableServiceWorker(page, BASE);
        await resetLibrary(page);

        // 注意：handler 在**导航之前**挂上，并且在整个用例期间都不摘除。
        // 拦截开启后每个请求都必须有人 continue/respond，否则页面会卡住。
        await page.setRequestInterception(true);
        let hit = 0;
        page.on("request", (req) => {
          if (req.url().endsWith("/" + target.packFile)) {
            hit += 1;
            const fake = breakPack();
            if (fake) return req.respond(fake).catch(() => {});
          }
          return req.continue().catch(() => {});
        });

        await page.reload({ waitUntil: "domcontentloaded" });
        const clicked = await clickDownload(page, target.title);
        await sleep(2500);

        const games = await localGames(page);
        // 用 [aria-live] 精确定位反馈条：LoadingState 也带 role="status"，
        // 只按 role 取会抓到加载转圈，导致误判。
        const status = await page.evaluate(
          () => document.querySelector('[role="status"][aria-live]')?.textContent ?? "",
        );

        assert(clicked, "没点到下载按钮");
        assert(hit > 0, "故障注入没有命中包请求，这个用例什么也没验到（应视为失败而非通过）");
        assert(games.length === 0, `异常包竟然被写进了本机库：${games.map((g) => g.id).join(",")}`);
        assert(
          /拒绝保存|未通过校验|取不到|下载失败|网络/.test(status),
          `没有任何「下载失败」类的提示，实际：${status || "（无提示）"}`,
        );
        return status;
      } finally {
        await page?.close().catch(() => {});
        await context.close().catch(() => {});
      }
    });
  };

  await runFaultCase("9. 包体损坏时拒绝入库，并给出提示", () => ({
    status: 200,
    contentType: "application/json",
    body: "{ this is not a game package",
  }));

  await runFaultCase("10. 包文件缺失（404）时给出可理解的提示且不入库", () => ({
    status: 404,
    contentType: "text/plain",
    body: "not found",
  }));

  await check("11. 网络失败（请求被中断）时给出提示且不入库", async () => {
    const context = await browser.createBrowserContext();
    let page;
    try {
      page = await context.newPage();
      await disableServiceWorker(page, BASE);
      await resetLibrary(page);
      await page.setRequestInterception(true);
      let hit = 0;
      page.on("request", (req) => {
        if (req.url().endsWith("/" + target.packFile)) {
          hit += 1;
          // abort 比 404 更狠：fetch 直接 reject，走的是 catch 分支而不是 !ok 分支。
          return req.abort("internetdisconnected").catch(() => {});
        }
        return req.continue().catch(() => {});
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      const clicked = await clickDownload(page, target.title);
      await sleep(2500);

      const games = await localGames(page);
      const status = await page.evaluate(
        () => document.querySelector('[role="status"][aria-live]')?.textContent ?? "",
      );

      assert(clicked, "没点到下载按钮");
      assert(hit > 0, "故障注入没有命中包请求");
      assert(games.length === 0, `网络失败竟然也入库了：${games.map((g) => g.id).join(",")}`);
      assert(/取不到|下载失败|网络/.test(status), `没有给出网络失败提示，实际：${status || "（无提示）"}`);
    } finally {
      await page?.close().catch(() => {});
      await context.close().catch(() => {});
    }
  });
  }
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

log("\n" + "─".repeat(60));
log(`手机端云端获取探针：共 ${results.length} 项，通过 ${passed}，失败 ${failed}`);
if (errors.length) {
  log("\n浏览器控制台错误（前 10 条）：");
  errors.slice(0, 10).forEach((e) => log("  · " + e));
}

process.exit(failed === 0 ? 0 : 1);
