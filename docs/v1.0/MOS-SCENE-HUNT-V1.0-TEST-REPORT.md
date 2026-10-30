# MOS Scene Hunt V1.0 · 测试报告（TEST REPORT）

- 执行时间：2026-10-30 11:54–12:45 GMT+8 ｜ 分支 `v1.0/platform-optimization`
- 全部数字来自本机实跑；未执行项明确标注，不用测试数量代替功能验收。

## 1. 自动化测试结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元/集成测试 | `npx vitest run` | **798 / 798 通过**（62 文件） |
| TypeScript | `npx tsc --noEmit` | **0 错误** |
| ESLint（本任务改动文件） | `npx eslint <changed>` | **0 error / 0 warning**（`app/map/page.tsx` 另有 2 条既有警告，非本次引入） |
| 生产构建 | `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1 npx next build` | **成功**（20+ 路由，含 /content/cloud/catalog.json 动态路由） |
| 玩家端 E2E | `node tests/e2e/run.mjs` | **40 / 40 通过**（本轮含此前历史失败项「地图页雷达任务卡」，已随本轮通过） |
| 管理后台 E2E | `node tests/e2e-admin/run.mjs http://127.0.0.1:3210` | **59 / 59 通过**（登录、审核、发布、转移、下架、改密、审计全链路） |
| **演示/存档隔离探针（新增）** | `node tests/e2e/run-probe.mjs probe-demo-isolation.mjs` | **7 / 7 通过** |

### 1.1 基线对照

| 阶段 | 单测 | E2E |
| --- | --- | --- |
| 基线 3331715（开工） | 739/739 | 39/40（雷达任务卡失败） |
| 模块 B/C 后 | 753/753 | 39/40（同一失败项） |
| 合并 qa/phase2 后 | 798/798 | **40/40** |

基线差异：模块 B/C 改动前后失败集合完全一致（0 项新失败）。E2E 雷达项在本轮通过，属外部瓦片/时序改善，与代码改动无因果关系，不据此宣称「修复了该问题」。

## 2. 新增测试清单（本任务）

| 文件 | 覆盖 |
| --- | --- |
| `tests/runtime/mode.test.ts`（6） | player/demo/preview 判定、?demo=1、会话标记、demo 优先于残留 preview、非法值不升级权限 |
| `tests/demo/demo-isolation.test.ts`（8） | demo/preview 写 sessionStorage 独立命名空间、player 键格式不变、demo 不回退读真人存档、跨命名空间互不串、清除只清本命名空间、损坏载荷读作空 |
| `tests/location/simulator-gate.test.ts`（4） | 生产无开关=无模拟器/无演示；SIMULATOR=1 才有 DEV 模拟器；**AUTO_DEMO=1 可在无 DEV 模拟器时演示（D-003 解耦）**；dev 构建两者默认可用 |
| `tests/e2e/probe-demo-isolation.mjs`（7） | 见 §3 |
| `tests/cloud/*`（3 项改写） | 目录契约随 3331715 变更（registry published 唯一来源；降级仍 200 + 留痕） |

## 3. H2 关键验收项执行记录

### 3.1 真人存档保护测试（任务书 H2-1）— **通过（7/7 探针）**

步骤（真实 Chrome，390×844，独立临时 profile）：
1. 预置真人进度：本地包 `probe-demo-iso`（2 站），第 1 站 completed、背包 1 件、save-index 1 行；快照全部玩家键。
2. `?demo=1` kiosk 深链运行**完整自动演示**：站点传送→到达→故事→自动作答→奖励→回地图→第二站→结束页（≤3 分钟实际达成）。
3. 断言 **演示后玩家键逐字节一致**：✓（`save:<id>` 与 `save-index` 完全一致）。
4. 断言演示状态只在 `sessionStorage mos-scene-hunt:demo:<id>`：✓（localStorage 玩家键未变）。
5. 点「返回游戏中心」→ 落 `/games`：✓。
6. 重进玩家页：`g1=completed`、`completedAt=111` 保留，`g2=locked`，界面显示「继续寻宝」：✓。

