# 架构说明（ARCHITECTURE）

本文档描述 MOS Scene Hunt V0.1 的系统结构、核心设计决策与扩展点。阅读对象：后续开发者。

## 1. 总览

```
┌────────────────────────── 手机浏览器（PWA）──────────────────────────┐
│                                                                      │
│  app/（页面路由，手机优先）                                           │
│    /            首页 · 寻宝选择入口                                   │
│    /select      寻宝选择                                             │
│    /map         地图（主视图）                                       │
│    /quest       任务清单                                             │
│    /bag         背包                                                 │
│    /scene/:id        情境阅读（进入半径后自动解锁）                   │
│    /challenge/:id    答题                                            │
│    /reward/:id       奖励展示                                        │
│    /content/:file    内容包分发路由（见 §5）                         │
│                                                                      │
│  components/（React 层，只做视图与编排，不含游戏规则）                │
│    RootProviders ─ Settings → GPS → Hunt（顺序不可换）               │
│    GameMap       地图渲染（原生 Leaflet，命令式图层同步）            │
│    TabBar        底部三栏导航（地图/任务/背包）                       │
│    SimulatorPanel DEV GPS 模拟器面板                                 │
│                                                                      │
│  lib/（纯逻辑层，零 React 依赖，可独立单测）                         │
│    location/   GPS 封装：geodesy 数学 / provider 系统接口 / simulator │
│    game/       确定性引擎：types 数据模型 / state reducer / answers   │
│    storage/    双层持久化：localStorage + IndexedDB                  │
│    map/        瓦片源元数据（SSR 安全）                              │
│    ar/         AR 扩展接口（空实现，见 §7）                          │
│    content/    内容包加载与缓存                                       │
│                                                                      │
│  content/（游戏数据，独立于代码）                                     │
│    demo-hunt.json   演示寻宝：三站式「记忆之路」                     │
│                                                                      │
│  public/                                                             │
│    sw.js             Service Worker（手写，见 §6）                   │
│    manifest.webmanifest   PWA 清单                                   │
│    icons/            应用图标                                        │
└──────────────────────────────────────────────────────────────────────┘
```

分层原则：

- **lib/ 不认识 React**。所有游戏规则、GPS 数学、存档格式都是纯 TypeScript，可以在 Node 里直接单测。
- **components/ 不含规则**。Provider 只做编排（取数、派发 action、防抖持久化），判断「答案对不对」「进没进半径」永远发生在 lib/。
- **页面只消费**。app/ 下的页面从 Provider 读派生值，渲染，没有游戏逻辑。

## 2. 数据流（一次定位更新的旅程）

```
浏览器 Geolocation API
  → lib/location/provider.watchPosition()      唯一订阅点，丢弃时间戳倒退的 fix
  → GpsProvider（components/gps-provider.tsx）  全局唯一的 fix 状态；模拟器开启时真 fix 让位
  → HuntProvider（components/hunt-provider.tsx） 派发 FIX_UPDATE action
  → lib/game/state.gameReducer                  纯函数：算距离、判半径、解锁场景
  → 派生值（statuses/distances/current/ratio）   经 useMemo 供页面消费
  → 防抖 250ms 写入 lib/storage                 localStorage 优先，IndexedDB 兜底
```

关键不变式：

- **fix 是值不是订阅**。任何组件都通过 `useGps()` 读最新的 fix 快照，绝绕过 Provider 直连 Geolocation。
- **reducer 是纯函数**。`(state, action) => state`，无副作用、无 Date.now（时间戳由 action 携带）、无随机数。这让它可以被逐帧回放测试。
- **持久化是派生的下游**。存档永远是 reducer 输出的忠实序列化，不存在「存档里另有真相」。

## 3. 存储状态 vs 派生状态（本项目最重要的设计决策）

V0.1 开发中出现过一次典型事故：`SceneProgress.status` 里存了 `"available"`，而 `availableSceneIds()` 又在运行时计算可达性——**两个事实来源**，刷新后互相矛盾。

最终架构刻意把状态分成两类：

| 类别 | 存放位置 | 内容 |
| --- | --- | --- |
| **存储状态**（StoredSceneStatus） | 存档 | 玩家**做过的事**：`locked / arrived / challenging / completed`、到达时间、尝试次数、已发奖励 |
| **派生状态**（SceneStatus） | 运行时计算 | 玩家**现在能做什么**：`available` 由「前置场景是否全部 completed」实时推出 |

- `lib/game/state.ts` 中的 `resolveSceneStatus(sceneId, state, availableSet)` 是唯一的合成点：存储状态 + 实时可达性 → 展示状态。
- `reconcileState()` 在读档时执行清理：如果内容包变了导致某场景不再可达，存档里的 `completed` 会被合规地回收，背包里失效的奖励会同步剔除——**存档可以被篡改，但会被驯服**。
- 规则：**永远不要往存档里写「派生值」**。想判断能不能做什么，现场算。

## 4. GPS 层设计（lib/location）

### geodesy.ts —— 数学，纯函数

- Haversine 大圆距离（球体近似，WGS84 平均半径 6,371,008.8m），支持海拔修正项。
- `isWithinRadius()` 不要求距离为零：进入判定 = `distance ≤ radius`，可选精度余量（accuracy slack），且**余量被钳制在基础半径的 50% 以内**——1500m 的 GPS 精度不应该让远处的场景误触发。
- `classifyFix()` 把原始 fix 分类为 good/degraded/poor/stale，UI 据此决定是信任还是提示。

### provider.ts —— 唯一触碰系统 API 的文件

