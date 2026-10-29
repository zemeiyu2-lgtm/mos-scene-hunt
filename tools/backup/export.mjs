#!/usr/bin/env node
/**
 * MOS Scene Hunt｜Registry + published-games 导出工具（只读源）
 *
 * 用法：
 *   node tools/backup/export.mjs --store=fs --registry-dir=.registry --published-dir=.published-games \
 *        --out=D:/MOS-Backups/snap-20261029 --mode=redacted
 *   node tools/backup/export.mjs --store=blob --prefix=registry --prefix-games=published-games \
 *        --out=... --mode=full
 *
 * 设计约束：
 *  - 默认 redacted：users/<id>.json 中的 passwordHash / passwordSalt 被替换为 "REDACTED"，
 *    并打上 _redacted 标记；该模式的备份可用于审计与结构恢复，但不能直接登录。
 *  - full 模式含口令散列与盐，属敏感材料：必须显式 --mode=full，且输出目录不得位于仓库/公开目录内。
 *  - 只读源：对 fs 只做 readFile；对 Blob 只做 list + get，不写入、不删除。
 *  - 输出目录必须为空或不存在（除非 --force），避免覆盖既有备份。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile, access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TOOL_VERSION = "1.0.0";
const ALLOWED_KINDS = ["users", "sessions", "works", "audit", "published"];

function parseArgs(argv) {
  const out = {};
  for (const raw of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files.sort();
}

/** 脱敏：只动用户记录中的口令材料，其他字段原样保留。 */
export function redactUserJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { text, redacted: false }; }
  let changed = false;
  for (const key of ["passwordHash", "passwordSalt"]) {
    if (typeof obj[key] === "string" && obj[key].length > 0) {
      obj[key] = "REDACTED";
      changed = true;
    }
  }
  if (!changed) return { text, redacted: false };
  obj._redacted = true;
  return { text: JSON.stringify(obj, null, 2), redacted: true };
}

function kindOf(key) {
  if (key.startsWith("users/")) return "users";
  if (key.startsWith("sessions/")) return "sessions";
  if (key.startsWith("works/")) return "works";
  if (key.startsWith("audit/")) return "audit";
  return "published";
}

async function collectFs({ registryDir, publishedDir }) {
  const items = [];
  for (const [kind, dir] of [["registry", registryDir], ["published", publishedDir]]) {
    if (!dir) continue;
    if (!(await exists(dir))) throw new Error(`目录不存在：${dir}`);
    for (const rel of await walk(dir)) {
      const key = kind === "registry" ? rel : `published/${rel}`;
      items.push({ key, bytes: await readFile(path.join(dir, rel)) });
    }
  }
  return items;
}

async function collectBlob({ prefix, prefixGames }) {
  const { list, get } = await import("@vercel/blob");
  const items = [];
  for (const [root, isGames] of [[prefix, false], [prefixGames, true]]) {
    if (!root) continue;
    let cursor;
    do {
      const page = await list({ prefix: root, cursor, limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN });
      for (const blob of page.blobs) {
        const rel = blob.pathname.slice(root.length + 1);
        if (!rel || rel.endsWith("/")) continue;
        const res = await get(blob.pathname, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
        if (!res || !res.stream) continue;
        const chunks = [];
        for await (const chunk of res.stream) chunks.push(Buffer.from(chunk));
        items.push({ key: isGames ? `published/${rel}` : rel, bytes: Buffer.concat(chunks) });
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return items;
}

function guardOutDir(out, repoRoot, force) {
  const abs = path.resolve(out);
  const rel = path.relative(repoRoot, abs);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error(`输出目录位于仓库内（${abs}）。备份不得写入仓库，避免被提交或被打包。`);
  }
  if (/[\\/](public|\.next|node_modules)[\\/]/.test(`${abs}${path.sep}`)) {
    throw new Error(`输出目录命中公开/构建目录：${abs}`);
  }
  return abs;
}

export async function runExport(opts) {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const mode = opts.mode ?? "redacted";
  if (!["redacted", "full"].includes(mode)) throw new Error("--mode 只能是 redacted 或 full");
  const out = guardOutDir(opts.out, repoRoot, opts.force);
  if (!opts.force && (await exists(out)) && (await readdir(out)).length > 0) {
    throw new Error(`输出目录非空：${out}（如需覆盖请加 --force）`);
  }
  const items = opts.store === "blob"
    ? await collectBlob({ prefix: opts.prefix, prefixGames: opts.prefixGames })
    : await collectFs({ registryDir: opts.registryDir, publishedDir: opts.publishedDir });

  const files = [];
  const counts = Object.fromEntries(ALLOWED_KINDS.map((k) => [k, 0]));
  let redactedCount = 0;
  for (const item of items) {
    let bytes = item.bytes;
    let redacted = false;
    if (mode === "redacted" && item.key.startsWith("users/")) {
      const res = redactUserJson(bytes.toString("utf8"));
      if (res.redacted) { bytes = Buffer.from(res.text, "utf8"); redacted = true; redactedCount += 1; }
    }
    const digest = sha256(bytes);
    const target = path.join(out, "objects", item.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    // 写后读回校验：避免磁盘/编码问题造成的静默损坏
    const back = await readFile(target);
    if (sha256(back) !== digest) throw new Error(`写后校验失败：${item.key}`);
    files.push({ key: item.key, bytes: bytes.length, sha256: digest, redacted });
    counts[kindOf(item.key)] += 1;
  }

  const manifest = {
    tool: "mos-scene-hunt-backup",
    toolVersion: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    store: opts.store ?? "fs",
    mode,
    sources: opts.store === "blob"
      ? { prefix: opts.prefix ?? null, prefixGames: opts.prefixGames ?? null }
      : { registryDir: path.resolve(opts.registryDir ?? ""), publishedDir: path.resolve(opts.publishedDir ?? "") },
    counts,
    redactedUsers: redactedCount,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    files,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  await writeFile(path.join(out, "manifest.json"), manifestText);
  await writeFile(path.join(out, "manifest.sha256"), `${sha256(Buffer.from(manifestText, "utf8"))}  manifest.json\n`);
  return { out, manifest };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const args = parseArgs(process.argv);
  try {
    const result = await runExport({
      store: args.store ?? "fs",
      registryDir: args["registry-dir"],
      publishedDir: args["published-dir"],
      prefix: args.prefix,
      prefixGames: args["prefix-games"],
      out: args.out,
      mode: args.mode,
      force: Boolean(args.force),
    });
    const { manifest } = result;
    console.log(`OK 导出完成：${result.out}`);
    console.log(`   mode=${manifest.mode} files=${manifest.files.length} bytes=${manifest.totalBytes} redactedUsers=${manifest.redactedUsers}`);
    console.log(`   counts=${JSON.stringify(manifest.counts)}`);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
