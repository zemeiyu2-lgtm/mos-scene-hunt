#!/usr/bin/env node
/**
 * MOS Scene Hunt｜备份恢复工具（默认 dry-run）
 *
 * 用法：
 *   node tools/backup/restore.mjs --manifest=.../manifest.json --target-dir=D:/tmp/restore           # 预演
 *   node tools/backup/restore.mjs --manifest=... --target-dir=D:/tmp/restore --apply                 # 写入空目标
 *
 * 安全边界：
 *  - 先跑 verifyBackup，任何对象损坏即拒绝恢复。
 *  - redacted 备份缺 passwordHash/passwordSalt：默认拒绝恢复 users/（避免造出无法登录的账号），
 *    除非显式 --allow-redacted-users（仅用于结构演练）。
 *  - 目标目录必须不存在或为空；--apply 前会把每个对象路径做穿越检查。
 *  - 不删除目标目录内既有文件，不做覆盖（存在同名即失败），便于回滚判断。
 */
import { mkdir, readFile, writeFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { verifyBackup } from "./verify.mjs";

function parseArgs(argv) {
  const out = {};
  for (const raw of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

export async function restoreBackup({ manifestPath, targetDir, apply = false, allowRedactedUsers = false }) {
  const { ok, problems, manifest } = await verifyBackup(manifestPath);
  if (!ok) return { ok: false, stage: "verify", problems };

  const sourceRoot = path.dirname(path.resolve(manifestPath));
  const target = path.resolve(targetDir);
  if (await exists(target)) {
    const entries = await readdir(target);
    if (entries.length > 0) return { ok: false, stage: "precheck", problems: [`目标目录非空：${target}`] };
  }

  const redactedUsers = (manifest.files ?? []).filter((f) => f.key.startsWith("users/") && f.redacted);
  if (redactedUsers.length > 0 && !allowRedactedUsers) {
    return {
      ok: false,
      stage: "precheck",
      problems: [`备份为 redacted 模式，含 ${redactedUsers.length} 个已脱敏用户记录，无法用于可登录恢复（如仅做结构演练请加 --allow-redacted-users）`],
    };
  }

  const plan = [];
  for (const entry of manifest.files ?? []) {
    const key = entry.key;
    if (key.includes("..") || path.isAbsolute(key)) {
      return { ok: false, stage: "precheck", problems: [`非法对象键：${key}`] };
    }
    const dest = path.join(target, key);
    if (!dest.startsWith(target + path.sep) && dest !== target) {
      return { ok: false, stage: "precheck", problems: [`路径穿越：${key}`] };
    }
    if (await exists(dest)) return { ok: false, stage: "precheck", problems: [`目标已存在同名文件：${key}`] };
    plan.push({ key, dest, bytes: entry.bytes });
  }

  if (!apply) return { ok: true, stage: "dry-run", plan, manifest };

  for (const item of plan) {
    const bytes = await readFile(path.join(sourceRoot, "objects", item.key));
    await mkdir(path.dirname(item.dest), { recursive: true });
    await writeFile(item.dest, bytes);
  }
  return { ok: true, stage: "applied", plan, manifest };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const args = parseArgs(process.argv);
  if (!args.manifest || !args["target-dir"]) {
    console.error("FAIL 需要 --manifest=<path> --target-dir=<dir>");
    process.exit(2);
  }
  const result = await restoreBackup({
    manifestPath: args.manifest,
    targetDir: args["target-dir"],
    apply: Boolean(args.apply),
    allowRedactedUsers: Boolean(args["allow-redacted-users"]),
  });
  if (!result.ok) {
    console.log(`FAIL 阶段=${result.stage}`);
    for (const p of result.problems) console.log(`   - ${p}`);
    process.exit(1);
  }
  console.log(`OK 阶段=${result.stage} 计划写入 ${result.plan.length} 个对象 → ${path.resolve(args["target-dir"])}`);
  for (const item of result.plan.slice(0, 8)) console.log(`   ${applyFlag(args)} ${item.key} (${item.bytes}B)`);
  if (result.plan.length > 8) console.log(`   … 其余 ${result.plan.length - 8} 项`);
}

function applyFlag(args) {
  return args.apply ? "写入" : "预演";
}
