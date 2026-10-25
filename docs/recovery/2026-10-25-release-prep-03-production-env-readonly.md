# RELEASE-PREP-03｜Production 环境变量只读核验报告

- 核验时间：2026-10-25 20:52–21:00（GMT+8）
- 查询方式：Vercel REST API（仅 GET：`/v9/projects/{id}`、`/v2/user`、`/v9/projects/{id}/env`、单变量端点），凭据仅从本机 CLI 认证文件读入内存，**未打印、未复制、未写入报告**；值为在内存中比对，输出仅布尔结果。
- 性质：只读核验。未部署、未修改任何环境变量或项目设置、未写任何数据。

## 1. 项目身份核验（第 1 步）

- 项目 ID 直查 `prj_JtB7eEJ0LyiJja0GgKVEQIDE0ulA` → **`name = mos-scene-hunt`**（非按名称猜测，按 ID 精确命中）。
- 当前账号：`zemeiyu2-1187`（项目属主，可读取该项目），查询成功，无权限错误。
- 环境区分：变量按 API 的 `target` 字段精确区分 `production` / `preview` / `development`，不存在环境混查。

## 2. 三环境变量状态表（第 2 步）

| 环境 | `PUBLISHED_GAMES_STORE` | 值严格 = `blob`？ | 证据局限 |
|---|---|---|---|
| **Production** | ❌ **不存在**（API 变量清单中该键仅 1 条记录，target 仅含 preview；无第二条 production 记录） | 不适用（变量不存在） | 无 |
| Preview | ✅ 存在，target=`[preview]`，`sensitive=false` | ✅ **true**（单变量端点返回解密值，内存比对，仅输出布尔） | 无 |
| Development | ❌ 不存在 | 不适用 | 仅记录，未修改 |

`BLOB_READ_WRITE_TOKEN`：存在，target=`[production, preview, development]`（仅存在性；值未读取、未输出）。

**与历史记录对照**：与 EXEC-01A 记录一致（Production 缺失），但本次为 API 直查的独立核验，非沿用历史。

## 3. 证据与局限说明（第 3 步）

- 查询方式与时间见文首；所有结论来自 API 响应字段（`target`、`value`），非推断。
- "存在"与"值正确"已明确区分：Preview 两者均确认；Production 存在性为"确认不存在"。
- 未输出任何 Token、密钥或秘密值；未在报告中记录任何敏感内容。

## 4. 冻结版本与干净 worktree 核验（第 4 步，只读）

- 分支 `release/2026-10-25-publish` = 标签 `mos-scene-hunt-v1.0.0-rc.1`（解引用）= `79cd0e7a5575349a67be0db2b9afe628f5ec33e9` ✅ 三者一致，与远程开发分支 HEAD 一致，未漂移。
- 部署 worktree `C:\Users\Administrator\AppData\Local\Temp\mos-release-rc1`：HEAD = `79cd0e7` ✅。
- **发现一项偏差（如实报告）**：worktree 中 `tsconfig.json` 为已修改状态——系 EXEC-01A 中 `next build` 的自动改写（已知工具行为，非候选代码差异），且该改写会被部署上传。**部署前需在该 worktree 内还原 `tsconfig.json`（`git checkout -- tsconfig.json`）后重建/或直接部署还原后的构建**，使部署输入严格对应冻结提交。本轮按只读约束未代为还原。
- 结论：后续部署可明确指定冻结版本（标签 + worktree HEAD 一致）。

## 5. 最终判定：**B — 配置未通过**

有明确证据（API 直查）显示 Production 环境缺少 `PUBLISHED_GAMES_STORE`。按判定标准，B 不得自行修复。

## 6. 后续建议 / 需负责人执行的操作

1. **负责人操作（二选一）**：在 Vercel 控制台为 Production 环境添加 `PUBLISHED_GAMES_STORE = blob`；或明确授权后由代理通过 CLI/API 添加（`vercel env add PUBLISHED_GAMES_STORE production`，值仅经内存传递）。
2. 变量添加后必须**触发新的 Production 部署**才会生效（现有部署不受影响）。
3. 部署执行前：在 `mos-release-rc1` worktree 还原 `tsconfig.json` 并确认树干净（见 §4）。
4. 本判定 B 解除（Production 值确认为 `blob` 且 target 含 production）后，方可进入部署审批；A 不代表已部署、不代表生产验收通过。

## 7. 操作声明

本轮未部署/重部署、未新增/修改/删除任何环境变量、未修改项目设置、未推送分支或标签、未写入或删除任何 Blob/存储数据、未调用发布 API、未输出任何秘密值；仓库内仅新增本报告文件，未修改或删除其他文件。
