# 本机直传分享链接故障定位报告（第二阶段·只读诊断·收口版）

- 时间：2026-10-25 晚（GMT+8）；代码基线：生产部署提交 `79cd0e7`（本地 HEAD `60f0bb1`，仅差 docs）
- 性质：只读诊断。本轮除按验收程序创建 1 个专用测试包（`local-direct-diag-pr7mtm`，Blob 清理待批准）外，未改任何代码、数据或部署。
- 前序报告：`docs/recovery/2026-10-25-local-share-link-diagnosis.md`（第一阶段，覆盖 `#hunt=` 自包含路径）。

## 0. 结论先行

**「本机直传」按钮生成的链接走的是自包含 `#hunt=` 路径，与服务器发布接口完全无关；该路径的服务端链路（☁️ 云发布 `#cloud=`）经本轮生产受控复现全流程验证为完全正常。** 因此"链接不可用"的故障点在接收端浏览器能力或转发过程，而非服务端。证据强度：高（生产实测 + 代码逐行核验 + 编解码往返实测）。

## 1. 关键定性事实（代码核验）

| 事项 | 结果 |
|---|---|
| 「🔗 生成分享链接（本机直传）」按钮（`app/design/page.tsx:1387`） | 绑定 `share()`（423-462）→ `createGameShareUrl`（`lib/content/share.ts:48-55`）→ **不经过任何服务器接口**，产出 `{origin}/select#hunt=g.<gzip+base64url>` |
| 「☁️ 发布到线上」按钮（1390） | `publishOnline()`（471-501）→ `POST /api/publish` → `createPublishedGameUrl` → 短链接 `#cloud=<gameId>.<versionId>` |
| 设计器生成的游戏 ID 格式 | `nextBlankGameId`（`app/design/design-game.ts:23-30`）产出 `my-hunt-<base36>`，**不含点号**；`readCloudPayload` 的 `lastIndexOf(".")` 切分对真实 ID 无歧义风险（`share.ts:83-88`，且切分后仍过 `isValidGameId/isValidVersionId` 双重校验） |
| 发布响应字段与设计器消费 | `route.ts:89-94` 返回 `{gameId, versionId, created, playPath}`，与 `page.tsx:489` 的用法逐字段吻合 |
| 静默降级 | 无。`/select` 接收失败时全部经 `shareBroken` 显示具体原因（`select/page.tsx:42/134-137`） |

## 2. 生产环境受控复现（本轮实测，2026-10-25）

用设计器形状的专用包（真实多边形区域 + GPS 坐标 + 选择题挑战，ID `local-direct-diag-pr7mtm`）对生产域名完整走一遍"发布→链接→按 ID 读取"：

| 步骤 | 结果 |
|---|---|
| 1. `POST /api/publish` | **201**，返回 `versionId=983c01735b40410c`、`playPath=/select#cloud=local-direct-diag-pr7mtm.983c01735b40410c` |
| 2. 链接正确性 | `playPath` 与设计器 `createPublishedGameUrl` 生成式逐字符一致 |
| 3. t=0 立即按 ID 读取 `/api/games/<id>?v=<vid>` | **200（794ms）**，包体完整（scenes=1） |
| 4. +5s / +20s 复读 | 均 200（本轮未复现此前的跨区复制延迟窗口；该窗口仍是已知非阻断风险） |
| 5. 已知正常对照包 `release-accept-20261025-y9mpnx` | 显式版本读取 200；`?v=latest` 返回 400 —— 属预期：版本参数正则只接受 16 位 hex，分享链接永远携带显式 versionId，不受影响 |
| 6. `/select` 页面（链接落点） | 200 |

**结论：云端发布→短链接→接收读取整条链路在生产上健康。** 若负责人实际使用的是「☁️ 发布到线上」产物而仍不可用，则唯一剩余可能是链接转发/复制环节丢失 `#` 后内容（短链接仅 80 余字符，概率低），需提供失效链接全文确认。

## 3. 根因判断（按概率排序）

1. **H1（最可能，证据强）**：接收端浏览器缺少 `DecompressionStream`（旧版微信 X5/XWeb 内核、受限 webview）。本机直传的 `#hunt=g.` 载荷必须解压，命中 `share.ts:172-177` → 显示"当前浏览器不支持解压分享数据…"。判据：接收方屏幕出现该文字。
2. **H2**：长链接（实测 891–1655 字符）经微信/短信转发被截断或丢失 `#` 片段 → "数据不完整/无法读取"提示。判据：提示含"不完整/截断"。
3. **H3**：生成阶段即报错（GPS 占位 0,0、`save()` 失败等被 `ensureShareable` 拦截），用户误以为生成了坏链接。判据：按钮下方"暂不能发布，请先设置…"。
4. **H4**：发送页 origin 非生产域名（本地/LAN 地址内嵌进链接）。

要在 H1–H4 中锁定唯一根因，仍需负责人提供任一判据：接收方屏幕完整提示文字 / 失效链接全文 / 收发双方设备与打开方式。

## 4. 最小修复方案建议（本轮未实施）

1. **零代码引导**：优先使用「☁️ 发布到线上」短链接（已生产实测全通，不依赖接收端解压、不受转发截断影响）。
2. **代码层最小修改**（待根因确认后实施）：
   - 接收端解压失败文案中直接给出"改用云端版本"操作引导；
   - 生成端对 gzip 后 >1.5KB 的包提示改用云发布；
   - 可选：内置 ~10KB 纯 JS inflate 兜底，彻底消除 DecompressionStream 依赖。
3. 需配套回归测试：`readSharedGameOutcome` 各 broken 分支快照、无 DecompressionStream 环境的降级路径、`#cloud=` 链接 E2E。

## 5. 遗留事项

- 测试包 `local-direct-diag-pr7mtm`（Blob 存储）待批准后清理。
- 两个已知非阻断生产缺陷（发布后跨区读瞬时 404、伪造 Content-Length 挂起连接）与本故障无关，另行排期。
- 待负责人提供判据信息以最终锁定 H1–H4。
