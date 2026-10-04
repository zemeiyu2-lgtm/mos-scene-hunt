# MOS Scene Hunt

在真实世界里移动，解锁情境、线索与任务。一个手机优先的地理情境寻宝游戏引擎。

玩家走到地图上某个真实地点的触发半径内，情境自动解锁：读一段故事，答一个与眼前世界有关的问题，收集一个关键词，然后走向下一个地点。进度保存在本机，刷新不丢，断网可玩。

> **V0.1 定位**：技术底座与完整可玩闭环。先让「真实移动 → GPS → 地点触发 → 情境 → 任务 → 奖励 → 下一地点」真正跑通，再谈视觉与功能扩张。

## 快速开始

```bash
npm install
npm run dev          # 开发模式（http://0.0.0.0:3000）
```

生产构建：

```bash
npm run build
npm start
```

测试：

```bash
npm test                    # 单元测试（80 项）
node tests/e2e/run.mjs      # 端到端验收（40 项，自动构建并启停服务器）
```

> 验收构建会自动注入 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1`（DEV 定位模拟器的显式开关）。生产默认不注入，模拟器按设计惰性。

## 玩法闭环（V0.1 验收通过）

1. 打开网页 → 自动请求定位权限
2. 在地图上看到自己与目标地点、实时距离
3. 走进目标约 50m 半径 → 情境自动解锁
4. 回答挑战（简答 / 选择 / 关键词）
5. 获得奖励（关键词 / 徽章）→ 解锁下一站
6. 刷新页面 → 进度仍在；断网 → 游戏照常

内置演示寻宝 **Demo Hunt · 记忆之路**：三站式城市微寻宝（观察 → 辨认 → 归处），内容位于 `content/demo-hunt.json`。

## 技术栈

| 层 | 选型 | 许可证 |
| --- | --- | --- |
| 框架 | Next.js 15（App Router）+ React 19 + TypeScript（strict） | MIT |
| 地图 | Leaflet 1.9（原生 API，无绑定层）+ OpenStreetMap | BSD-2-Clause |
| 离线 | 手写 Service Worker + manifest（PWA） | — |
| 存储 | localStorage（存档）+ IndexedDB（内容包） | — |
| 测试 | Vitest（单元）+ puppeteer-core 驱动 Chrome（验收） | MIT / Apache-2.0 |

设计原则：

- **lib/ 零 React 依赖**：GPS 数学、游戏引擎、存档格式都是纯 TypeScript，可独立单测。
- **确定性引擎**：`(state, action) => state` 纯 reducer；解锁、判定、奖励全部由引擎决定，AI 永远不碰规则。
- **存储态与派生态分离**：存档只记玩家做过的事，「现在能做什么」实时计算。
- **内容与代码分离**：游戏数据在 `content/*.json`，引擎可装载任意场景包。

## 项目结构

```
scene-hunt/
├─ app/                  # 页面路由（首页/选择/地图/任务/背包/情境/挑战/奖励）
│  └─ content/[file]/    # 内容包分发路由（带路径穿越防护）
├─ components/           # React 视图与 Provider 编排（不含游戏规则）
├─ lib/
│  ├─ location/          # GPS 封装：geodesy / provider / simulator
│  ├─ game/              # 确定性引擎：types / state / answers
│  ├─ storage/           # 双层持久化
│  ├─ map/               # 瓦片源元数据（SSR 安全）
│  ├─ ar/                # AR 扩展接口（NullARProvider）
│  └─ content/           # 内容包加载与缓存
├─ content/              # 游戏数据（demo-hunt.json）
├─ public/               # sw.js / manifest / icons
├─ tests/                # 单元测试 + E2E 验收
└─ docs/                 # 架构/数据模式/许可证/测试报告
```

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 系统结构、数据流、核心设计决策、扩展点
- [docs/GAME-DATA-SCHEMA.md](docs/GAME-DATA-SCHEMA.md) —— 内容包字段语义与几何约束
- [docs/game-data.schema.json](docs/game-data.schema.json) —— 机器可校验的 JSON Schema
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md) —— V0.1 验收报告（120/120 通过）
- [docs/OPEN_SOURCE_NOTICES.md](docs/OPEN_SOURCE_NOTICES.md) —— 第三方组件与署名
- [docs/LICENSE-ANALYSIS.md](docs/LICENSE-ANALYSIS.md) —— 参考项目许可证核查与依赖审计

## DEV 定位模拟器

不开模拟器就没法在办公桌上测试「走进半径」。开发模式或显式开关下，地图右下角提供模拟面板：

- 输入任意经纬度传送玩家
- 拖动玩家标记直接改位置
- 预设坐标一键切换（含演示寻宝各站）

生产构建中模拟器**不可用**（`isSimulatorAvailable()` 要求非 production 或显式环境变量），不会把假坐标交给真实玩家。

## 为后续预留的扩展点

- **AI 叙述层**：场景的 `story/briefing/hint/npc/dialogue` 与包级 `aiProfile` 已入 schema；AI 只参与文案生产，规则永远归引擎。
- **AR 层**：`lib/ar/` 的 `ARProvider` 接口 + Null 实现，UI 在 provider 报告可用前不渲染任何 AR 入口。
- **后端/多人/账户**：所有状态经 `lib/storage` 统一出入，替换该层即可接入服务端，reducer 无需改动。
- **WebXR**：V0.1 明确不做；参考项目 `location-based-webxr`（Apache-2.0）的传感器融合思路已在架构文档中记录。

## 许可证

MIT（见 LICENSE）。运行时依赖全部为 OSI 认可许可证（MIT / Apache-2.0 / BSD-2-Clause），详见 [docs/OPEN_SOURCE_NOTICES.md](docs/OPEN_SOURCE_NOTICES.md)。

地图数据 © OpenStreetMap contributors（ODbL）；瓦片署名通过 Leaflet attribution 控件实时展示。
