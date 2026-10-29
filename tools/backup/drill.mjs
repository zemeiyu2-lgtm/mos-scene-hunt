#!/usr/bin/env node
/**
 * 恢复演练（隔离测试数据，不碰真实 registry / Blob / 生产）
 *
 * 覆盖：导出（redacted + full）→ 校验 → 恢复 → 字节一致 → 篡改检出 → 脱敏备份拒恢复。
 * 用法：node tools/backup/drill.mjs
 */
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExport } from "./export.mjs";
import { verifyBackup } from "./verify.mjs";
import { restoreBackup } from "./restore.mjs";
import { createHash } from "node:crypto";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    console.log(results.join("\n"));
    process.exit(1);
  }
};

async function makeFixture(root) {
  const reg = path.join(root, "registry");
  const pub = path.join(root, "published-games");
  const write = async (rel, obj) => {
    const full = path.join(reg, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(obj, null, 2));
  };
  const hash = (s) => sha256(Buffer.from(s));
  await write("users/u-admin.json", {
    id: "u-admin", email: "admin@example.test", emailHash: hash("admin@example.test"),
    displayName: "管理员", role: "admin", status: "active",
    passwordHash: hash("fake-password-1"), passwordSalt: "salt-1", credentialEpoch: 2,
    createdAt: "2026-01-01T00:00:00.000Z", lastLoginAt: "2026-10-01T00:00:00.000Z",
  });
  await write("users/u-creator.json", {
    id: "u-creator", email: "creator@example.test", emailHash: hash("creator@example.test"),
    displayName: "创作者", role: "creator", status: "active",
    passwordHash: hash("fake-password-2"), passwordSalt: "salt-2", credentialEpoch: 0,
    createdAt: "2026-01-02T00:00:00.000Z",
  });
  await write("sessions/abc123.json", { tokenHash: "abc123", userId: "u-admin", role: "admin", credentialEpoch: 2, expiresAt: "2026-11-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" });
  await write("works/game-a.json", { schemaVersion: 1, gameId: "game-a", ownerUserId: "u-creator", title: "演练作品", language: "zh-CN", state: "published", publishedVersionId: "0123456789abcdef", latestVersionId: "0123456789abcdef", versions: [], submissions: [], createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", revision: 3 });
  await write("audit/a1.json", { id: "a1", actorUserId: "u-admin", actorRole: "admin", action: "user.create", targetType: "user", targetId: "u-creator", before: null, after: { role: "creator" }, ipHash: "h", uaHash: "h", createdAt: "2026-02-01T00:00:00.000Z" });
  await write("audit/a2.json", { id: "a2", actorUserId: null, actorRole: null, action: "work.import_legacy", targetType: "work", targetId: "game-a", before: null, after: { state: "published" }, ipHash: "none", uaHash: "none", createdAt: "2026-02-02T00:00:00.000Z" });

  const gameDir = path.join(pub, "game-a");
  await mkdir(path.join(gameDir, "versions"), { recursive: true });
  await writeFile(path.join(gameDir, "meta.json"), JSON.stringify({ gameId: "game-a", latestVersionId: "0123456789abcdef", versions: [{ versionId: "0123456789abcdef", title: "演练作品", sceneCount: 3, publishedAt: "2026-02-02T00:00:00.000Z" }] }, null, 2));
  await writeFile(path.join(gameDir, "versions", "0123456789abcdef.json"), JSON.stringify({ id: "game-a", title: "演练作品", scenes: [] }, null, 2));
  return { reg, pub };
}

const workRoot = await mkdtemp(path.join(tmpdir(), "mos-backup-drill-"));
const repoRoot = path.join(workRoot, "repo"); // 模拟仓库根：备份不得写入其内部
await mkdir(repoRoot, { recursive: true });
try {
  const { reg, pub } = await makeFixture(repoRoot);
  const outRedacted = path.join(workRoot, "backup-redacted");
  const outFull = path.join(workRoot, "backup-full");

  const red = await runExport({ store: "fs", registryDir: reg, publishedDir: pub, out: outRedacted, mode: "redacted", repoRoot });
  check("导出 redacted", red.manifest.files.length === 8, `files=${red.manifest.files.length}, redactedUsers=${red.manifest.redactedUsers}, counts=${JSON.stringify(red.manifest.counts)}`);
  check("redacted 确实脱敏", red.manifest.redactedUsers === 2);

  const redUser = await readFile(path.join(outRedacted, "objects", "users", "u-admin.json"), "utf8");
  check("redacted 用户记录不含口令材料", !/fake-password|salt-1/.test(redUser) && /"passwordHash": "REDACTED"/.test(redUser) && /"_redacted": true/.test(redUser));

  const full = await runExport({ store: "fs", registryDir: reg, publishedDir: pub, out: outFull, mode: "full", repoRoot });
  check("导出 full", full.manifest.files.length === 8);

  const verified = await verifyBackup(path.join(outFull, "manifest.json"));
  check("校验 full 备份", verified.ok, verified.problems.join("; "));

  // 字节一致性：全量备份与服务端原始对象逐字节相等
  for (const entry of full.manifest.files) {
    const src = entry.key.startsWith("published/")
      ? path.join(pub, entry.key.slice("published/".length))
      : path.join(reg, entry.key);
    const a = await readFile(src);
    const b = await readFile(path.join(outFull, "objects", entry.key));
    check(`字节一致 ${entry.key}`, sha256(a) === sha256(b));
  }

  const target = path.join(workRoot, "restored");
  const dry = await restoreBackup({ manifestPath: path.join(outFull, "manifest.json"), targetDir: target });
  check("恢复预演（不写盘）", dry.ok && dry.stage === "dry-run" && dry.plan.length === 8);

  const applied = await restoreBackup({ manifestPath: path.join(outFull, "manifest.json"), targetDir: target, apply: true });
  check("恢复写入", applied.ok && applied.stage === "applied");
  const restoredUser = await readFile(path.join(target, "users", "u-admin.json"));
  const originalUser = await readFile(path.join(reg, "users", "u-admin.json"));
  check("恢复后字节一致", sha256(restoredUser) === sha256(originalUser));

  const again = await restoreBackup({ manifestPath: path.join(outFull, "manifest.json"), targetDir: target, apply: true });
  check("拒绝恢复到非空目录（防覆盖）", !again.ok && again.stage === "precheck");

  const redRestore = await restoreBackup({ manifestPath: path.join(outRedacted, "manifest.json"), targetDir: path.join(workRoot, "restored-redacted") });
  check("拒绝用脱敏备份做可登录恢复", !redRestore.ok && /redacted/.test(redRestore.problems.join(" ")));
  const redRestoreAllowed = await restoreBackup({ manifestPath: path.join(outRedacted, "manifest.json"), targetDir: path.join(workRoot, "restored-redacted"), allowRedactedUsers: true });
  check("允许脱敏备份做结构演练", redRestoreAllowed.ok && redRestoreAllowed.stage === "dry-run");

  // 篡改检出
  await writeFile(path.join(outFull, "objects", "works", "game-a.json"), JSON.stringify({ gameId: "game-a", state: "withdrawn" }));
  const tampered = await verifyBackup(path.join(outFull, "manifest.json"));
  check("篡改对象被检出", !tampered.ok && tampered.problems.some((p) => p.includes("game-a.json")));

  // 清单外文件检出
  await writeFile(path.join(outFull, "objects", "users", "u-ghost.json"), "{}");
  const extra = await verifyBackup(path.join(outFull, "manifest.json"));
  check("清单外文件被检出", !extra.ok && extra.problems.some((p) => p.includes("u-ghost.json")));

  // 输出目录守卫：仓库内目录必须被拒
  let guarded = false;
  try {
    await runExport({ store: "fs", registryDir: reg, publishedDir: pub, out: path.join(repoRoot, "public", "backup"), mode: "redacted", repoRoot });
  } catch (error) {
    guarded = /公开|仓库/.test(String(error));
  }
  check("拒绝写入 public/（防公开泄漏）", guarded);

  console.log(results.join("\n"));
  console.log(`\nINFO 演练目录：${workRoot}`);
} finally {
  if (!process.env.KEEP_DRILL) await rm(workRoot, { recursive: true, force: true });
}
