# MOS Scene Hunt V1.0 · 技术决策记录（DECISIONS）

纪律：每项重要决策入册；新增决策必须写文件，不只留在对话。`可变更=否` 的决策变更需用户授权。

---

## D-001 真人存档与演示/预览存档必须隔离
- 日期：2026-10-30 ｜ 可变更：否
- 问题：自动演示当前经 `hunt-provider` 的统一持久化路径写真人存档 `mos-scene-hunt:save:<gameId>`。
- 证据：`components/hunt-provider.tsx:228-247`（持久化 effect）、`components/demo-autopilot.tsx:45,99-103,190-196`（autopilot 调 startHunt/resetHunt）。
- 决策：引入 `RuntimeMode = "player" | "demo" | "preview"`；持久化按模式路由——player 走现有 `save:<gameId>`（**格式与键名完全不变**），demo 走 `mos-scene-hunt:demo:<gameId>`（sessionStorage），preview 走 `mos-scene-hunt:preview:<gameId>`（sessionStorage）。save-index 只记 player 模式。
- 影响：hunt-provider、lib/storage、lib/demo、app/select、app/design、app/create。
- 兼容：旧存档读取路径零改动；真人对玩家可见行为不变。

## D-002 自动演示不得调用重置真人数据的逻辑
- 日期：2026-10-30 ｜ 可变更：否
- 决策：`resetHunt` 在 demo/preview 模式下只清对应命名空间；演示「重新开始」仅重置演示 session。

## D-003 开发模拟定位不能成为正式玩家获取奖励的途径
- 日期：2026-10-30 ｜ 可变更：否
- 证据（2026-10-30 核实）：生产环境变量 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`（Config/Production，11:18 创建）+ 生产 bundle 含 `simulatorEnabled` 代码 → 当前生产构建开放开发模拟面板，违反本决策。
- 决策：①演示与开发模拟器解耦——autopilot 改用独立演示定位通道（不经 `settings.simulatorEnabled`、不渲染 DEV 面板），门控改由 `NEXT_PUBLIC_ENABLE_AUTO_DEMO==="1"` 或 dev 构建决定；②玩家模式下模拟 fix 一律拒绝进入到达判定；③**生产环境应移除 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`、新增 `NEXT_PUBLIC_ENABLE_AUTO_DEMO`**（环境变量变更需用户授权，列入部署前检查清单）。

## D-004 真人/演示/预览必须有明确运行模式边界
- 日期：2026-10-30 ｜ 可变更：否
- 决策：模式在 HuntProvider 挂载时一次性判定（URL `?demo=1`/`?preview=1` 或 sessionStorage 标记；默认 player=安全默认）。演示/预览进入采用**整页导航**（location.assign）重挂载 provider，禁止在已挂载的 player 模式 provider 上原地切换后继续写存档。模式暴露于 HuntContext，禁止各页面自行猜参数。
- 已知限制（如实记录）：sessionStorage 生命周期=标签页；刷新保留演示（预期），关标签页自动清理（预期），同标签页跳去设计中心会残留标记（退出按钮与结束页负责清理）。

## D-005 官方玩家示范包与设计者母版必须独立
- 日期：2026-10-30 ｜ 可变更：否
- 核实（待 F 模块复核）：玩家官方示范包 `mos-classic-01`；设计者母版 `mos-classic-01-template`；原始包 `bsop-classic-01`。

## D-006 正式游戏包不能被设计者预览或编辑流程直接覆盖
- 日期：2026-10-30 ｜ 可变更：否
- 决策：预览模式使用 preview 命名空间，读写包内容仍走 `listAuthoredGames/saveAuthoredGame` 既有显式保存操作；预览过程中不调用任何写包函数。

## D-007 生产发布必须经过唯一正式整合流程
- 日期：2026-10-30 ｜ 可变更：否
- 决策：V1.0 发布候选 = `v1.0/platform-optimization`（含 qa/phase2 合并）→ 全量测试 → 用户验收 → 用户授权部署。

## D-008 不得无必要重写稳定引擎
- 日期：2026-10-30 ｜ 可变更：否
- 决策：`lib/game/state.ts` 引擎、`gameReducer`、到达判定、存储 core 一律复用；本次只改「谁读写哪块存储」与「演示怎么注入定位」，不改游戏规则。

## D-009 现场 GPS 校准状态标注
- 日期：2026-10-30 ｜ 可变更：否
- 决策：官方示范包坐标未做现场实测前，一律标注 `FIELD_CALIBRATION_PENDING`，禁止宣称已通过实地验收。

## D-010 未授权的生产操作不得执行
- 日期：2026-10-30 ｜ 可变更：否
- 决策：不执行 `vercel deploy --prod`、不改生产 Alias/环境变量/数据。发现的问题（如生产模拟器开关）以报告+待授权清单呈现。

## D-011 客户端信任边界如实声明
- 日期：2026-10-30 ｜ 可变更：否
- 决策：当前奖励与完成状态为纯客户端判定（无服务端进度校验）；`POST /api/publish` 无鉴权（内容校验+256KB 上限+409 占用保护）。本任务如实声明该边界，不擅自建设账号/反作弊系统；服务端验证列入演进路线（见 ARCHITECTURE 文件）。

## D-012 演示定位注入通道
- 日期：2026-10-30 ｜ 可变更：是（实现细节）
- 决策：gps-provider 新增演示 fix 注入口（`simulated:true` 标记保留），仅 demo 模式可激活；demo 模式不再改写 `settings.simulatorEnabled`（避免污染玩家设置）；演示退出恢复原设置。

## D-013 存档兼容承诺
- 日期：2026-10-30 ｜ 可变更：否
- 决策：player 存档键名/信封格式不变；任何未来格式变更必须先出向后兼容方案+迁移测试，并单独授权。