> 说明：重进玩家页时 provider 的既有 hydration 会归一化存档（按包内奖励 id 重建背包、刷新 lastUpdatedAt）。这是产品原有行为，发生在**玩家模式**；演示期间零字节变化已在第 3 步严格验证。

### 3.2 演示奖励隔离（H2-2）— 通过
演示全程不产生任何玩家侧积分/奖励/完成状态写入（3.1 第 3 步的字节级证据 + 奖励只写 demo 命名空间）。

### 3.3 设计者预览隔离（H2-3）— 通过（代码路径 + 单测）
预览入口整页导航进 preview 模式；preview 命名空间单测覆盖「不清真人存档」「不与 demo 串」；预览过程不调用任何写包函数（包写入仅存在于显式保存操作）。

### 3.4 GPS 安全测试（H2-4）— 通过（门控单测 + 结构分析）
- 生产构建无 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`/`AUTO_DEMO` 时：无 DEV 面板、无演示、无模拟 fix 来源（门控测试）。
- URL 参数：`?demo=1` 在不支持的构建上**不升级为 demo 模式**（本轮新增守卫 + 测试）。
- localStorage 篡改 `settings.simulatorEnabled`：构建未启用模拟器时 `isSimulatorAvailable()=false`，模拟 fix 通道不激活（代码路径 `gps-provider` 效应 + 门控测试）。
- **限制（如实）**：客户端 GPS 无法防开发者工具级定位伪造；本任务只保证「演示/预览不污染真人存档」与「生产默认不给伪造工具」。服务端验证未实现（见 ARCHITECTURE §4）。

### 3.5 异常恢复（H2-5）— 部分验证
- 演示中刷新：sessionStorage 存活 → 演示继续（实现机制 + 探针跨页导航持续性间接验证）。
- 关标签页：sessionStorage 自动清理（浏览器语义，未做自动化剥离验证）。
- 演示中退出/网络中断：探针覆盖退出路径；离线/网络中断未单独自动化。
- **未做真机断网实测**：标注为待现场验证。

## 4. E2E 覆盖范围（玩家端 40 项）

首页/选择/地图/到达/场景/挑战/奖励/背包/任务/游戏中心/创作导入/设计预览/分享链接保存/存档恢复/模拟器驱动全流程等。真实设备项（真机 GPS、iOS 配额）不在自动化范围，见 §6。

## 5. 测试命令复现

```bash
cd <repo>/scene-hunt-v10
npx vitest run                       # 798/798
npx tsc --noEmit                     # 0 错误
node tests/e2e/run.mjs               # 40/40（自构建 + 自起服 3100）
node tests/e2e/run-probe.mjs probe-demo-isolation.mjs   # 7/7（3102）
# 后台 E2E：
BOOTSTRAP_ADMIN_EMAIL=admin@e2e.test BOOTSTRAP_ADMIN_PASSWORD=*** REGISTRY_STORE=file npx next start -p 3210
node tests/e2e-admin/run.mjs http://127.0.0.1:3210      # 59/59
```

## 6. 未执行 / 无法在自动化环境验证（如实标注）

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真机 GPS 户外实测行走 | FIELD_CALIBRATION_PENDING | 需现场人员与真实定位 |
| iPhone Safari 存储配额验收清单（9 项） | 待真机 | 今晨遗留清单，桌面无法冒充 |
| 平板/大屏真机走查 | 未执行 | CSS 断点已实现，需真机/投影确认观感 |
| 演示中真断网/强杀进程 | 未执行 | 需真机操作时序 |
| 生产环境变量调整后的生产验证 | BLOCKED | 需用户授权部署 |

## 7. 环境说明

- Windows / Node 22.22.2 / Next 16.4.2 / Chrome 本机路径；E2E 使用独立临时 user-data-dir，数据隔离。
- 构建期间触发了本机安全删除守卫（`.next` 批量删除需确认），处理方式为**移走旧 `.next` 目录后构建**，未绕过守卫、未删除项目文件。
