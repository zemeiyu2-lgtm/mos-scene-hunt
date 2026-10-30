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
| **演示/存档隔离探针（新增）** | `node tests/e2e/probe-demo-isolation.mjs` | **7 / 7 通过**（A 项含 SHA-256 字节级证据，见 §3.1） |

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
3. 断言 **演示后真人存档逐字节一致（A 项）**：✓ —— 演示结束页上**不重进玩家模式、不触发 hydration**，直接在同一页面上下文读取 localStorage：`save:<id>` 与 `save-index` 的**原始字符串相等且 SHA-256 相等**（本轮复核实测：`48f3f605475805732264daf12befd19133af14f109ffded03f91129837849451` 前后一致）。
4. 断言演示状态只在 `sessionStorage mos-scene-hunt:demo:<id>`：✓（localStorage 玩家键未变）。
5. 点「返回游戏中心」→ 落 `/games`：✓。
6. **重进玩家页（B 项，语义级）**：`g1=completed`、`completedAt=111`、奖励 id `g1:keyword:线索甲`、背包 `keyword:线索甲`、关键词、`startedAt` 全部保留；`g2=locked`；界面显示「继续寻宝」：✓。

> 归一化记录（如实）：重进玩家页时既有 hydration/reconcile 会刷新 `lastUpdatedAt`（本轮实测 1 → 1793339002395）并按包内奖励 id 重建背包条目。这是**玩家模式**的产品原有行为，不是演示造成；有效进度无丢失。演示期间字节级零变化已在第 3 步以 SHA-256 严格验证。

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

## 8. 验收复核轮（2026-10-30 13:37–13:55，基于 a191c89 重建产物）

按用户复核指令重跑/补证，全部为本机隔离环境实跑。

### 8.1 真人存档隔离证据复核（复核指令 §一）— **A、B 两项分别通过**

| 项 | 方法 | 结果 |
| --- | --- | --- |
| **A 演示期间字节级** | 预置真人进度 → 快照原始内容 + SHA-256 → 完整自动演示至结束页 → **不重进玩家、不触发 hydration** → 同页上下文直接读 localStorage → 对比原始字符串与 SHA-256 | **通过**：`save:probe-demo-iso` 与 `save-index` 原始内容相等，SHA-256 前后均为 `48f3f605…49451` |
| **B 重进真人游戏（语义级）** | 以玩家模式重进触发 hydration/reconcile → 比较完成站点、奖励 id、背包、关键词、startedAt、completedAt → 记录 lastUpdatedAt 归一化 | **通过**：有效进度零丢失；`lastUpdatedAt` 1 → 1793339002395（reconcile 刷新，已如实记录，非演示造成） |

探针已升级：显式 `crypto.subtle` SHA-256 取证、B 项含奖励/背包/归一化全量比对，证据写入 `tests/e2e/artifacts/probe-demo-isolation-summary.json` 的 `evidence` 字段。复跑基于 **a191c89 重新构建**的产物（原 .next 构建于 2a492af 提交之前，属过期，已重建消除疑点）。

### 8.2 GPS 模拟器门控复核（复核指令 §二，只读代码 + 隔离环境验证）

| # | 复核点 | 结论 |
| --- | --- | --- |
| 1 | 生产旧变量 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR` | **仍存在于 Production**（vercel env ls 只读确认，未做任何修改）——P0 环境风险未消除，部署前须授权移除 |
| 2 | 新变量 `NEXT_PUBLIC_ENABLE_AUTO_DEMO` | 仅用于 `lib/demo/autopilot.ts isDemoSupported()`：生产 kiosk 在**不开** DEV 模拟器的情况下启用自动演示 |
| 3 | 新代码是否摆脱 DEV 模拟器依赖 | **是**：演示能力 = AUTO_DEMO=1 或 dev 构建；模式判定（`resolveRuntimeMode`）额外要求 `isDemoSupported()`，`?demo=1` 在无能力构建回落 player |
| 4 | URL 参数能否开启开发模拟器 | **否（代码层）**：`isSimulatorAvailable()` 只读编译期 `NODE_ENV`/`NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`，无任何 URL 路径 |
| 5 | localStorage 能否开启开发模拟器 | **否（代码层）**：`settings.simulatorEnabled` 生效前提是 `isSimulatorAvailable()=true`（gps-provider 效应显式检查）；面板渲染同样被该门控挡住。但**当前生产因该 env=1 而开放**（环境问题，非代码问题） |
| 6 | 演示是否只用独立定位通道 | **是**：demo 模式下 settings 驱动的模拟通道被显式跳过（`demoMode` ref 检查），autopilot 经 `injectFix` 专用通道注入，并在地图显示「模拟定位中·非真实位置」 |
| 7 | 演示奖励能否进入正式玩家记录 | **不能**：进度持久化按模式路由（demo 只写 sessionStorage）；服务端无任何进度/奖励写入 API（仅 admin/auth/games/publish），奖励为纯客户端状态 |

### 8.3 生产发布边界复核（复核指令 §三，全部只读）

- 生产 Alias `mos-scene-hunt.vercel.app` → `dpl_DuvsvoRuTkrBTJECHiEJXaqZ3LMr`（`gi2t5r4xs`，10-30 11:20:47，● Ready）——与复核前**完全一致，未发生任何生产写入**。
- 该部署内容 ≈ 整合线 `3331715`（CLI 上传、无 git 元数据）。
- `v1.0/platform-optimization`（a191c89）**未推送远端**（`git ls-remote` 无此分支、无 upstream）。
- 其他工作分支（feat/admin-platform、feat/local-pack-storage-manager 等）均未部署生产；生产覆盖风险仅存在于用户授权后的部署动作本身。

### 8.4 多端适配模拟测试（复核指令 §四）— 模拟环境通过，真机待现场

`node tests/e2e/probe-responsive.mjs`（新增，puppeteer 设备模拟），证据：`tests/e2e/artifacts/responsive/`（12 张截图 + responsive-evidence.json）。

| 视口 | select | 场景（故事/挑战） | 地图 | 演示条 | 全屏按钮 |
| --- | --- | --- | --- | --- | --- |
| 手机竖屏 390×844 | ✓ | ✓ 排版正常 | ✓ | ✓ 顶部紧凑条（暂停/下一站/退出），不长期遮挡地图 | `display:none`（按设计隐藏） |
| 平板横屏 1024×768 | ✓ | ✓ | ✓ | ✓ | `display:flex` 可见 |
| 大屏 1600×900 | ✓ | ✓ 约 760px 居中列、可读性良好 | ✓ | ✓ | `display:flex` 可见 |

截图目检要点：手机演示地图显示「模拟定位中·非真实位置」诚实标注；大屏内容列无拉伸变形；平板地图站点卡/导航布局正常。模拟环境的「定位权限被拒绝」横幅与 DEV 模拟器条（该构建显式开启 SIMULATOR=1 所致）为**模拟环境性表现**，不代表生产。真机/投影走查保持**待现场验收**。
