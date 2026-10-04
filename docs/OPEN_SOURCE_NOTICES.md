# 开源声明（OPEN SOURCE NOTICES）

MOS Scene Hunt V0.1 使用了以下第三方开源组件。本文件按照规范 §3 的要求，如实记录每个组件的名称、版本、许可证与来源，供下游使用者与合规审查参考。

最后核验日期：2026-10-04（核验方式：读取 `node_modules/<pkg>/package.json` 的 `license` 字段并与许可证原文比对）。

## 一、运行时依赖（会进入产品分发包）

| 组件 | 版本 | 许可证 | 来源 | 用途 |
| --- | --- | --- | --- | --- |
| [next](https://github.com/vercel/next.js) | 15.1.6 | MIT | npm | 全栈框架（App Router、构建、SSR） |
| [react](https://github.com/facebook/react) | 19.3.0 | MIT | npm | UI 运行时 |
| [react-dom](https://github.com/facebook/react) | 19.3.0 | MIT | npm | React DOM 渲染器 |
| [leaflet](https://github.com/Leaflet/Leaflet) | 1.9.4 | BSD-2-Clause | npm | 地图引擎（本应用通过原生 Leaflet API 使用，不经过 react-leaflet） |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval) | 6.3.0 | Apache-2.0 | npm | IndexedDB 键值存储（内容包离线缓存） |

运行时依赖树的传递依赖由 next 自带（react/react-dom 之外的传递依赖包括 @swc/helpers、busboy、caniuse-lite、postcss 等，均为 MIT / ISC / BSD / Apache-2.0 系许可证）。

### 运行时树中需要特别说明的组件

**sharp（0.33.5，Apache-2.0 AND LGPL-3.0-or-later）**
- 它是 `next` 的**可选依赖**（optionalDependencies），用于 Next.js 的图片优化管线。
- 本应用**未使用** `next/image`，并在 `next.config.ts` 中显式设置 `images.unoptimized: true`，因此 sharp 在运行时**永远不会被加载**。
- 已核实：构建产物 `.next/server` 中不存在任何 `require("sharp")` 引用；sharp 仅由 next 的 image-optimizer 惰性加载，而该管线在本应用中已关闭。
- 结论：sharp 不进入本应用的运行时行为，也不随静态产物分发。若下游部署方在自托管时执行 `npm install --omit=optional`，sharp 与各平台 SWC 编译器二进制会一并缺席，应用功能不受影响（图片优化本来就被禁用）。
- 保留此说明是因为「node_modules 里有它」与「应用用了它」是两回事，合规审查应当基于后者。

## 二、开发依赖（不进入产品分发包）

| 组件 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [typescript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 | 类型系统与编译检查 |
| [vitest](https://github.com/vitest-dev/vitest) | 2.1.9 | MIT | 单元测试运行器 |
| [@vitest/coverage-v8](https://github.com/vitest-dev/vitest) | 2.1.9 | MIT | 覆盖率 |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.7.0 | MIT | Vitest 的 React 转换插件 |
| [jsdom](https://github.com/jsdom/jsdom) | 26.1.0 | MIT | 测试 DOM 环境 |
| [tailwindcss](https://github.com/tailwindlabs/tailwindcss) | 3.4.19 | MIT | 原子化 CSS |
| [autoprefixer](https://github.com/postcss/autoprefixer) | 10.6.1 | MIT | CSS 前缀 |
| [postcss](https://github.com/postcss/postcss) | 8.5.28 | MIT | CSS 处理管线 |
| [esbuild](https://github.com/evanw/esbuild) | 0.24.2 | MIT | 构建加速（Next.js 内部使用） |
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | 23.11.1 | Apache-2.0 | 端到端验收测试（驱动系统 Chrome） |
| @types/leaflet | 1.9.22 | MIT | 类型定义 |
| @types/node | 22.20.5 | MIT | 类型定义 |
| @types/react | 19.3.0 | MIT | 类型定义 |
| @types/react-dom | 19.3.0 | MIT | 类型定义 |
| @testing-library/react | 16.3.3 | MIT | 组件测试工具（预留） |

### 开发依赖中需要特别说明的组件

- **busboy 1.6.0 / streamsearch 1.1.0**：这两个包的 `package.json` 缺少 `license` 字段，导致自动工具报 UNKNOWN。已人工核对其 LICENSE 文件，两者均为 Brian White 的 **MIT** 许可证文本，可按 MIT 对待。
- **caniuse-lite（CC-BY-4.0）**：浏览器兼容性数据集，属事实数据而非代码，按其许可证要求保留署名即可，随 Tailwind/autoprefixer 的构建流程使用。

## 三、地图瓦片与地理数据（非代码，但需署名）

| 资源 | 许可证 | 署名要求 |
| --- | --- | --- |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) 地图数据 | ODbL 1.0 | 界面上已通过 Leaflet attribution 控件展示「© OpenStreetMap contributors」 |
| [CARTO](https://carto.com/attributions) 瓦片服务 | 需遵守 CARTO 使用条款 | attribution 已包含 |
| [HOT tile style](https://www.hotosm.org/)（OSM Humanitarian） | ODbL 1.0（瓦片渲染） | attribution 已包含 |

地图界面的 attribution 控件未被禁用（`attributionControl: true`），切换瓦片源时署名随源自动切换。

## 四、字体与图标

- 应用图标为项目自绘 SVG/PNG，不使用第三方字体或图标库。

## 五、已评估并排除的组件

以下组件曾被评估但**未**进入本项目，原因与许可证相关（详见 [LICENSE-ANALYSIS.md](./LICENSE-ANALYSIS.md)）：

- **react-leaflet / @react-leaflet/core**（Hippocratic-2.1）：曾短暂引入，后为保持运行时依赖全部为 OSI 认可许可证而移除，地图层改为直接调用原生 Leaflet API。
- **vincentchalamon/scavenger-hunt**（CC BY-NC-SA 4.0）：仅作架构参考，未复制任何代码。
- **johnsonfarmsus/dispatch-zero**（AGPL-3.0）：仅作架构参考，未复制任何代码。

## 六、本项目的许可证

MOS Scene Hunt V0.1 以 **MIT** 许可证发布（见项目根目录 LICENSE）。这意味着上述 BSD-2-Clause / MIT / Apache-2.0 组件可以安全地随本项目再分发，并保留各自的版权与许可声明。
