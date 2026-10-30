# 02 · AUTO-DEMO 与 GPS 模拟器依赖审查

- 核查时间：2026-10-30 14:07–14:12 GMT+8 ｜ 对象：`a79e058` 全仓只读搜索 + 代码通读
- 方法：`grep -rn` 全仓（app/lib/components/tests）+ 关键文件通读；组合环境行为验证见 03 号文档

## 1. 三个符号的全部定义与读取位置（实搜结果）

### `NEXT_PUBLIC_ENABLE_AUTO_DEMO`
| 位置 | 角色 |
| --- | --- |
| `lib/demo/autopilot.ts:77-86 isDemoSupported()` | **唯一运行时读取点**：为 `"1"` 时返回 true |
| `lib/runtime/mode.ts:89 resolveRuntimeMode()` | 消费 `isDemoSupported()`：demo 模式判定前置条件 |
| `components/demo-autopilot.tsx:72 available = isDemoSupported()` | 演示驱动组件总开关 |
| `app/select/page.tsx:117 demoAvailable = isDemoSupported()` | 演示入口按钮显示条件 |
| `tests/location/simulator-gate.test.ts` | 门控单测 |

### `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`
| 位置 | 角色 |
| --- | --- |
| `lib/location/simulator.ts:19-24 isSimulatorAvailable()` | **唯一运行时读取点**：dev 构建 或 显式 `"1"` |
| `components/gps-provider.tsx` | 面板可用性 + settings 驱动模拟通道的前置条件 |
| `app/map/page.tsx:563` | `SimulatorPanel` 渲染条件 |
| `tests/e2e/run.mjs:44` 等 | E2E 构建参数（仅测试） |

### `injectFix`
| 位置 | 角色 |
| --- | --- |
| `components/gps-provider.tsx:90` | 定义：直接 `setFix`（无任何 env/权限检查） |
| `components/demo-autopilot.tsx:208` | **演示专用调用点**：注入 `simulateFix(...)` 产出的演示坐标 |
| `components/gps-provider.tsx:206` | settings 驱动模拟通道调用点（受 `simulatorAvailable` + 非 demo 模式双重门控） |

## 2. 实际调用关系（与指令假设结构的对照）

```
AUTO_DEMO ──► isDemoSupported() ──► resolveRuntimeMode() = "demo"
                                    ├─► /select 演示入口按钮显示
                                    └─► DemoAutopilot 启动
Demo Runtime（demo-autopilot）──► simulateFix()  ← 纯函数，无任何门控（simulator.ts:107）
                              ──► injectFix()    ← gps-provider 专用通道（无门控）
                              ──► 演示存档写 sessionStorage demo: 命名空间

GPS_SIMULATOR ──► isSimulatorAvailable() ──► DEV GPS Provider（SimulatorPanel 渲染 + settings 驱动通道）
                                           └─ demo 模式下该通道被 demoMode ref 显式禁用
```

与指令给出的结构**一致**，并补充两点实测细节：
1. `simulateFix` 是纯坐标封装函数，本身不查任何开关——门控在「谁能调用它」一层（demo 组件由 AUTO_DEMO 门控；DEV 面板由 GPS_SIMULATOR 门控）。
2. `demo-autopilot.tsx` 的导入清单中**没有** `isSimulatorAvailable`——演示不依赖 DEV 模拟器。

## 3. 行为矩阵（门控单测 + 组合构建实测双重支撑）

| 变量组合 | 真人 GPS | 自动演示 | DEV 模拟器 |
| --- | --- | --- | --- |
| 两者都不存在 | 正常 | 关闭（`?demo=1` 回落 player） | 关闭 |
| 仅 AUTO_DEMO=1 | 正常 | **开启** | **关闭**（14:13 组合构建实测：无面板、篡改无效） |
| 仅 GPS_SIMULATOR=1 | 正常 | 关闭（除非 dev 构建） | 开启 |
| 两者均 =1 | 正常 | 开启 | 开启（dev 构建策略内） |

## 4. 逐项验收

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 自动演示不依赖 DEV GPS Simulator | ✅ | demo-autopilot 无该导入；组合构建（无 SIMULATOR）演示完整跑通（03 号文档） |
| 普通玩家无法经 URL 开启 DEV 模拟器 | ✅ 代码层 | `isSimulatorAvailable` 无 URL 路径；组合构建实测 4 种参数均无效 |
| 普通玩家无法经 localStorage 开启 DEV 模拟器 | ✅ 代码层 | settings 篡改受 `simulatorAvailable` 前置门控；组合构建实测无效。⚠️ 当前生产因 env=1 而开放（环境问题） |
| 关闭 AUTO_DEMO 不影响真人进入游戏 | ✅ | `resolveRuntimeMode` 无 demo 能力时回落 player，走正常玩家路径（门控单测 + 路由 200） |
| 开启 AUTO_DEMO 不赋予玩家修改定位来源的能力 | ✅ | AUTO_DEMO 只放行演示 session 的自注入；玩家模式无注入入口；「模拟定位中·非真实位置」徽标明示来源 |

## 5. `NEXT_PUBLIC_` 构建期注入说明

`NEXT_PUBLIC_*` 变量在 **`next build` 时内联进客户端 bundle**。删除 Vercel 上的环境变量**不会改变已构建的生产 JS**；必须以新变量组合重新构建并部署，新配置才生效。因此「移除旧变量 + 部署新候选」是同一个不可拆分的操作序列。
