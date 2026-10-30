# MOS Scene Hunt V1.0 · 当前状态（CURRENT-STATE）

- 最后更新：2026-10-30 13:55 GMT+8（验收复核轮）
- 当前分支：`v1.0/platform-optimization`（worktree `D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt-v10`）
- 当前 commit：见 `git log -1`（复核轮收尾提交；开发线 3331715 → 2d8d507 → cf8b6ec → 104cb40 → d41777a → 74c2a10 → 2a492af → a191c89 → 复核轮提交）
- 工作区状态：干净（复核轮改动已提交：探针 SHA-256 升级、responsive 探针、三份报告修正）
- 最近完成：模块 A–I 全部完成；**验收复核轮通过**（存档隔离 A/B 双证据、GPS 门控、生产边界、多端模拟）
- 正在进行：无（RC 维持，等待用户验收与生产部署授权）
- 下一步：用户验收 → 授权后按 RELEASE-CANDIDATE §6 清单部署（必须移除生产 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`、按需加 `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1`）
- 已知问题：P0 生产模拟器环境变量仍存在（只读确认，待授权移除）；真机/现场项见 TEST-REPORT §6；**本文件 12:20 版的批量状态更新曾静默失败，已在复核轮重写纠正**
- 最近测试：单测 798/798、tsc 0、ESLint 0/0、生产构建（a191c89 重建）成功、玩家 E2E 40/40、后台 E2E 59/59、隔离探针 7/7（A=SHA-256 字节级、B=语义级）、多端模拟 12 张截图

## 验收录证要点（复核轮新增）

- A 项字节级：演示结束页上不重进玩家、不触发 hydration，直接读档——save 键 SHA-256 前后均为 `48f3f605475805732264daf12befd19133af14f109ffded03f91129837849451`。
- B 项语义级：重进玩家后完成站点/奖励 id/背包/关键词/startedAt 全保留；`lastUpdatedAt` 1 → 1793339002395（reconcile 归一化，如实记录）。
- 证据文件：`tests/e2e/artifacts/probe-demo-isolation-summary.json`（evidence 字段）、`tests/e2e/artifacts/responsive/`（12 截图 + responsive-evidence.json）。

## 恢复指引（中断后先读本文件）

1. 读 MASTER-PLAN → DECISIONS → 本文件。
2. `git -C D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt-v10 status --short --branch` 核对实际状态。
3. E2E 复跑：`node tests/e2e/run.mjs`（自构建自起服）；隔离探针：`node tests/e2e/run-probe.mjs probe-demo-isolation.mjs`（需 3102 服务：`npx next start -p 3102`）；多端模拟：`node tests/e2e/probe-responsive.mjs`。
4. 构建前若 `.next` 存在，先 `mv .next ../.next-old-<时戳>`（本机 safe-delete 守卫会拦截批量删除）。
5. 禁止仅凭历史对话猜测进度。
