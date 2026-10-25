# 本机直传分享链接故障定位报告（只读诊断）

- 时间：2026-10-25 21:31–21:45（GMT+8）；代码基线：生产部署提交 `79cd0e7`（本地工作区 HEAD `6cd0468`，两者仅差 docs）
- 性质：只读定位，未改代码、未部署、未写数据。

## 1. "本机直传"的真实代码路径（已核实）

入口按钮：`app/design/page.tsx:1387`「🔗 生成分享链接（本机直传）」→ `share()`（`app/design/page.tsx:423-462`）→ `ensureShareable()`（同文件 411-421，先校验 GPS 区域并 `save()` 到本机库）→ **`createGameShareUrl(game)`**（`lib/content/share.ts:48-55`）：

- 序列化：`JSON.stringify(game)` → 浏览器端 `CompressionStream("gzip")` 压缩 → base64url → **`{origin}/select#hunt=g.<payload>`**（若浏览器无 CompressionStream 则降级为未压缩 `j.` 前缀）。
- 接收端：`/select` 页 → `readSharedGameOutcome()`（`lib/content/share.ts:155-190`）→ base64url 解码 → `DecompressionStream` 解压 → `validateGame` 校验 → 载入；失败时**显示具体原因**（`app/select/page.tsx:42/134-137` 的 `shareBroken` UI），**不会静默回退演示游戏**。
- 与云发布路径的区别：`publishOnline()`（`app/design/page.tsx:471-501`）→ `POST /api/publish` → 返回短链接 `#cloud=<gameId>.<versionId>`（仅携带两个 ID，无载荷）。
- 生产部署 bundle 已实测包含同一套 `hunt=`/`cloud=` 解码逻辑（chunk `2y4ng0bhki8s-.js`，此前核验）。

## 2. 已用实测排除的原因

| 排除项 | 证据 |
|---|---|
| 编解码不对称/损坏 | 以 HEAD 源码逻辑逐字节复刻，gzip→b64url→解码→解压→JSON 往返 **全部 OK**（3/8/15/30 站点规模） |
| 链接必然超长 | 实测 3–30 站点真实规模包：URL 仅 891–1655 字符（gzip 后 632–1205B）；QR 组件有完整容量规划与密度门控（`lib/content/qr.ts`、`components/game-qr.tsx`），超限时显示可读原因而非坏码 |
| 生产端无解码逻辑 | 部署 bundle 含 `hunt=`/`cloud=` 逻辑（已核验）；`/select` 200 |
| 静默回退演示游戏 | 接收端失败路径全部带明确 `shareBroken` 原因文案，代码注释明确废弃了静默回退 |

## 3. 按证据排序的根因假设（未排除项）

**H1（最可能）——接收方浏览器缺少 `DecompressionStream`**：发送端（较新的 iOS/安卓浏览器）生成 `g.` gzip 载荷；接收端若为旧版微信 X5/XWeb 内核或受限 webview，无 `DecompressionStream` → 命中 `share.ts:176-181`，页面显示"当前浏览器不支持解压分享数据。请用手机 Safari（iOS）或更新微信/浏览器后重新打开"。用户感知即"链接不可用"。**特征判据：接收方屏幕出现该提示文字。**

**H2——链接经转发被截断**：900–1700 字符的 URL 在微信/短信中作为文本转发时可能被截断或丢失 `#` 后内容 → 命中"数据不完整/无法读取"提示。**特征判据：提示含"不完整"或"截断"。**

**H3——生成阶段即失败**（用户以为是"生成了坏链接"）：`ensureShareable` 要求真实 GPS 坐标（拒绝 0,0 占位）且 `save()` 成功，否则按钮报错；另 `navigator.share` 在微信 webview 内不可用属正常回退。**特征判据：按钮下方出现"暂不能发布，请先设置…"或"生成分享链接失败"。**

**H4——发送页面不在生产域名**：若通过本地/LAN 地址（如 `http://192.168.x.x:3102`）打开设计页，链接将内嵌该 origin，接收方无法访问。生产域名测试则排除此项。

## 4. 修复方案建议（本轮未实施）

1. **产品层（推荐，零代码）**：引导用户优先使用「☁️ 发布到线上」——短链接不依赖接收端解压能力、不受转发截断影响、已通过生产验收。
2. **代码层最小修复（后续阶段实施）**：
   - 接收端解压失败时提供"改用云端版本"引导或自动探测 `#cloud=` 孪生链接；
   - 生成端在压缩前检测包体，超过阈值（如 gzip 后 >1.5KB）时提示改用云发布（本机直传对大包体验差）；
   - 可选：内置纯 JS inflate 兜底（增加 ~10KB bundle），彻底消除 DecompressionStream 依赖。
3. 两个已知生产缺陷（Blob 写后跨区读延迟、伪造 Content-Length 挂起）与本故障无关，另行跟进。

## 5. 需要负责人提供的判据信息

要在 H1–H4 中锁定唯一根因，需要任一项：
- 接收方打开链接时**屏幕显示的完整提示文字**；
- 失效链接的**全文**（含 `#hunt=` 后内容，注意勿泄露隐私）；
- 收发双方的**设备与打开方式**（微信内打开 / 系统浏览器 / 型号）。

持有以上任一项即可在现有代码路径中精确定位；当前证据已排除编解码与生产部署本身的问题。
