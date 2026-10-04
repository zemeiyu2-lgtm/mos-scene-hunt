/**
 * Acceptance runner.
 *
 * Starts (or reuses) a production server, waits for it to answer, runs the
 * end-to-end acceptance script as a child process, then shuts the server down.
 *
 * Owning the server lifecycle here rather than in the shell is deliberate: a
 * backgrounded `next start` does not reliably outlive the shell that spawned it
 * on Windows, which produces a confusing wall of ERR_CONNECTION_REFUSED failures
 * that look like application bugs but are not.
 *
 * IMPORTANT: the build is made with NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1.
 *
 * The DEV simulator is inert in production builds by design (see
 * lib/location/simulator.ts), and `next start` always runs NODE_ENV=production.
 * Without the explicit opt-in the whole positional half of this suite cannot
 * run at all, because there is no way to move the player. The flag is the
 * mechanism the module already provides for hosted demos, so this exercises the
 * real code path rather than a test-only bypass. It is set for the build here
 * and never in the application's own default configuration.
 *
 * Usage:
 *   node tests/e2e/run.mjs            # rebuild + run (recommended)
 *   node tests/e2e/run.mjs --no-build # reuse the existing .next
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const NODE = process.execPath;
const NPX = path.join(
  path.dirname(NODE),
  process.platform === "win32" ? "npx.cmd" : "npx",
);
const root = process.cwd();

/** Public flags must be present at build time; Next.js inlines them. */
const BUILD_ENV = {
  ...process.env,
  NEXT_PUBLIC_ENABLE_GPS_SIMULATOR: "1",
};

function runSync(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`命令失败 (${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const skipBuild = process.argv.includes("--no-build");

if (!skipBuild) {
  console.log("→ 构建中（已启用 GPS 模拟器编译开关）…");
  runSync(NPX, ["next", "build"], BUILD_ENV);
}

if (!existsSync(path.join(root, ".next"))) {
  console.error("找不到 .next，请先运行 `npm run build`，或去掉 --no-build。");
  process.exit(2);
}

console.log(`→ 启动服务器 (端口 ${PORT})…`);
const server = spawn(NPX, ["next", "start", "-p", String(PORT)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
  env: { ...BUILD_ENV, NODE_ENV: "production" },
});

let serverLog = "";
server.stdout?.on("data", (d) => {
  serverLog += d.toString();
});
server.stderr?.on("data", (d) => {
  serverLog += d.toString();
});

let exitCode = 1;
let serverExitCode = null;
server.on("exit", (code) => {
  serverExitCode = code;
});

const cleanup = () => {
  if (!server.killed) {
    // SIGTERM is not honoured by every Next.js child on Windows, so kill the tree.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      server.kill("SIGTERM");
    }
  }
};

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

try {
  const up = await waitForServer(BASE);
  if (!up) {
    console.error("服务器未能启动。日志：\n" + serverLog);
    cleanup();
    process.exit(2);
  }
  console.log(`→ 服务器就绪: ${BASE}\n`);

  const child = spawn(NODE, [path.join(root, "tests", "e2e", "run-e2e.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, E2E_BASE_URL: BASE },
  });

  exitCode = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  cleanup();
  if (serverExitCode !== null && exitCode === 1) {
    console.error(`\n服务器提前退出（code ${serverExitCode}）：\n${serverLog}`);
  }
}

process.exit(exitCode);