- `getCurrentPosition()` 带一次宽松重试（TIMEOUT / INVALID_FIX 时降级约束重试）。
- `watchPosition()` 返回 `{ stop() }` 句柄；忽略时间戳倒退的 fix；`PERMISSION_DENIED` 时自动停表。
- 错误统一封装为 `GeoError`，带面向玩家的中文文案，UI 不需要理解错误码。

### simulator.ts —— DEV 专用，双重保险

- `isSimulatorAvailable()` 要求 **构建期非 production** 或 **显式 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1`**。生产构建默认惰性——这是安全设计，不是 bug。
- 端到端验收跑 `next start`（即 production），因此 `tests/e2e/run.mjs` 在**构建时**注入该环境变量，走的是模块自带的正式演示环境路径，而非测试后门。
- 模拟器 fix 与真实 fix 走同一条 `injectFix` 通道；模拟器启用时通过 `simulatorActiveRef` 抢占主导权，真实 fix 不会把测试坐标拽回开发者案头。

## 5. 内容包体系（content/ + lib/content + app/content/[file]）

- 内容与代码彻底分离：`content/demo-hunt.json` 是唯一的数据真源，引擎不硬编码任何场景。
- 仓库根目录的 `content/` **不是**静态资源目录，通过 `app/content/[file]/route.ts` 路由处理器分发，理由：内容需要被 Service Worker 按 URL 缓存，同时又要避免复制一份到 `public/` 造成双真源。
- 该路由带路径穿越防护（`^[A-Za-z0-9][A-Za-z0-9._-]*\.json$`），非法 ID 返回 400，端到端测试覆盖。
- `loadGame()`：网络优先 → IndexedDB/localStorage 缓存兜底 → 经 `validateGame()` 校验后入缓存。校验失败的内容包不会被采纳。

## 6. 离线架构（PWA）

`public/sw.js` 为手写 Service Worker，按请求类别采用不同策略：

| 请求 | 策略 | 缓存桶 |
| --- | --- | --- |
| 页面导航 | network-first（4s 超时）→ 缓存 → 根壳兜底 → 内联离线页 | `mos-shell-v1` |
| 内容包 `/content/*` | network-first（5s 超时）→ 缓存 | `mos-content-v1` |
| 地图瓦片 | stale-while-revalidate（上限 400 张） | `mos-tiles-v1` |
| 同源静态资源 | cache-first（不可变 chunk） | `mos-assets-v1` |

设计依据：**GPS ≠ 网络**。玩家在无信号区域走动时，定位照常、判定照常、进度照存——所有游戏状态都在本地，网络只影响瓦片与内容包的「新鲜度」。

验收时的一个重要发现：Chrome 的 `setOfflineMode` 在**网络栈底层**断网（loopback 也不例外），请求根本到不了 Service Worker，因此离线测试不能只做「断网后还能不能打开」，而应验证三件事：SW 已注册并接管、外壳与内容包确实进了缓存、缓存响应是可用 HTML。这套验证在 `tests/e2e/run-e2e.mjs` §G。

## 7. 扩展接口（为 V0.2+ 预留）

### AR（lib/ar/）

`ARProvider` 接口 + `NullARProvider` 空实现。Null 实现永远报告「不可用」，任何 UI 代码都必须在 provider 报告可用时才渲染 AR 入口。V0.1 不写任何 AR 逻辑——但引擎对「一个场景可以有 AR 内容」的 schema 位已经留出。

### AI（schema 层）

场景数据模型预留 `story / briefing / hint / npc / dialogue` 与包级 `aiProfile`。**AI 永远不决定游戏规则**：解锁、判定、奖励全部由确定性引擎执行；AI 的未来角色限于生成/变体化这些叙述性字段。`aiProfile.canon` 数组用于约束未来生成的一致性。

### 后端/多人/账户

所有玩家状态经 `lib/storage` 的统一接口出入。把该接口替换为服务端 API 时，`lib/game` 的 reducer 不需要任何改动——这是把「确定性引擎」与「状态存取」分离的直接收益。

## 8. 测试金字塔

| 层 | 位置 | 数量 | 运行 |
| --- | --- | --- | --- |
| 单元（数学/归一化/reducer） | `tests/location` `tests/game` | 80 | `npm test` |
| 端到端验收（真实浏览器闭环） | `tests/e2e/run-e2e.mjs` | 40 | `node tests/e2e/run.mjs` |

E2E 的三条纪律：

1. **断言引用 `COPY` 常量**（应用里真实存在的文案），不凭印象写字符串——曾因断言不存在的按钮文案产生大面积假失败。
2. **测试自己实现 Haversine**，不复用被测代码的数学——否则数学错了两边一起错。
3. **服务器生命周期由 runner 持有**（`tests/e2e/run.mjs`），后台 `next start` 在 Windows 上不能可靠地活得比 shell 久。

## 9. 已知取舍

- **地图层是命令式代码**：放弃 react-leaflet 换许可证洁净（详见 LICENSE-ANALYSIS.md），代价是 `game-map.tsx` 里的图层 diff 需要人肉维护。约 60 行额外的同步代码，换回全 OSI 依赖树，值得。
- **Haversine 而非 Vincenty**：50–100m 量级的触发半径下，球体近似误差（<0.5%）远小于 GPS 本身的误差（5–30m）。不上椭球模型。
- **localStorage 优先、IndexedDB 兜底**：存档很小（KB 级），localStorage 同步读取更简单；只有内容包（可能几十 KB+）走 IndexedDB。
- **触发圈不画「路线」**：spec 要求的「方向」用玩家→目标的虚线表达，而不是路径规划——后者需要路网数据，超出 V0.1 范围。
