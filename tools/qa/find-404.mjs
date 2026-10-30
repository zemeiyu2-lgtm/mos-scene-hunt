#!/usr/bin/env node
/** 一次性排查：抓出页面加载过程中的 404 资源 URL（不改任何数据） */
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const bad = [];
page.on("response", (res) => {
  if (res.status() >= 400) bad.push(`${res.status()} ${res.url()}`);
});
page.on("requestfailed", (req) => bad.push(`FAILED ${req.url()} :: ${req.failure()?.errorText}`));

for (const route of ["/", "/map", "/quest", "/games", "/select", "/bag"]) {
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 30000 });
  } catch (error) {
    console.log(`WARN ${route} 导航异常：${error.message}`);
  }
}
await browser.close();
console.log(bad.length ? bad.join("\n") : "NO_BAD_REQUESTS");
