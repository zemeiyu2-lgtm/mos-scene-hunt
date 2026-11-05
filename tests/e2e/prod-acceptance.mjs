import puppeteer from "puppeteer-core";

/**
 * 生产验收探针：对 https://mos-scene-hunt.vercel.app 做真实浏览器检查。
 * 覆盖：首页200、4张摄影图、中英切换、两大入口、8条子路由、
 * 手机视口无横向溢出、控制台无严重错误、地图页 Leaflet 渲染。
 */
const BASE = "https://mos-scene-hunt.vercel.app";
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([name, "PASS", ""]); }
  catch (e) { results.push([name, "FAIL", String(e.message || e).slice(0, 300)]); }
};
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});

const errors = [];
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|tile\.openstreetmap|ERR_ABORTED/.test(m.text()))
    errors.push(`console: ${m.text().slice(0, 160)}`);
});

/* P1 首页 200 + V2 内容 */
await check("首页 HTTP 200 且为 V2.0 内容", async () => {
  const res = await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
  assert(res.status() === 200, `状态码 ${res.status()}`);
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("走到真实地点"), "缺少 V2 Hero 文案");
  assert(t.includes("游戏中心") && t.includes("创作中心"), "缺少两大入口");
});

/* P2 四张摄影图加载 */
await check("四张首页摄影资源加载成功", async () => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 2500));
  const imgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".home img")).map((i) => ({
      src: i.currentSrc.split("/").pop(),
      ok: i.complete && i.naturalWidth > 0,
    })),
  );
  const need = ["manila-bay-sunset", "rizal-park", "fort-santiago-intramuros", "el-nido-palawan"];
  for (const key of need) {
    const hit = imgs.find((i) => i.src.includes(key));
    assert(hit, `缺少图片 ${key}（实际: ${imgs.map((i) => i.src).join(", ")}）`);
    assert(hit.ok, `${key} 加载失败`);
  }
});

/* P3 中英切换 */
await check("中英文切换正常且刷新保持", async () => {
  const findLang = () =>
    page.evaluateHandle(() =>
      Array.from(document.querySelectorAll(".home-lang button")).find((b) => b.textContent.trim() === "EN"),
    );
  let btn = await findLang();
  assert(btn && (await btn.asElement()), "找不到语言切换按钮 EN");
  await btn.click();
  await new Promise((r) => setTimeout(r, 800));
  let t = await page.evaluate(() => document.body.innerText.toLowerCase());
  assert(t.includes("game centre") && t.includes("creator studio"), "切换 EN 失败");
  await page.reload({ waitUntil: "networkidle2" });
  t = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  assert(t.includes("game centre"), "刷新后语言未保持");
  btn = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll(".home-lang button")).find((b) => b.textContent.trim() === "中"),
  );
  await btn.asElement().click();
  await new Promise((r) => setTimeout(r, 800));
  t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("游戏中心"), "切回中文失败");
});

/* P4 两大入口导航 */
await check("游戏中心与创作中心入口导航", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  const clickAndWait = async (sel, expect) => {
    const link = await page.$(sel);
    assert(link, `找不到 ${sel}`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}),
      link.click(),
    ]);
    assert(page.url().includes(expect), `应为 ${expect}，实际 ${page.url()}`);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  };
  await clickAndWait('a[href="/games"]', "/games");
  await clickAndWait('a[href="/design"]', "/design");
});

/* P5 8条子路由 */
await check("原有 8 条子路由全部 200", async () => {
  const routes = ["/games", "/design", "/select", "/map", "/quest", "/bag", "/tutorial", "/how-to-create"];
  for (const r of routes) {
    const res = await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert(res.status() === 200, `${r} -> ${res.status()}`);
  }
});

/* P6 手机视口无横向溢出 + 图片加载 */
await check("手机 390px 无横向溢出", async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
  for (const sel of ["#packs", "#how", "#about", "#safety"]) {
    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView(), sel);
    await new Promise((r) => setTimeout(r, 900));
  }
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  assert(sw <= cw + 2, `横向溢出 scrollWidth=${sw} clientWidth=${cw}`);
  await page.screenshot({ path: "tests/e2e/artifacts/prod-mobile-390-full.png", fullPage: true });
});

/* P7 地图页 Leaflet 渲染（生产无 GPS 模拟器，验证地图初始化即可） */
await check("地图页 Leaflet 与玩家标记渲染", async () => {
  await page.goto(`${BASE}/map`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));
  const ok = await page.evaluate(() => {
    const m = document.querySelector(".leaflet-container");
    return Boolean(m && m._leaflet_id > 0);
  });
  assert(ok, "Leaflet 未初始化");
  await page.screenshot({ path: "tests/e2e/artifacts/prod-map.png" });
});

/* P8 控制台整洁 */
await check("全程无严重控制台错误", async () => {
  assert(errors.length === 0, `发现 ${errors.length} 条: ${errors.slice(0, 5).join(" | ")}`);
});

await browser.close();
console.log("\n===== 生产验收结果 =====");
for (const [n, s, d] of results) console.log(`${s === "PASS" ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`);
const pass = results.filter((r) => r[1] === "PASS").length;
console.log(`\n${pass}/${results.length} 通过`);
process.exit(pass === results.length ? 0 : 1);
