# RELEASE-EXEC-03｜后台平台生产部署与历史导入记录

- 执行时间：2026-10-29 10:08–10:30（GMT+8）
- 授权：用户批准按 V9 部署方案执行生产部署，并一并授权 `import-legacy --apply`；管理员 bootstrap 邮箱由用户指定，密码因不足 12 位被代码策略（`MIN_PASSWORD_LENGTH=12`）拒绝，经用户选择改用生成强密码。

## 部署

- 部署提交：**`b46e47e`**（feat/admin-platform 顶端；含生产基线 master `6cd0468` 全部内容，16 提交领先、0 落后）。
- 部署来源：冻结 worktree `scene-hunt-admin`，`git status` 干净；本机 `vitest 470/470`、`tsc --noEmit`、`next build` 全部通过后部署。
- 初次部署：`mos-scene-hunt-1i0zlf10h`（2026-10-29 10:12，● Ready）。
- 二次 redeploy（应用更新的 `BOOTSTRAP_ADMIN_PASSWORD`）：`mos-scene-hunt-e4gi3j420`。
- 最终在线部署（bootstrap 变量删除后 redeploy）：**`mos-scene-hunt-qahmx0jrz`**（● Ready，域名 `https://mos-scene-hunt.vercel.app/`）。
- 回滚基线（部署前）：`2xsstjup9`（2026-10-25 21:21，未见于 25 日文档、行为与 `79cd0e7` 一致）。

## 生产环境变量变更

| 变量 | 动作 |
|---|---|
| `REGISTRY_STORE=blob`（Production） | 新增，持久化 registry（works/users/sessions/audit） |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`（Production） | 新增（一次性）→ 管理员创建成功后**已删除并 redeploy 清除** |

最终变量清单：`REGISTRY_STORE`（Prod）、`PUBLISHED_GAMES_STORE=blob`（Prod+Preview）、`BLOB_READ_WRITE_TOKEN`（三环境）。

## 维护窗口与历史导入

- 10:12 部署完成 → 历史游戏公开读取进入预期 404（registry 为空、无旧路径回退，代码刻意设计）。
- 10:24 dry-run（零写入）：`listingComplete=true`，8 游戏 / 12 版本全部 `import_published`、0 隔离，与 V7/V8 报告一致。
- 10:25 `--apply`：`applied=true`，8/8 上线、0 隔离、0 跳过；只写 registry，未 put/delete/覆盖任何游戏对象。
- 10:26 幂等复跑：8 全部 `skipExisting`，0 写入——registry 跨请求/跨实例持久（Blob）确认。
- 404 窗口实际时长约 **13 分钟**（10:12–10:25）。
- 注：`igsl-eight-transformations` 从未发布过（旧生产部署上即 404，属云端目录分发的官方内容包），不属迁移范围。

## 字节一致性

部署前基线哈希（旧读路径）与导入后（registry 读路径）完全一致：
`bsop-classic-01=2b4f3db6a861d992`、`seminary-field-lab=8fb4fbefc9c51219`（与 V8 报告同值）；`bsop-classic-01` 响应体 `cmp` 字节级一致。

## 部署后验收

| 项 | 结果 |
|---|---|
| 首页 / `/admin/login` | 200 / 200 |
| 管理员登录 | 200，`role=admin`（zemeiyu2@gmail.com） |
| 未认证 `/api/admin/users` | 401（未登录访问 `/admin` 跳登录页） |
| 后台页面（works/queue/users/audit） | 全部 200（带会话） |
| registry 持久化 | Blob（REGISTRY_STORE=blob + 幂等复跑证据） |
| 创作侧页面 `/games` `/create` `/design` | 全部 200 |
| 历史游戏读取 | 8/8 恢复，哈希一致 |
| bootstrap 变量 | 已删除 + redeploy 清除，登录复验 200（账号持久于 Blob） |

## 遗留与后续

- 导入作品归属 `legacy-import@mos-scene-hunt.invalid`（suspended，不可登录）；需管理员在后台逐个「转移作品归属」。
- `POST /api/publish` 现为「登录 + 归属 + 进审核」；云端发布循环（feat/cloud-publish-loop）行为需在新审核模型下复测。
- 功能实测清单见本轮交付报告；未合并 master（未获授权）。
