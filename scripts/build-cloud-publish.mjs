#!/usr/bin/env node
/**
 * scripts/build-cloud-publish.mjs - 把维护者 CLI 打成单文件（用项目已有的 esbuild）。
 *
 * 为什么需要打包：CLI 必须复用应用**同一套**游戏包校验（lib/game/package.ts），
 * 而纯 Node 不能直接 import TypeScript。与其在 CLI 里复制一份校验逻辑（那是
 * 两套真相，迟早漂移），不如让 esbuild 把 lib/ 一起打进来。
 *
 * 产物 scripts/.build/cloud-publish.mjs 是生成物，不入库（见 .gitignore）。
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, "cloud-publish.mjs")],
  outfile: path.join(here, ".build", "cloud-publish.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // 项目依赖（Next/React 等）不会被 CLI 用到；外置它们可让产物只包含 lib/ 的纯逻辑。
  packages: "external",
  banner: {
    js: "// 自动生成：请修改 scripts/cloud-publish.mjs 后重新构建（npm run cloud:publish 会先构建）。",
  },
  logLevel: "warning",
});

console.log("✓ CLI 已构建到 scripts/.build/cloud-publish.mjs");
