# RELEASE-EXEC-02｜阶段 C/D：Production 部署记录

- 执行时间：2026-10-25 21:03–21:06（GMT+8）

## 阶段 C：部署前检查与构建

- 阶段 A（Production 变量 `PUBLISHED_GAMES_STORE=blob`）与阶段 B（worktree 干净、HEAD=`79cd0e7`）验收证据已复核。
- 在 worktree 中清空 `.next` 后全量重建：`npm run build` 成功（Compiled in 24.1s），产物含 `/api/publish`、`/api/games/[gameId]`。
- 构建后再次还原被工具改写的 `tsconfig.json`，部署前 `git status` 干净、`git diff HEAD` 为空——**部署输入严格对应冻结提交 `79cd0e7`**，不含原开发工作区任何未提交文件。
- **回退基线（部署前记录）**：旧 Production 部署 `i9ydgjid4`（● Ready，2026-10-22 10:01，无发布 API）；回退手段 `vercel rollback` 或重新部署该构建；Blob 数据不受回退影响。

## 阶段 D：Production 部署

- 命令类型：`vercel deploy --prod`（在冻结 worktree 内，项目链接指向 `prj_JtB7…`）。
- **新部署**：ID `36tawoe33z5GqYMmkr47FoMWSZdR`，URL `https://mos-scene-hunt-pgl7idlsu-zemeiyu2-1187.vercel.app`，环境 **Production**，状态 **● Ready**，创建于 2026-10-25 21:05:03（`vercel inspect` 实测）。
- 部署来源：本地上传自 HEAD=`79cd0e7` 的干净 worktree（CLI 部署模式，平台无 Git 元数据字段；来源由 worktree HEAD + 提交前零差异证明）。
- 生产域名 `https://mos-scene-hunt.vercel.app/` 实测 200。
- 未重试、未重复部署；状态无异常。
