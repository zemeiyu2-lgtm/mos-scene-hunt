# MOS Scene Hunt V1.0 · 发布候选（RELEASE CANDIDATE）

- 生成：2026-10-30 12:50 GMT+8
- **状态：具备 V1.0 发布候选条件（有条件）—— 生产部署未执行，等待用户验收与授权。**

## 1. 版本标识

| 项 | 值 |
| --- | --- |
| 分支 | `v1.0/platform-optimization` |
| HEAD commit | `2a492af`（RC 生成时点；后续文档提交见 `git log`） |
| 基线 | `integration/20261030-admin-storage` @ `3331715`（= 当前生产内容） |
| 合并 | 已并入 `qa/phase2-20261029` @ `66810f3`（`74c2a10`），唯一冲突为测试产物 JSON，保留最新快照 |
| worktree | `D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt-v10` |
| 远端 | **未推送**（无推送授权，按纪律保留本地） |

## 2. 变更摘要

### 运行模式与存档隔离（核心）
- 新增 `lib/runtime/mode.ts`：`player | demo | preview`，挂载时一次判定，安全默认 player；演示标记仅在支持演示的构建生效。
- `lib/storage`：`saveGameStateForMode / loadGameStateForMode / clearGameStateForMode`；demo/preview 走 sessionStorage 独立命名空间；**玩家存档键名与信封格式零改动**。
- `hunt-provider`：hydrate/persist/reset 全部按模式路由；接口暴露 `runtimeMode`；save-index 仅记录 player。
- 演示入口（/select 按钮、`?demo=1` 深链）与退出都改为整页导航，杜绝「player 模式 provider 被复用」。
- 设计者试玩（design/create）进入 preview 模式，/select 出现预览条与「结束预览」出口。

### GPS 安全治理
- 自动演示改用独立模拟 fix 注入通道，不再改写 `settings.simulatorEnabled`、不显示 DEV 面板。
- 新增 `NEXT_PUBLIC_ENABLE_AUTO_DEMO` 门控：**生产 kiosk 无需再启用 DEV 模拟器**（D-003 解耦）。
- demo 模式下设置驱动的模拟通道被禁用（单一来源）。

### 自动演示产品化
- 速度档（慢/正常/快，sessionStorage），所有演示等待（到达节拍、作答高亮/提交、奖励停留）随之缩放。
- 结束页：完成站点数、用时、速度 + 重新演示 / 返回游戏中心，明示「不计入真人成绩」。
- 退出清 demo 会话并整页返回 /games；刷新延续、关页清理。

### 多端适配
- ≥768px 页面放宽至 640px；≥1280px 至 760px 并放大正文可读性；演示条大屏放宽。
- 地图页 ≥1024px 显示全屏切换（Fullscreen API，随 fullscreenchange 同步）。

### 整合
- 合并 qa/phase2：测试包、隔离发布闭环脚本、备份/恢复工具、packUrl 修复、后台认证测试。
- 目录测试按 3331715 契约更新（registry published 唯一来源）。

### 文档
- `docs/v1.0/` 八份 V1.0 交付文件。

## 3. 关键文件清单

| 文件 | 变更 |
| --- | --- |
| `lib/runtime/mode.ts` | 新增：模式解析与 preview 会话标记 |
| `lib/storage/index.ts` | 模式路由三函数 + sessionStorage 安全适配 + 信封校验复用 |
| `components/hunt-provider.tsx` | 模式判定、按模式 hydrate/persist/reset、runtimeMode 暴露 |
| `components/demo-autopilot.tsx` | 注入通道、速度档、结束页、干净退出 |
| `components/gps-provider.tsx` | demo 模式禁用设置驱动模拟 |
| `lib/demo/autopilot.ts` | isDemoSupported、速度档 |
| `app/select/page.tsx` | 演示入口整页导航、预览条与退出 |
| `app/design/page.tsx`、`app/create/page.tsx` | 试玩进入 preview 模式 |
| `app/challenge/[sceneId]/page.tsx`、`app/reward/[sceneId]/page.tsx` | 演示等待按速度缩放 |
| `app/globals.css` | 平板/大屏断点、预览条空间 |
| `app/map/page.tsx` | 全屏切换按钮 |
| `tests/runtime/mode.test.ts`、`tests/demo/demo-isolation.test.ts`、`tests/location/simulator-gate.test.ts` | 新增 18 项单测 |
| `tests/e2e/probe-demo-isolation.mjs` | 新增 7 项隔离探针 |

## 4. 测试结论（详见 TEST-REPORT）

| 项 | 结果 |
| --- | --- |
| 单元/集成 | 798/798 |
| TypeScript | 0 错误 |
| ESLint（改动文件） | 0 error / 0 warning |
| 生产构建 | 成功 |
| 玩家端 E2E | 40/40 |
| 管理后台 E2E | 59/59 |
| 演示/存档隔离探针 | 7/7 |

## 5. 已知问题与发布风险

| # | 项 | 等级 | 处置 |
| --- | --- | --- | --- |
| 1 | **生产仍开着 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`**（11:18 设置）：生产玩家可用 DEV 模拟面板 | **P0（需授权）** | 部署 V1.0 时必须同时移除该变量、改设 `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1`。代码侧已解耦，变量不改则修复无效。 |
| 2 | 现场 GPS 校准未做 | 现场项 | `FIELD_CALIBRATION_PENDING`，不得宣称实地验收 |
| 3 | iPhone Safari 配额清单 9 项未走真机 | 现场项 | 今晨遗留，需真机 |
| 4 | 平板/大屏仅代码层适配 | 中 | 需真机/投影观感确认 |
| 5 | 预览条只在 /select 出现（进入 /map 后不可见） | 低 | 下一轮可在地图页加常驻标记 |
| 6 | 「上一站」「从指定站起播」未实现 | 低 | 经评估复杂度高、价值有限，本版暂缓（任务书允许） |
| 7 | 客户端信任边界（无法防开发者工具伪造） | 结构性 | 已如实写入 ARCHITECTURE §4，服务端验证列入演进 |
| 8 | 生产部署来源无 git 元数据（CLI 上传） | 低 | 建议后续部署改用 git 集成或记录部署 ID 到文档 |

## 6. 部署前检查清单（需用户执行/授权）

- [ ] 验收本 RC（可先部署 Vercel Preview 检查，非生产）
- [ ] **移除** 生产环境变量 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`
- [ ] **新增** 生产环境变量 `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1`（如需生产演示）
- [ ] 记录部署前生产部署 ID（当前 `dpl_DuvsvoRuTkrBTJECHiEJXaqZ3LMr` / `gi2t5r4xs`）作为回滚点
- [ ] 确认 `REGISTRY_STORE`、`PUBLISHED_GAMES_STORE`、`BLOB_READ_WRITE_TOKEN` 保持原值
- [ ] 部署后核验：`/`、`/select`、`/map`、`/games`、`/api/games/mos-classic-01`、`/content/cloud/catalog.json` 均 200
- [ ] 部署后核验：生产无 DEV 模拟面板入口；`?demo=1` 可演示（若开 AUTO_DEMO）
- [ ] 部署后核验：既有玩家存档可继续（真机开一个旧进度）

## 7. 版本记录

| 提交 | 内容 |
| --- | --- |
| `2d8d507` | 运行模式隔离（核心） |
| `cf8b6ec` | 演示速度/多端适配/全屏 |
| `104cb40` | 架构与审计文档 + 能力门控测试 |
| `d41777a` | 演示隔离探针 |
| `74c2a10` | 合并 qa/phase2 |
| `2a492af` | 演示能力守卫 + 目录契约测试 + lint 清理 |
