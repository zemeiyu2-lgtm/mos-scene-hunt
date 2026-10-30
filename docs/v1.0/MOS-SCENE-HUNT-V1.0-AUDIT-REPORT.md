# MOS Scene Hunt V1.0 · 基线审计报告（AUDIT REPORT）

- 审计时间：2026-10-30 11:44–12:30 GMT+8 ｜ 全部结论来自实际执行，不采信旧报告。

## A1 仓库核实

| 项 | 值 |
| --- | --- |
| 主仓库 | `D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt`（原 C 盘路径已随目录联接迁移至 D 盘） |
| 主 worktree 分支 | `feat/local-pack-storage-manager` @ `de230df`（领先 origin/master 9 提交，未推送） |
| 正式整合线 | `integration/20261030-admin-storage` @ `3331715`（worktree scene-hunt-integration30；任务书所引 48a0638 为该线上的合并提交，其后已有 9082355 自动演示、3331715 目录修复） |
| QA 线 | `qa/phase2-20261029` @ `66810f3`（0ed1e4e 测试包+隔离发布闭环、0df4762 packUrl 修复、1b9c321 复核报告 P-1..P-7、E2E 40/40 快照），与整合线分叉于 `48f55a4`，**未互相合并** |
| 其他 worktree | scene-hunt-admin（feat/admin-platform @ ef71ab2）、scene-hunt-gameplay、scene-hunt-arrival、scene-hunt-sounds、scene-hunt-baseline-check（6cd0468 detached）等 |
| 工作区 | 主 worktree 干净（3 个遗留未跟踪诊断脚本）；v10 工作树为本任务专用 |
| 远端 | `origin/master` @ `6cd0468`（落后生产内容，存在漂移） |

## A2 生产部署核实（只读）

| 项 | 值 |
| --- | --- |
| 生产别名 | https://mos-scene-hunt.vercel.app → `dpl_DuvsvoRuTkrBTJECHiEJXaqZ3LMr`（`gi2t5r4xs`，2026-10-30 11:20:47，CLI 上传无 git 元数据） |
| 内容判定 | 与整合线 `3331715`（11:20 提交）时间吻合，判定生产 ≈ 3331715 |
| 今日部署轨迹 | 09:47 `6yc5ia8xd`=7ea65a8 存储修复（DEPLOY 文档+指纹核验）→ 10:46 `gq9r9kykw`=c94269e 存储体系 V1 → … → 11:20 `gi2t5r4xs`=3331715。均出自今晨前一会话（有 DEPLOY-2026-10-30 文档记录，来源明确，非不明部署） |
| 生产功能确认 | 游戏中心/registry 目录（`/content/cloud/catalog.json` 仅返回 1 条 published `mos-classic-01`）、官方包 API 200、创作/设计入口正常 |
| **生产环境变量** | `REGISTRY_STORE`(Secret)、`PUBLISHED_GAMES_STORE`、`BLOB_READ_WRITE_TOKEN`、**`NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`(Config/Production, 11:18 创建) ← P0** |

**P0 发现**：生产构建启用了 DEV GPS 模拟器（环境变量 11:18 设置 + 生产 bundle 含 simulatorEnabled 代码证实）。后果：任何玩家可在生产打开模拟面板伪造定位获得奖励，违反 D-003。成因：自动演示依赖 `isSimulatorAvailable()` 门控，前一会话为让生产可演示而开启该变量。修复：本任务 C 模块已将演示与 DEV 模拟器解耦（`NEXT_PUBLIC_ENABLE_AUTO_DEMO=1`）；**移除生产环境变量需用户授权**，列入部署前检查清单。

## A3 代码架构（模块地图）

见 ARCHITECTURE 文件 §1。关键结论：
- 无统一 RuntimeMode（已由本任务补建）；demo 曾与真人共用持久化路径（**P0，已修复**：autopilot 调 startHunt/resetHunt 直接写 `save:<gameId>`）。
- 到达判定不区分真实/模拟 fix（仍成立，属客户端信任边界，见 ARCHITECTURE §4 如实声明）。
- 管理后台/registry/游戏中心数据链完整；游戏中心目录=registry published（`games:[]` 内置目录不硬编码条目）。
- 响应式为 480px 手机壳，无平板/大屏断点（已由 E 模块补建）。

## A4 基线测试（v10 worktree @ 3331715 实测）

| 检查 | 结果 |
| --- | --- |
| Vitest 全量 | 739/739（55 文件） |
| tsc --noEmit | 0 错误 |
| E2E（qa 线记录） | 40/40（玩家端）；存储分支 39/40，唯一失败项「地图页显示雷达任务卡」为**既有基线失败**（基线 6cd0468 同样失败），非本任务引入 |
| 生产构建 | 记录成功（20 路由，今晨 09:34–10:00 实跑） |

## F/G 模块核查结果（2026-10-30 实测）

### 官方示范包与母版（F）
- 玩家官方示范包：`mos-classic-01` v1.1.0「神学院的八个秘密」，生产 `/api/games/mos-classic-01` 200，8 站坐标均为**真实地理坐标**（马尼拉神学院区域，非模板 0,0 占位），半径均 10m。
- 站点间距：两两最小 **27.1m**（secret-03~secret-07）> 2×半径 20m 阈值，无触发圈重叠。
- 设计者母版 `mos-classic-01-template`：仓库代码无引用（不存在于 content/），属设计者本机/registry works 数据。**未经授权未做任何生产包写操作**。
- 仓库内置 8 站包 `igsl-eight-transformations` 可供演示与设计参考；默认包 `demo-hunt`。
- **FIELD_CALIBRATION_PENDING**：以上为远程数据分析（坐标清单/间距/半径），未做现场 GPS 实测，官方示范包不得宣称已通过实地定位验收。

### 后台/存储/目录（G）
- 游戏中心只展示 registry published ✅（代码 + 生产目录仅 1 条实测）。
- registry 为目录唯一真实数据来源 ✅；内置静态目录无硬编码条目 ✅。
- 本地存储管理误删保护 ✅（7ea65a8 F1/F2 修复 + content-cache/local-pack 测试钉住）。
- 未上架游戏仍可经本机 authoring 导入游玩 ✅（loadGame 本机优先）。
- 管理后台回归：由 tests/e2e-admin 套件覆盖（本任务运行结果见 TEST-REPORT）。

## 风险与遗留（更新自 MASTER-PLAN §12）

1. **P0（待授权）**：生产 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR` 仍开启；代码侧解耦已完成，须在下次授权部署时移除该变量并改设 `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1`。
2. 整合线与 qa/phase2 线未合并 → I 模块处理。
3. E2E 既有失败 1 项（雷达任务卡），历史遗留。
4. FIELD_CALIBRATION_PENDING（现场 GPS 校准）。
5. iPhone 真机存储验收清单（今晨遗留）未执行。
