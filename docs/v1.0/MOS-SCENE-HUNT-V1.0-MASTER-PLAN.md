# MOS Scene Hunt V1.0 · 中央任务总账（MASTER PLAN）

- 创建：2026-10-30 11:50 GMT+8（WorkBuddy V1.0 平台建设任务启动）
- 维护纪律：每完成一个模块/一批修改/一次全量测试/发现重大风险时增量更新；禁止覆盖他人历史结论。
- 配套文件：`MOS-SCENE-HUNT-V1.0-DECISIONS.md`、`MOS-SCENE-HUNT-V1.0-CURRENT-STATE.md`（同目录）。

## 1. 项目目标

以当前真实生产版本为起点，完成 MOS Scene Hunt V1.0 发布候选：真人 GPS 寻宝稳定、自动演示与真人数据隔离、设计者创建/编辑/预览/复制、官方示范包标准化、多端适配、后台/存储/发布稳定、全部功能有测试证据。生产部署权保留给用户。

## 2. 产品设计原则（固定）

自然探索为基础、现代导航为表达；手机优先，桌面服务设计者；先吸引参与再引导学习；有趣清晰易理解；安全健康积极，不用操纵性机制；保持 MOS 产品气质。

## 3. 当前生产基线（2026-10-30 11:44 核实）

| 项 | 值 |
| --- | --- |
| 生产别名 | https://mos-scene-hunt.vercel.app → `dpl_DuvsvoRuTkrBTJECHiEJXaqZ3LMr`（`gi2t5r4xs`） |
| 部署时间 | 2026-10-30 11:20:47 GMT+8（CLI 上传，无 git 元数据） |
| 内容对应 | 与 `integration/20261030-admin-storage` @ `3331715` 时间吻合（11:20 提交后立即部署），判定生产 ≈ `3331715` |
| 生产环境变量 | `REGISTRY_STORE`(Secret)、`PUBLISHED_GAMES_STORE`、`BLOB_READ_WRITE_TOKEN`、**`NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`(Config/Production, 11:18 创建) ← P0 风险** |
| 今日更早生产部署 | `6yc5ia8xd`(09:47=7ea65a8 存储修复)、`gq9r9kykw`(≈10:46=c94269e 存储体系V1) 等共 5 次，均出自今晨前一会话 |

## 4. 正式整合线与分支拓扑

- 主仓库：`D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt`
- **正式整合线**：`integration/20261030-admin-storage` @ `3331715`（含 48a0638 存储合并、9082355 自动演示、3331715 游戏中心目录修复）
- **QA 线**：`qa/phase2-20261029` @ `66810f3`（测试包+隔离发布闭环+备份恢复工具+P-1..P-7 修复+E2E 40/40），与整合线在 `48f55a4` 分叉，**尚未互相合并**
- **本次工作分支**：`v1.0/platform-optimization`（worktree `scene-hunt-v10`，基于 `3331715`）
- `origin/master` @ `6cd0468`（落后于整合线，存在漂移）

## 5. 基线测试（2026-10-30 11:54 实测，v10 worktree）

| 检查 | 结果 |
| --- | --- |
| Vitest 全量 | **739/739 通过**（55 文件） |
| `tsc --noEmit` | **0 错误** |
| E2E（QA 记录，qa 线） | 40/40（玩家端）；存储分支 39/40（同一基线失败项） |
| 生产构建 | 依 QA 记录成功（20 路由）；本任务将在改动后重跑 |

既有基线失败：E2E「地图页显示雷达任务卡」1 项（基线与本分支同样失败，历史问题，非本次引入）。

## 6. 已确认的技术架构（2026-10-30 代码探索）

