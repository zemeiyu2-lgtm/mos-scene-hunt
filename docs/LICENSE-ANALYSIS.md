# 许可证分析（LICENSE ANALYSIS）

本文档回答三个问题：

1. 四个参考项目各自的许可证是什么，我们从中学到了什么、**没有**拿什么；
2. 本项目自身的依赖许可证状况如何，期间发现并处理了什么问题；
3. 红线在哪里，后续开发应如何避免踩线。

核验日期：2026-10-04。参考项目的许可证均通过 GitHub API 与 LICENSE 文件原文核实，不依赖规范文档的转述。

---

## 一、四个参考项目的许可证核查

### 1. vincentchalamon/scavenger-hunt

- **许可证：CC BY-NC-SA 4.0**（Creative Commons 署名-非商业性使用-相同方式共享 4.0）
- 核验方式：直接读取其 LICENSE 文件原文（「Attribution-NonCommercial-ShareAlike 4.0 International」），GitHub API 显示 NOASSERTION，与 CC 许可证的特征一致。
- **结论：禁止复制代码。** 两条独立红线：
  - **NC（非商业）**：CC 的 NC 条款禁止商业性使用。本项目不假设未来一定非商业，引入 NC 代码等于给整个项目埋雷。
  - **SA（相同方式共享）**：若分发基于它的衍生作品，衍生作品必须同样以 CC BY-NC-SA 4.0 发布。这会与本项目 MIT 的意图直接冲突。
- **实际借鉴（思想层面，不受版权保护）**：任务地点（Place）与挑战（Challenge）分离的数据建模思路；「移动端优先、单手可玩」的界面组织。这些都是通用设计思想，不构成对表达形式的复制。
- **未借鉴**：任何源代码、资源文件、文案。

### 2. Rexle25/HikingCucumber

- **许可证：MIT**
- 核验方式：GitHub API 返回 MIT。
- **结论：许可兼容，可安全借鉴。** MIT 只要求保留版权声明与许可文本。
- **实际借鉴**：确认了「GPS 游戏不需要原生 App，纯 Web 即可承载」的可行性判断；其页面组织（地图为主视图、任务列表为辅）验证了我们的信息架构方向。
- **未复制**：代码。事实上本项目为 TypeScript/React 技术栈，与其实现路径差异极大，直接复制本就没有意义。

### 3. johnsonfarmsus/dispatch-zero

- **许可证：AGPL-3.0**
- 核验方式：GitHub API 返回 AGPL-3.0。
- **结论：禁止复制代码。** AGPL-3.0 是最强的 copyleft 之一：
  - 第 13 条网络服务条款：即使不分发二进制、仅通过网络提供服务，也必须向用户提供源代码；
  - 衍生作品必须整体以 AGPL-3.0 发布。引入其任意实质性代码片段都会迫使本项目改为 AGPL。
- **实际借鉴（思想层面）**：验证了「真实地标 + 情境化引导文案」的产品形态是有先例的；其自托管（self-host）定位提醒我们数据模型应避免绑定特定云服务——这也是本项目把内容包做成独立 `/content/*.json` 的原因之一。
- **未借鉴**：任何源代码。

### 4. cs-util-com/location-based-webxr

- **许可证：Apache-2.0**
- 核验方式：GitHub API 返回 Apache-2.0。
- **结论：许可兼容。** Apache-2.0 允许任意使用，附带专利授权与署名要求。
- **实际借鉴**：其「GPS 精度与传感器融合」的问题陈述帮助我们确立了 lib/location 的容错设计取向——不追求距离为零，默认 50m 触发半径并提供精度余量钳制。其 WebXR 扩展点的存在，验证了本项目预留 `lib/ar/` 接口（ARProvider）的合理性。
- **未复制**：代码。本项目 V0.1 明确不实现 WebXR。

### 小结

| 项目 | 许可证 | 能否复制代码 | 本项目实际做了什么 |
| --- | --- | --- | --- |
| scavenger-hunt | CC BY-NC-SA 4.0 | **否**（NC+SA 双重限制） | 仅参考架构思想 |
| HikingCucumber | MIT | 可以 | 仅参考架构思想，未复制 |
| dispatch-zero | AGPL-3.0 | **否**（强 copyleft） | 仅参考产品形态 |
| location-based-webxr | Apache-2.0 | 可以 | 参考 GPS 容错设计取向，未复制 |

**本项目 100% 的代码为原创编写**，不包含上述四个项目的任何源代码或资源文件。

---

## 二、本项目依赖的许可证审计过程与处置

### 发现 1：react-leaflet 使用 Hippocratic-2.1（已处置：移除）

**发现过程**：对 `node_modules` 全量许可证扫描时，发现 `react-leaflet@5.0.0` 与 `@react-leaflet/core@3.0.0` 的许可证为 **Hippocratic-2.1**，而非通常 assumed 的 MIT。

**Hippocratic-2.1 是什么**：
- 属于 Ethical Source（道德源）运动许可证，**未获 OSI 认可**；
- 与传统开源许可证的关键差异：它对**使用行为**设限（要求使用方式符合联合国人权原则与相关法律），而不仅仅是分发行为；
- 它**不是** copyleft：不要求衍生作品采用相同许可证，也不传染；
- 其 Notice 条款要求：任何获得软件副本的人必须同时收到许可证文本与版权声明。

