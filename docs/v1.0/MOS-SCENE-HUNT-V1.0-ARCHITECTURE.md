# MOS Scene Hunt V1.0 · 架构说明（ARCHITECTURE）

- 更新：2026-10-30 ｜ 基线：`v1.0/platform-optimization`（3331715 + 本任务提交）
- 性质：描述 V1.0 实际架构与信任边界，不虚构未实现能力。

## 1. 总体结构（Next.js App Router + React 客户端状态中枢）

```
app/                        路由层（map/scene/challenge/reward/select/games/design/create/admin）
components/
  root-providers.tsx        Provider 装配根
  gps-provider.tsx          全 app 唯一 watchPosition 订阅 + 模拟/演示 fix 通道
  hunt-provider.tsx         编排缝：加载包 → 按模式 hydrate → fix 归约 → 按模式持久化
  demo-autopilot.tsx        自动演示驱动 + 演示条 + 结束页（demo 模式专属）
lib/
  runtime/mode.ts           RuntimeMode 解析（player|demo|preview，挂载时一次判定）
  game/state.ts             游戏引擎（纯函数 reducer；到达判定只翻转 arrived↔locked）
  game/arrival*.ts          到达防重载误报
  location/                 Geolocation 封装、模拟器（isSimulatorAvailable 门控）
  storage/index.ts          持久层：player(localStorage)+demo/preview(sessionStorage) 模式路由、
                            多局索引、设置、内容缓存(IndexedDB/镜像回退)
  content/                  包解析（分享链接 → 本机 authoring → 网络 /api/games/<id>）
  registry/store.ts         registry（REGISTRY_STORE=file|blob，状态机保证 published 稳定）
  auth/                     管理后台会话（scrypt + cookie + requireRole）
  demo/autopilot.ts         演示链条/目标/答案纯函数 + isDemoSupported + 速度档
```

## 2. 运行模式与存档隔离（V1.0 核心，D-001/002/004/006）

- `RuntimeMode = "player" | "demo" | "preview"`，在 HuntProvider **挂载时一次判定**（`?demo=1`/`?preview=1` 或 sessionStorage 标记；默认 player）。模式切换=整页导航重挂载。
- 持久化按模式路由：

| 模式 | 后端 | 键 | 写入索引 | 清理 |
| --- | --- | --- | --- | --- |
| player | localStorage | `mos-scene-hunt:save:<gameId>`（格式不变） | 是（save-index） | `clearGameState`（含 legacy 迁移清理） |
| demo | sessionStorage | `mos-scene-hunt:demo:<gameId>` | 否 | 退出/重演示/关标签页 |
| preview | sessionStorage | `mos-scene-hunt:preview:<gameId>` | 否 | 结束预览/关标签页 |

- 结构性保证：demo/preview 模式下 provider 的 hydrate/persist/reset 全部走 `*ForMode` 函数，player 键不在其可达范围内；demo 永不调用重置真人存档的路径。

## 3. GPS 与定位来源（C 模块）

定位来源三类，运行上下文可识别：

1. **真人真实定位**：Geolocation API → gps-provider（唯一订阅）。
2. **自动演示模拟定位**：autopilot 通过 `injectFix()` 专用通道注入（`simulated:true`），仅 demo 模式激活；不经过 `settings.simulatorEnabled`、不渲染 DEV 面板。
3. **开发调试模拟定位**：DEV 面板 + `settings.simulatorEnabled`，仅在 dev 构建或 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1` 构建可用（`isSimulatorAvailable()`）。

门控矩阵（`tests/location/simulator-gate.test.ts` 钉住）：

| 构建 | DEV 面板 | 演示可用 |
| --- | --- | --- |
| dev 构建 | ✓ | ✓ |
| 生产 + `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1` | **✓（运维显式选择）** | ✓ |
| 生产 + `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1` | ✗ | ✓（推荐的生产 kiosk 配置） |
| 生产（无两者） | ✗ | ✗ |

**部署建议（需用户授权执行）**：生产环境应移除 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`（2026-10-30 11:18 被设置，导致生产开放 DEV 模拟面板），改用 `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1`。列入 RELEASE-CANDIDATE 部署前检查清单。

## 4. 信任边界（如实声明，D-011）

- **到达判定与奖励发放均为纯客户端**：fix → reducer → status=completed → 奖励 UI。无服务端进度校验。浏览器 GPS 本身不可防伪造（开发者工具可 mock 定位）；当前防线的真实作用是**防止演示/预览状态污染真人存档**与**生产构建默认不提供伪造工具**，不是反作弊。
- `POST /api/publish` 无鉴权（内容校验 + 256KB 上限 + gameId 409 占用保护）；`GET /api/games/<id>` 公开、仅返回已发布版本、无枚举端点。
- 管理后台有独立邮箱+密码会话体系（`/api/auth/*`、`requireRole`）。
- 未来服务端验证方向（不属本任务）：玩家会话 token + 服务端到达事件流水 + 服务端签发奖励；立项多用户时一并设计。

## 5. 自动演示生命周期（D 模块）

进入（/select 按钮 或 `?demo=1` 深链）→ 整页导航重挂载为 demo 模式 → autopilot 1s tick：startHunt（demo 命名空间）→ 注入目标站模拟 fix → 到达节拍（速度档缩放）→ `?auto=1` 进场景 → 自动作答（走真实 UI 分支）→ 奖励页停留 → 回地图 → 下一站 → 全部完成 → 结束页（站点数/用时/速度，不计成绩）。
控制：暂停/继续、下一站、速度（慢/正常/快，sessionStorage）、重新演示（仅清 demo 命名空间）、退出（清 demo 状态+整页导航回 /games）。
异常恢复：刷新=sessionStorage 存活继续演示；关标签页=自动清理；定位异常时 autopilot 等待目标达成、不写任何真人数据。

## 6. 响应式（E 模块）

手机壳 `.app-shell/.page max-width:480px` 为基线不变；≥768px 放宽至 640px；≥1280px 放宽至 760px 并放大正文（教室/礼堂可读）；演示条大屏放宽至 720px；地图页 ≥1024px 显示全屏切换按钮（Fullscreen API，状态随 fullscreenchange 同步）。

## 7. 发布与数据源（G 模块）

- 游戏中心 `/games` → `/content/cloud/catalog.json`（动态路由）= 仓库内置目录（当前为空数组）+ **registry published 条目**（唯一真实目录来源）。
- 发布流程：`POST /api/publish` 提交待审 → 后台 `works/[gameId]/[action]`（claim/decision/publish/withdraw/unlist/restore/archive）→ registry published → 游戏中心可见。提交新版本不移动 publishedVersionId（状态机保证）。
- 本地存储管理：删除只删本机副本+指针；缓存清理只认有效 IndexedDB 副本（今晨 7ea65a8 修复，测试钉住）。
