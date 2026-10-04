/**
 * Temporary diagnostic runner (not part of the suite).
 * Starts a production server on an isolated port, runs one probe script
 * against it, then tears the server down.
 *
 * Usage: node tests/e2e/run-probe.mjs diag-gps.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const probe = process.argv[2];
if (!probe) {
  console.error("用法: node tests/e2e/run-probe.mjs <probe-file.mjs>");
  process.exit(2);
}

const PORT = Number(process.env.E2E_PORT ?? 3102);
const BASE = `http://127.0.0.1:${PORT}`;
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const root = process.cwd();
const probePath = path.join(root, "tests", "e2e", probe);

if (!existsSync(probePath)) {
  console.error(`找不到探针: ${probePath}`);
  process.exit(2);
}

const server = spawn(NPX, ["next", "start", "-p", String(PORT)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
  env: { ...process.env, NODE_ENV: "production" },
});
let serverLog = "";
server.stdout?.on("data", (d) => (serverLog += d.toString()));
server.stderr?.on("data", (d) => (serverLog += d.toString()));

const cleanup = () => {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
};

let up = false;
for (let i = 0; i < 75; i++) {
  try {
    const r = await fetch(BASE, { redirect: "manual" });
    if (r.status < 500) {
      up = true;
      break;
    }
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 400));
}

if (!up) {
  console.error("服务器未启动:\n" + serverLog);
  cleanup();
  process.exit(2);
}

const child = spawn(process.execPath, [probePath], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, E2E_BASE_URL: BASE },
});
const code = await new Promise((r) => child.on("exit", (c) => r(c ?? 1)));
cleanup();
process.exit(code);
