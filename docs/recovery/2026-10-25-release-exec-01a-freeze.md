# RELEASE-EXEC-01A｜发布候选冻结与部署准备报告

- 执行时间：2026-10-25 20:34–20:45（GMT+8）
- 授权范围：候选冻结（分支+标签）、干净部署工作树、Production 配置核验、部署前检查。**未部署、未修改 Production 配置、未写入或删除任何 Blob 数据。**

## 1. 冻结提交

- 完整哈希：`79cd0e7a5575349a67be0db2b9afe628f5ec33e9`（执行前后与远程开发分支 HEAD 逐一比对，**未漂移**）。
- 与 `origin/master`（`5efbb7e`）关系：master 为候选祖先（merge-base 实测确认），候选含 30 个领先提交（PREP-01 已分类审查）。

## 2. 新建分支与标签（仅本地，未推送）

| 引用 | 指向 | 验证 |
|---|---|---|
| 分支 `release/2026-10-25-publish` | `79cd0e7a5575349a67be0db2b9afe628f5ec33e9` | `git rev-parse` 实测一致 |
| 标签 `mos-scene-hunt-v1.0.0-rc.1`（annotated，附冻结说明） | `79cd0e7a5575349a67be0db2b9afe628f5ec33e9`（`^{}` 解引用实测） | 同上 |

- 创建前冲突检查：两个命名均无既有引用（分支与 0 个标签全量核对）。
- `master` 未修改；未提交任何代码。
- **注**：分支与标签目前仅在本地。将引用推送到 GitHub 不在本次授权清单内，待负责人批准后执行（对部署非必需——本项目为 CLI 部署模式）。

## 3. 干净部署工作树

- 路径：`C:\Users\Administrator\AppData\Local\Temp\mos-release-rc1`（`/tmp/mos-release-rc1`），从标签 `mos-scene-hunt-v1.0.0-rc.1` detached 创建。
- HEAD = `79cd0e7`，创建后工作区干净（`git status` 空）；**未复制 `.next-stale-*`、未复制 `.env.local`**。
- 项目链接：仅复制了 `.vercel/project.json`（`prj_JtB7…` 机器链接配置，非密钥；实测被 gitignore，不会进入 Git）。
- 依赖与构建：`npm ci`（按 package-lock 锁定）+ `npm run build`——**构建成功（exit 0）**，构建输入严格对应冻结提交（worktree HEAD 79cd0e7、树干净）。
- 构建产物核验：`app-path-routes-manifest.json` 实测包含 `/api/publish` 与 `/api/games/[gameId]` 两个发布 API 路由。

## 4. 原工作区保护检查（构建后实测）

- 原工作区 HEAD 仍为 `79cd0e7`，分支仍为 `recovery/20261024-historical-features`。
- 未提交内容数量与内容不变（26 项：e2e-summary.json 修改 + 未跟踪证据/报告/stale 目录）。
- `.next-stale-*` 目录完好；`.env.local`、`.vercel/project.json`、`docs/recovery/`、`visual-evidence/` 未触碰。

## 5. Production 环境变量状态（本轮 20:42 实测，仅存在性）

| 变量 | Production | Preview |
|---|---|---|
| `PUBLISHED_GAMES_STORE` | ❌ **仍缺失** | ✅ 存在（`blob`） |
| `BLOB_READ_WRITE_TOKEN` | ✅ 存在 | ✅ 存在 |

- 项目身份确认：通过 `.vercel/project.json` 关联 `mos-scene-hunt`（prj_JtB7…），CLI 身份为项目属主，权限无异常。

## 6. 后续部署步骤（待负责人逐项授权，本轮均未执行）

1. **负责人在 Vercel 控制台为 Production 环境添加 `PUBLISHED_GAMES_STORE=blob`**（CLI 亦可代操作，需明确授权）。此为硬前置：候选代码在变量缺失时会静默回退不可持久的文件系统存储且仍返回 201（PREP-02 已证实）。
2. 变量添加后**必须触发新的 Production 部署**（环境变量随部署固化，不影响现有部署）。
3. 部署方式建议：从 `mos-release-rc1` worktree 执行 `vercel deploy --prod`（来源即冻结提交的干净构建）；或负责人在控制台以其它经核实的方式完成。
4. 部署后立即执行只读探针（`/api/publish` 应 405、`/api/games/x` 应 404 JSON、首页 200），确认新构建生效。
5. 以独占命名的测试 gameId 执行生产发布/读取/幂等/旧版本保护验收（写入操作，需授权）。
6. 验收通过后：master 快进合并至 `79cd0e7` 并推送分支/标签（Git 写操作，需授权）。

**停止条件**：候选提交漂移；Production 部署发现非冻结来源；变量添加失败或权限异常；探针结果与预期不符；任何回退需要（`vercel rollback` 至 `i9ydgjid4`——数据零丢失，已由 PREP-02 论证）。

**风险**：回退后旧构建无读取 API（功能不可用但数据完好）；旧 `#hunt=` 浏览器端到端与 Vercel 计划配额仍未验证（非阻塞项）。

## 7. 操作确认

本轮：✅ 未执行 Production 部署/推广/回滚；✅ 未修改任何环境变量或项目设置；✅ 未写入或删除任何 Blob 对象；✅ 未修改/合并/推送 master；✅ 未修改原工作区任何文件；✅ 未提交代码（分支/标签为本地引用创建）；✅ 未输出任何令牌或敏感值。
