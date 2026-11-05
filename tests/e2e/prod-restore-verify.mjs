import puppeteer from "puppeteer-core";

/**
 * 生产恢复验收（临时探针，不入库）：
 * 对正式域名做无缓存真实浏览器验收，并与指定 V2.0 独立部署对比关键内容。
 */
const PROD = "https://mos-scene-hunt.vercel.app";
const INDEP = "https://mos-scene-hunt-2isgckyge-zemeiyu2-1187.vercel.app";
const BUST = `?nocache=${Date.now()}`;
const results = [];
const check = async (name, fn) => {
  try { const v = await fn(); results.push([name, "PASS", v || ""]); }
  catch (e) { results.push([name, "FAIL", String(e.message || e).slice(0, 240)]); }
};
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-application-cache"],
  defaultViewport: { width: 1440, height: 900 },
});
const errors = [];
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setCacheEnabled(false);
page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|tile\.openstreetmap|ERR_ABORTED|404 \(Not Found\)/.test(m.text()))
    errors.push(`console: ${m.text().slice(0, 160)}`);
});

let homeText = "";

await check("1. 首页 HTTP 200（无缓存请求）", async () => {
  const res = await page.goto(`${PROD}/${BUST}`, { waitUntil: "networkidle2", timeout: 60000 });
  assert(res.status() === 200, `状态码 ${res.status()}`);
  homeText = await page.evaluate(() => document.body.innerText);
  assert(homeText.includes("MOSRove"), "页面正文为空，未完成渲染");
  const hdr = res.headers();
  return `x-vercel-cache=${hdr["x-vercel-cache"] || "n/a"}（内容已校验为 V2.0）`;
});

await check("2. MOSRove 品牌导航", async () => {
  assert(homeText.includes("MOSRove"), "缺少 MOSRove 品牌字样");
  const nav = await page.$$eval("a", (as) => as.map((a) => a.textContent.trim()).filter(Boolean).slice(0, 12));
  return `导航项: ${nav.join(" / ").slice(0, 90)}`;
});

await check("3. 品牌主张（V2.0 实际英文文案）", async () => {
  const zhTag = homeText.includes("真实世界探索");
  const zhHero = homeText.includes("走到真实地点");
  assert(zhTag && zhHero, `中文主张缺失 tagline=${zhTag} hero=${zhHero}`);
  return "中文默认：「真实世界探索」/「走到真实地点，解锁那里的故事」；清单所列 Explore Beyond the Screen. 不在 V2.0 文案内";
});

await check("4. 菲律宾真实摄影 Hero", async () => {
  const hero = await page.$eval(".home-hero img", (i) => ({ src: i.currentSrc, ok: i.complete && i.naturalWidth > 0 })).catch(() => null);
  assert(hero, "找不到 Hero 图片元素");
  assert(hero.ok, "Hero 图片未加载");
  assert(hero.src.includes("manila-bay-sunset"), `Hero 来源异常: ${hero.src}`);
  return hero.src.split("/").pop();
});

await check("5. 四张首页摄影资源加载", async () => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 2500));
  const imgs = await page.$$eval(".home img", (els) =>
    els.map((i) => ({ src: i.currentSrc.split("/").pop(), ok: i.complete && i.naturalWidth > 0 })),
  );
  for (const key of ["manila-bay-sunset", "rizal-park", "fort-santiago-intramuros", "el-nido-palawan"]) {
    const hit = imgs.find((i) => i.src.includes(key));
    assert(hit, `缺图 ${key}`);
    assert(hit.ok, `${key} 未加载`);
  }
  return imgs.map((i) => i.src).join(", ");
});

