# MOS Scene Hunt V1.0 · 当前状态（CURRENT-STATE）

- 最后更新：2026-10-30 14:32 GMT+8（生产发布准备核查轮）
- 当前分支：`v1.0/platform-optimization`（worktree `D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt-v10`）
- 当前 commit：见 `git log -1`（开发线至 a79e058 → 本轮核查文档提交；**应用代码自 2a492af 零变更**）
- 工作区状态：核查交付后干净
- 最近完成：**生产发布准备核查（PASS WITH CONDITIONS）**——候选锁定、AUTO_DEMO/GPS_SIMULATOR 依赖审查、最终组合（无 SIMULATOR+AUTO_DEMO=1）独立 worktree 构建与测试（门控 5/6+数据项复验、隔离 7/7、后台 59/59、多端 12 截图）、部署清单、回滚评估
- 正在进行：无（等待项目负责人审批生产发布）
- 下一步：按 `docs/release/v1.0-pre-release-audit/06-总报告` §4 授权清单执行（两类环境变量操作 + 部署 + 部署后核验）；现场项保持 `FIELD_CALIBRATION_PENDING`
- 已知问题：生产 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR` 仍在（14:08 只读核实）；回滚目标多为 SIMULATOR=1 构建（回滚=安全降级，见 05 号文档）
- 最近测试：见 01 号文档证据对照表（组合构建实测：门控/隔离/后台/多端；40 项 E2E 为 2a492af 前构建，差异已标注）

## 核查轮追加（14:05–14:32，历史记录保留于下文）

- 核查报告：`docs/release/v1.0-pre-release-audit/`（6 份 + evidence/）
- 结论：**PASS WITH CONDITIONS**；生产部署未执行、变量未动、分支未推送
- 临时核查 worktree `scene-hunt-prerelease-audit` 已创建（detach @a79e058）、测试、并清理

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