- 状态中枢：`components/hunt-provider.tsx`（唯一编排缝：加载包→hydrate→GPS fix→reducer→持久化）
- 存档：localStorage `mos-scene-hunt:save:<gameId>`（信封）+ `save-index`；内容缓存 IndexedDB/Cache Storage
- 自动演示：`lib/demo/autopilot.ts` + `components/demo-autopilot.tsx`，sessionStorage 标记 `mos.demo.autopilot`，深链 `?demo=1`，驱动 DEV 模拟器逐站传送
- GPS：`components/gps-provider.tsx` 全局唯一 watchPosition；模拟 fix 带 `simulated:true`；门控 `isSimulatorAvailable()` = dev 构建或 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR==="1"`
- 到达判定：`lib/game/state.ts` FIX_UPDATE（只翻转 arrived↔locked）+ `lib/game/arrival*.ts`；**不区分真实/模拟 fix**
- 后台：`app/admin/(protected)`（邮箱+密码 scrypt 会话，BOOTSTRAP_ADMIN 引导）；registry `lib/registry/store.ts`（REGISTRY_STORE=file/blob）
- 游戏中心：`/games` → `/content/cloud/catalog.json`（动态路由=内置目录+registry published 条目）
- 响应式：`.app-shell max-width:480px` 手机壳，无平板/大屏断点

## 7. 不可随意改变的决策

见 DECISIONS 文件 D-001~D-013。核心：真人存档路径（`save:<gameId>` 及其格式）不变；演示/预览走独立命名空间；不重写稳定模块；生产操作需授权。

## 8. 工作模块与状态

状态：`NOT_STARTED` / `IN_PROGRESS` / `BLOCKED` / `COMPLETED` / `VERIFIED`（代码完成≠完成，需测试通过才可 VERIFIED）

| 模块 | 内容 | 状态 |
| --- | --- | --- |
| A 基线审计 | 生产/分支/代码架构/基线测试 | **COMPLETED**（本文件 §3-6） |
| 管理体系 | MASTER-PLAN/DECISIONS/CURRENT-STATE | **COMPLETED** |
| B 运行模式与存档隔离 | RuntimeMode + demo/preview 独立存储 | IN_PROGRESS |
| C GPS 安全治理 | 演示与开发模拟解耦、玩家模式拒绝模拟 fix | IN_PROGRESS |
| D 自动演示产品化 | 上一站/速度/结束页/异常恢复 | NOT_STARTED |
| E 多端适配 | 平板/大屏断点、演示条布局 | NOT_STARTED |
| F 示范包与母版核查 | 包关系/坐标清单/FIELD_CALIBRATION_PENDING | NOT_STARTED |
| G 后台/存储稳定性 | registry 数据源/误删保护/后台回归 | NOT_STARTED |
| H 完整测试 | 全量回归 + 新增隔离/安全/异常测试 | NOT_STARTED |
| I 整合与 RC | 合并 qa/phase2、发布候选文件 | NOT_STARTED |

## 9. 依赖关系

B（模式+存储路由）是 C/D/H 的地基；C 依赖 B 的模式判定；D 依赖 B 的演示独立存储；E 独立但最后统一回归；F/G 为核查型模块可并行；I 依赖全部。

## 10. 已完成的代码修改

（随进度追加，含分支/commit/文件清单）

- 2026-10-30：创建分支 `v1.0/platform-optimization`（基于 3331715），尚无新代码提交。

## 11. 测试结果汇总

- 基线：739/739 vitest + tsc 0 错误（v10 worktree @ 3331715）。
- （后续结果随进度追加，详见 TEST-REPORT）

## 12. 未解决问题

1. **P0**：生产 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR` 已启用（11:18 创建）→ 生产玩家可用开发模拟定位。修复方案见 C 模块；**移除该生产环境变量需用户授权**。
2. 整合线与 qa/phase2 线未合并（I 模块处理）。
3. E2E 基线失败「地图页雷达任务卡」1 项（历史遗留，单独排查）。
4. iPhone 真机存储验收清单未执行（今晨遗留，FIELD 类）。
5. 官方示范包坐标未经现场 GPS 实测（FIELD_CALIBRATION_PENDING）。

## 13. 风险清单

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 生产模拟定位可伪造到达/奖励 | **P0** | C 模块代码修复 + 部署时移除环境变量（需授权） |
| 演示写入真人存档 | P0 | B 模块隔离（本次核心） |
| 演示入口在玩家模式 provider 上先写存档再切模式 | P1 | B 模块入口改为整页导航重挂载 |
| 双整合线漂移 | P1 | I 模块合并 |
| 大规模 CSS 改动破坏手机端 | P2 | E 模块最小改动 + 回归测试 |

## 14. 最终验收标准

见任务书 §十四 A-H 清单（逐项在 TEST-REPORT / RELEASE-CANDIDATE 中勾选，禁止虚报）。

## 15. 发布候选信息

（I 模块完成后填写：分支、commit SHA、变更摘要、回滚点）