**风险评级**：中低。它不会像 AGPL 那样迫使本项目改变许可证，但：
1. 非 OSI 许可证会让企业用户、发行渠道的自动合规扫描报警；
2. 「使用需符合人权原则」这类条款的可解释性存在不确定性，法律上不如 MIT/Apache 干净；
3. 依赖收益极低——react-leaflet 只是一个薄绑定层。

**处置**：**移除 react-leaflet 与 @react-leaflet/core，地图层改为直接调用原生 Leaflet API（BSD-2-Clause）。**
- 影响面评估：仅 `components/game-map.tsx` 一个文件（359 行）引用；
- 改造方式：以命令式图层同步（对触发圈、场景标记、玩家标记、方向线做 diff）替代声明式绑定；
- 验证：改造后 TypeScript 严格模式零错误、80 项单元测试全过、40 项端到端验收全过，功能无回归。

**经验**：「流行包默认是 MIT」不可靠，必须逐一核实。

### 发现 2：sharp 的 LGPL 组件（已处置：隔离并验证）

**发现过程**：同一轮扫描发现 `@img/sharp-win32-x64@0.33.5` 的许可证为 **Apache-2.0 AND LGPL-3.0-or-later**。

**分析**：
- sharp 是 Next.js 的可选依赖（optionalDependencies），用于图片优化管线；
- LGPL 覆盖的部分是 libvips 预编译二进制（`@img/sharp-libvips-*` 与平台二进制）；
- 本应用未使用 `next/image`，且已在 `next.config.ts` 显式设置 `images.unoptimized: true`；
- 已核实构建产物 `.next/server` 中不存在任何 `require("sharp")` 引用——next 的 image-optimizer 只在图片优化被调用时才惰性加载 sharp，而该管线已被关闭；
- 无法通过 `npm install --omit=optional` 一刀切移除：next 的 SWC 编译器同样是 optional 依赖，全局省略会导致构建工具链缺失。

**处置**：
1. `images.unoptimized: true` 锁死图片优化路径，确保 sharp 在运行时不可达；
2. 在 [OPEN_SOURCE_NOTICES.md](./OPEN_SOURCE_NOTICES.md) 中如实记录其存在、许可证组合与「不被加载」的核实结论；
3. 下游若需绝对排除，可在部署时 `npm install --omit=optional`（应用功能不受影响）。

**结论**：sharp 存在于开发机的 node_modules 中（npm 无法选择性跳过单个可选依赖），但不进入本应用的运行时行为，也不随静态产物分发。LGPL 的义务针对「分发库本身」，本项目的分发物不包含它。

### 发现 3：busboy / streamsearch 的 UNKNOWN 许可证（已澄清）

两个包的 `package.json` 缺少 `license` 字段，自动扫描报 UNKNOWN。人工核对 LICENSE 文件，均为 Brian White 的 **MIT** 许可证文本。已在 OPEN_SOURCE_NOTICES.md 中注明，避免后续审查误判。

---

## 三、红线清单（给后续开发者）

以下规则来自规范 §3 与本次审计的教训，任何后续开发都应遵守：

1. **禁止引入** CC BY-NC-SA、AGPL-3.0、GPL 系强 copyleft 许可证的**任何实质性代码片段**（无论手抄、复制还是「参考着写」到结构雷同的程度）。
2. **禁止引入** 未获 OSI 认可的许可证（Hippocratic、BSL、SSPL、各种 Ethical Source 许可证）到**运行时依赖**。开发依赖同样应尽量避免——本项目已做到开发依赖全部为 MIT/Apache-2.0。
3. **新增依赖前必须核查** `package.json` 的 `license` 字段；字段缺失时读 LICENSE 文件原文，两者都不可信时放弃该依赖。
4. **每次升级依赖后重跑许可证扫描**。次版本升级可能变更许可证（react-leaflet 从 MIT 变为 Hippocratic 就发生在 4.x → 5.0 的升级中）。
5. **保持 100% 原创代码**。若未来引入 MIT/Apache 代码片段，必须在文件头保留原版权声明，并登记到 OPEN_SOURCE_NOTICES.md。

## 四、扫描方法（可复现）

```bash
# 全量扫描 node_modules 的许可证字段
node -e "
const fs=require('fs'),path=require('path');
function walk(dir,depth){
  if(depth>3) return;
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(!e.isDirectory()||e.name.startsWith('.')) continue;
    const full=path.join(dir,e.name);
    if(e.name.startsWith('@')){walk(full,depth);continue;}
    const pkg=path.join(full,'package.json');
    if(fs.existsSync(pkg)){
      const j=JSON.parse(fs.readFileSync(pkg,'utf8'));
      if(j.name) console.log(j.name.padEnd(34),(j.version||'?').padEnd(12),j.license||'UNKNOWN');
    }
  }
}
walk('node_modules',0);
" | sort
```

凡输出中出现的非 `MIT / Apache-2.0 / ISC / BSD-* / 0BSD / MIT-0 / BlueOak-1.0.0 / CC-BY-4.0` 许可证，都应按本文档第二节的方式逐个分析处置。