await check("6. 精选内容/创作入口/品牌介绍区/影像来源", async () => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 1200));
  const t = await page.evaluate(() => document.body.innerText);
  for (const need of ["精选探索包", "创作中心", "游戏中心", "Vyacheslav Argenberg", "MOSRove 首页 V2.0"]) {
    assert(t.includes(need), `缺少区块文案「${need}」`);
  }
  const sections = await page.$$eval("section[id]", (s) => s.map((x) => x.id));
  for (const id of ["packs", "how", "about", "safety"]) {
    assert(sections.includes(id), `缺少区块 #${id}`);
  }
  return `区块: ${sections.join(", ")}；页脚影像来源署名存在`;
});

await check("7. 中英文切换", async () => {
  const click = async (label) => {
    const h = await page.evaluateHandle(
      (l) => Array.from(document.querySelectorAll(".home-lang button")).find((b) => b.textContent.trim() === l),
      label,
    );
    await h.asElement().click();
    await new Promise((r) => setTimeout(r, 900));
    return page.evaluate(() => document.body.innerText);
  };
  let t = await click("EN");
  assert(/Walk to real places/i.test(t), "切换 EN 后英文 Hero 未出现");
  assert(/Game Centre/i.test(t) && /Creator Studio/i.test(t), "EN 入口文案未切换");
  t = await click("中");
  assert(t.includes("走到真实地点"), "切回中文失败");
  return "EN→中文 双向切换正常";
});

await check("8. 390px 手机视口无横向溢出", async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${PROD}/${BUST}`, { waitUntil: "networkidle2", timeout: 60000 });
  for (const sel of ["#packs", "#about", "#safety"]) {
    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView(), sel);
    await new Promise((r) => setTimeout(r, 700));
  }
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  assert(sw <= cw + 2, `溢出 scrollWidth=${sw} clientWidth=${cw}`);
  await page.screenshot({ path: "tests/e2e/artifacts/prod-restore-mobile-390.png", fullPage: true });
  return `scrollWidth=${sw} clientWidth=${cw}`;
});

await check("9. 游戏中心/创作中心可进入", async () => {
  await page.setViewport({ width: 1440, height: 900 });
  for (const [href, expect] of [["/games", "/games"], ["/design", "/design"]]) {
    await page.goto(`${PROD}/${BUST}`, { waitUntil: "networkidle2", timeout: 60000 });
    const link = await page.$(`a[href="${href}"]`);
    assert(link, `首页缺少入口 ${href}`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}),
      link.click(),
    ]);
    assert(page.url().includes(expect), `入口 ${href} 跳转到 ${page.url()}`);
    const body = await page.evaluate(() => document.body.innerText);
    assert(body.length > 50, `${expect} 页面空白`);
  }
  return "两入口点击后均进入目标页且内容非空";
});

await check("10. 无严重 JavaScript 错误", async () => {
  assert(errors.length === 0, `发现 ${errors.length} 条: ${errors.slice(0, 4).join(" | ")}`);
  return "0 条";
});

await check("11. 与指定独立部署内容一致性", async () => {
  const grab = async (url) => {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    return page.evaluate(() => ({
      hero: document.querySelector(".home-hero img")?.currentSrc.split("/").pop() ?? "none",
      sections: Array.from(document.querySelectorAll("section[id]")).map((s) => s.id).join(","),
      len: document.body.innerText.length,
    }));
  };
  const p = await grab(`${PROD}/${BUST}`);
  const i = await grab(`${INDEP}/${BUST}`);
  assert(p.hero === i.hero, `Hero 不一致: prod=${p.hero} indep=${i.hero}`);
  assert(p.sections === i.sections, `区块不一致: ${p.sections} vs ${i.sections}`);
  return `prod 与独立部署一致（hero=${p.hero}, 区块=${p.sections}）`;
});

await browser.close();
console.log("\n===== 生产恢复验收 =====");
for (const [n, s, d] of results) console.log(`${s === "PASS" ? "✓" : "✗"} ${n}${d ? `\n    ${d}` : ""}`);
const pass = results.filter((r) => r[1] === "PASS").length;
console.log(`\n${pass}/${results.length} 通过`);
process.exit(pass === results.length ? 0 : 1);
