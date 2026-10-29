#!/usr/bin/env node
/**
 * 隔离环境管理员种子（仅用于本地/临时 REGISTRY_DIR，绝不指向生产 Blob）
 *
 * 背景：引导逻辑 `ensureBootstrapAdmin()` 由 **GET /admin/login 页面渲染时**触发
 * （app/admin/login/page.tsx:13），不是由 POST /api/auth/login 触发。只跑纯 API 的脚本
 * 若从未打开登录页，环境里就没有管理员。为了让隔离环境可直接做 HTTP 验收，
 * 这里用与 `lib/auth/password.ts` **完全相同的 scrypt 参数**（N=16384,r=8,p=1,keylen=64,salt16）
 * 直接写入一条用户记录；也可以改为先请求一次 /admin/login。
 *
 * 用法：
 *   node tools/qa/seed-admin.mjs --dir=.qa-store/registry --email=qa-admin@example.test --password=... --name=QA管理员
 */
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const scrypt = promisify(scryptCallback);
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const args = Object.fromEntries(
  process.argv.slice(2).map((raw) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    return m ? [m[1], m[2] ?? true] : [];
  }).filter(Boolean),
);

const dir = path.resolve(args.dir ?? "");
const email = String(args.email ?? "").trim().toLowerCase();
const password = String(args.password ?? "");
const displayName = String(args.name ?? "QA 管理员");

if (!dir || !email || password.length < 12) {
  console.error("FAIL 需要 --dir --email --password(>=12)")
  process.exit(2);
}
if (/workbuddy\.app|vercel\.app/i.test(dir)) {
  console.error("FAIL 拒绝在疑似生产路径下种子");
  process.exit(2);
}

const usersDir = path.join(dir, "users");
await mkdir(usersDir, { recursive: true });

// 幂等：同邮箱已存在则只报告，不改写
for (const name of await readdir(usersDir)) {
  if (!name.endsWith(".json")) continue;
  const existing = JSON.parse(await readFile(path.join(usersDir, name), "utf8"));
  if (existing.email === email) {
    console.log(`OK 已存在（未改写）：${name} role=${existing.role} status=${existing.status}`);
    process.exit(0);
  }
}

const salt = randomBytes(16);
const derived = await scrypt(password, salt, 64, PARAMS);
const record = {
  id: randomUUID(),
  email,
  passwordHash: derived.toString("hex"),
  passwordSalt: salt.toString("hex"),
  displayName,
  role: "admin",
  status: "active",
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
  failedLoginCount: 0,
  lockedUntil: null,
  credentialEpoch: 0,
};
await writeFile(path.join(usersDir, `${record.id}.json`), JSON.stringify(record, null, 2));
console.log(`OK 已写入管理员 userId=${record.id} email=${email} role=admin`);
