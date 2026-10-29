#!/usr/bin/env node
/**
 * MOS Scene Hunt｜备份校验工具
 *
 * 用法：node tools/backup/verify.mjs --manifest=D:/MOS-Backups/snap/manifest.json
 *
 * 校验项：
 *  1. manifest 自身摘要与 manifest.sha256 一致（防备份清单被改）。
 *  2. 每个对象存在、字节数与 sha256 与清单一致。
 *  3. 反向检查：objects/ 下不得出现清单外的文件（防"多出来的东西"被误恢复）。
 *  4. redacted 模式只能用于结构核对，不能作为可登录恢复源（由 restore 强制）。
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function parseArgs(argv) {
  const out = {};
  for (const raw of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full, base)));
    else if (e.isFile()) files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files.sort();
}

export async function verifyBackup(manifestPath) {
  const root = path.dirname(path.resolve(manifestPath));
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const problems = [];

  const sidecar = path.join(root, "manifest.sha256");
  try {
    const expected = (await readFile(sidecar, "utf8")).trim().split(/\s+/)[0];
    const actual = sha256(Buffer.from(manifestText, "utf8"));
    if (expected !== actual) problems.push(`manifest 摘要不一致（期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`);
  } catch {
    problems.push("缺少 manifest.sha256");
  }

  if (!Array.isArray(manifest.files)) problems.push("manifest.files 不是数组");
  const listed = new Set();
  for (const entry of manifest.files ?? []) {
    if (typeof entry.key !== "string" || entry.key.includes("..") || path.isAbsolute(entry.key)) {
      problems.push(`非法对象键：${entry.key}`);
      continue;
    }
    listed.add(entry.key);
    try {
      const bytes = await readFile(path.join(root, "objects", entry.key));
      if (bytes.length !== entry.bytes) problems.push(`${entry.key} 字节数不符（清单 ${entry.bytes}，实际 ${bytes.length}）`);
      const digest = sha256(bytes);
      if (digest !== entry.sha256) problems.push(`${entry.key} sha256 不符`);
    } catch {
      problems.push(`${entry.key} 缺失`);
    }
  }

  const objectsDir = path.join(root, "objects");
  try {
    for (const rel of await walk(objectsDir)) {
      if (!listed.has(rel)) problems.push(`清单外文件：objects/${rel}`);
    }
  } catch {
    problems.push("缺少 objects/ 目录");
  }

  return { ok: problems.length === 0, problems, manifest };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const args = parseArgs(process.argv);
  if (!args.manifest) {
    console.error("FAIL 需要 --manifest=<path>");
    process.exit(2);
  }
  const { ok, problems, manifest } = await verifyBackup(args.manifest);
  if (ok) {
    console.log(`OK 校验通过：${manifest.files.length} 个对象，mode=${manifest.mode}，生成于 ${manifest.generatedAt}`);
  } else {
    console.log(`FAIL 校验发现 ${problems.length} 个问题`);
    for (const p of problems.slice(0, 20)) console.log(`   - ${p}`);
    process.exit(1);
  }
}
