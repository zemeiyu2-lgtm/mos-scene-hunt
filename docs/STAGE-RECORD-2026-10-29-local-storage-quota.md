# 本机游戏包存储治理 · 验收报告（2026-10-29）

> 任务：iPhone Safari 中创作中心已有 4 个本地游戏包，新游戏包保存时提示「浏览器没有空间」。
> 目标：先查清机制与根因，再提供本地包占用查看、安全的「删除本地副本」与可执行的失败提示，且不触碰任何线上游戏。
> 状态：代码与测试完成，**未部署正式环境**；iPhone 真机验证未执行（见第 6 节）。

---

## 1. 基线信息

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt`（`zemeiyu2-lgtm/mos-scene-hunt`） |
| 开工时所在分支 | `diag/creator-error-capture` @ `945a9c8`（旧线，基于 `1d78a75`，**不是**当前正式版本） |
| 对照的正式版本 | `origin/master` @ `6cd0468`（部署记录中的生产版本 https://mos-scene-hunt.vercel.app；本次未重新做线上指纹核验） |
| 开工前工作区 | 1 个已跟踪文件被改：`tests/e2e/artifacts/e2e-summary.json`（仅 `ranAt` 与耗时差异，已备份到 `D:\WorkBuddyData\WorkBuddy\2026-10-29-21-17-20-backup\e2e-summary.json.bak-*`）；3 个未跟踪诊断脚本（`diag-creator-crash.mjs` / `diag-creator-stress.mjs` / `diag-stale-chunk.mjs`，上一次会话遗留，未改动、未提交） |
| 本次工作分支 | `feat/local-pack-storage-manager`，从 `6cd0468` 切出 |
| 分支提交 | `51e0405` `feat(storage): 本机游戏包存储盘点、只删本机副本与配额提示` |
| 基线自检 | `npx vitest run` → 32 文件 / 397 项全过；`npx tsc --noEmit` → 0 错误 |

开工前先 `git fetch`，确认远端 `master` 已推进到 `6cd0468`；本地 `945a9c8` 属被重写前的旧线，因此**没有**在旧线上改，而是从正式版本重新拉分支，避免把旧线差异带进交付。

---

## 2. 检查发现

### 2.1 真实存储机制（全部为代码事实，非推测）

**一个游戏包 = 一条 localStorage 记录。**

| 环节 | 代码位置 | 事实 |
| --- | --- | --- |
| 键名 | `lib/content/index.ts:24` | `AUTHORING_PREFIX = "mos-scene-hunt:authoring:"`，`authoringKey(id)` = `${PREFIX}${id}` |
| 写入 | `lib/content/index.ts:102` `saveAuthoredGameChecked()` | 先 `validateGame`，再 `localStorage.setItem(authoringKey(game.id), JSON.stringify(game))` —— **整包一次性写入单条记录** |
| 读取 | `lib/content/index.ts:265` `listAuthoredGames()` → `:347` `readAuthoredGame()` | 遍历 `localStorage` 键、按前缀过滤、`JSON.parse` + `validateGame` |
| 列表 UI | `app/create/page.tsx`（创作库）、`app/design/page.tsx`（创作中心） | 两处共用同一份存储 |
| 删除（改前） | `lib/content/index.ts:304` `deleteAuthoredGame()` | 只 `removeItem` 包键 + 清播放指针；**不清**进度、**不清**离线缓存 |

**图片与文件去了哪里**：`components/media-gallery.tsx:92`–`99` 用 `FileReader.readAsDataURL()` 把图片 / PDF / Word / PPT 读成 base64 `data:` URL，存进 `game.scenes[].media[].url`。因为整包就是一个 JSON，这些 base64 **随包一起写进那一条 localStorage 记录**，没有独立的资源存储。

**同一个 origin 上的其他键**（共享同一预算）：

- `mos-scene-hunt:content:<id>` —— 网络包的离线缓存（`lib/storage/index.ts:30`）
- `mos-scene-hunt:save:<id>` —— 单车进度（`lib/storage/index.ts:22`）
- `mos-scene-hunt:current-authored-game` —— 播放指针（`:37`）
- `mos-scene-hunt:save-index`、`mos-scene-hunt:settings`、`mos-scene-hunt:cloud-catalog`

**重复存储（改前确实存在）**：`cacheGameContent()`（`lib/storage/index.ts:353`，改前版本）把每个网络加载过的包**同时**写进 IndexedDB 的 `mos-scene-hunt/content` store 和 localStorage 的同名键。同一份内容被计费两次，而 localStorage 才是稀缺的那一侧。作者包本身只有一份（`loadGame` 从本地命中时走 `source: "local"`，不再写缓存）。

**本地 ID 与线上 ID 的关系**：共用。发布时 `app/api/publish/route.ts` 用 `game.id` 作为 `gameId`，版本号由内容哈希 `deriveVersionId(game)` 得出；线上数据在 `lib/publish/*` 的存储里。本地键空间是 `mos-scene-hunt:authoring:<id>`，与线上命名空间无关。**整条删除路径不 import `lib/publish`，也没有任何 fetch**（见第 4 节）。

### 2.2 保存失败的根因

**结论：浏览器给这个 origin 的 localStorage 预算被耗尽，写入被拒绝。** 证据分级如下。

- **直接机制（代码 + 运行时证据）**：写入是单条 `localStorage.setItem`。Safari 配额不足时抛 `DOMException: The quota has been exceeded.`（`name === "QuotaExceededError"`）；改前的 catch 用 `/quota/i` 判定后回落到固定文案「浏览器本机存储已满，请删除不再需要的游戏后重试」。这解释了用户看到的「没有空间」。
- **放大因素 1：base64 内联（主因）**。一张 3 MB 手机照片 base64 后约 **4.0 MB**（4/3 膨胀），加上 JSON 结构，单个包就逼近 Safari 固定的小预算；4 个包里有 2 张照片就必然写不进去。本次受控复现：一张 150 KB 的图片让包从 542 B 涨到 **150,671 B，其中 150,023 B（99.6%）是 data URL**。
- **放大因素 2：离线缓存双写**。每个网络加载过的包在 localStorage 里多一份完整 JSON（见 2.1），与作者包抢同一预算。
- **已排除**：IndexedDB 写入失败（作者包不走 IDB）；校验错误（`validateGame` 在写入前执行，失败根本到不了写入）；存储被完全禁用（会走另一条「无法写入浏览器本机存储」文案）。
- **改前未覆盖**：循环引用/无法序列化的数据只在 `setItem` 内部 `JSON.stringify` 时抛出 `TypeError`，落进通用文案，用户看不到真实原因。本次已在写入前单独拦截。
- **未验证**：用户 iPhone 上的实际每包字节数（无法远程读取）。因此本报告**不**断言「你那 4 个包一共 X MB」，只给出机制与放大因素；准确数值由面板在真机当场测量。

### 2.3 占用测量

**应用能测的（确定值，直接读存储内容）**：每包 UTF-8 字节（`TextEncoder`，不是 `String.length` 的 UTF-16 计数）、合计、内嵌素材字节与占比。

**浏览器能测的（估算值）**：`navigator.storage.estimate()` → `usage` / `quota`，`navigator.storage.persisted()`。API 不可用时面板明确写「当前浏览器没有提供容量估算接口」，不显示任何数字。

**本次受控实测（真实 Chrome，本机生产构建，同一套字节算法）**：

| 包 | 字节 | 其中内嵌素材 |
| --- | --- | --- |
| `probe-ls-a`（纯文本） | 542 B | 0 |
| `probe-ls-b`（纯文本） | 542 B | 0 |
| `probe-ls-d`（纯文本） | 542 B | 0 |
| `probe-ls-c`（含 1 张内联图） | 150,671 B | 150,023 B |
| **合计** | **152,297 B ≈ 148.7 KB** | 150,023 B |

同时刻该 origin 的浏览器自报值：`usage = 87,013,572 B ≈ 83.0 MB`，`quota = 10,824,431,812 B ≈ 10.08 GB`，`persisted = false`。

**这组数字说明了什么、不能说明什么**：

- 能说明：字节计算链路正确；单张图片就能让一个包膨胀两个数量级。
- **不能**说明 iPhone 的可用空间。桌面 Chrome 的 quota 是按磁盘算的（10 GB 量级），所以**在 Chrome 里无法真的把配额写满**。本次「配额不足」是在真实浏览器里替换 `Storage.prototype.setItem` 抛出的 `QuotaExceededError` 来复现的**错误路径**，不是真的写满 —— 报告按此口径标注，不冒充真机配额。
- Safari 对 localStorage 采用固定的、很小的 per-origin 预算（公开实践中普遍观察到的量级是 5 MB，且不因网站请求而提高）。本应用**没有**把这个量级写进任何文案或代码，也不承诺「还能存 N 个」。

---

## 3. 已实施修改

### 3.1 改动清单

| 文件 | 类型 | 变更 |
| --- | --- | --- |
| `lib/storage/bytes.ts` | 新增 | `utf8ByteLength()`（UTF-8 真实字节，含代理对处理）、`formatBytes()`（B/KB/MB，MB 保留两位小数——4.98 与 5.00 的差别正是「存得下/存不下」的差别） |
| `lib/storage/local-pack.ts` | 新增 | `measureLocalPacks()` 逐包盘点、`deleteLocalPack()` 只删本机、`estimateBrowserStorage()` 估算降级、`describeStoragePressure()` 文案（纯函数，可单测）、`reclaimDuplicatedCache()` |
| `lib/storage/index.ts` | 修改 | `cacheGameContent()` 不再无条件镜像到 localStorage（仅 IDB 不可用时回退）；新增 `pruneDuplicatedContentCache()`、`removeHuntIndexEntry()` |
| `lib/content/index.ts` | 修改 | 重写 `saveAuthoredGameChecked()`：一次序列化 / 循环引用前置拦截 / 体积预警 / 配额分级文案 / 写后读回校验 / 返回 `bytes` 与 `serialized`；`importGamePackageChecked()` 复用已序列化内容，去掉第二次 stringify |
| `lib/content/shared-save.ts` | 修改 | 读回比较复用 `serialized`，不再重复序列化大包 |
| `components/local-pack-panel.tsx` | 新增 | 本机存储面板（数量 / 总占用 / 单包大小 / 内嵌素材占比 / 浏览器额度估算 / 线上状态 / 删除本地副本 / 清理重复缓存） |
| `app/design/page.tsx` | 修改 | 挂载面板（默认折叠，只显示摘要行）；保存失败横幅指向面板；每次保存成功刷新测量 |
| `app/create/page.tsx` | 修改 | 本机游戏库列表换成同一面板，保留「使用 / 改名」，删除改名为「删除本地副本」 |

**没有改**：地图、任务、背包、试玩、发布接口、线上存储、云端目录、视觉系统、其他页面。

### 3.2 删除机制（作用范围）

`deleteLocalPack(gameId)` 只做以下事，任何一步失败都会保留数据并回报原因：

| 目标 | 键 | 说明 |
| --- | --- | --- |
| 游戏包本体 | `mos-scene-hunt:authoring:<id>` | 主要占用，先 `removeItem` 再回读确认「真的没了」 |
| 它的离线缓存 | `mos-scene-hunt:content:<id>` + IndexedDB 同名键 | `clearCachedGameContent()` |
| 它的本机进度 | `mos-scene-hunt:save:<id>`、`save-index` 中对应行 | 否则空间没真正释放，且进度永远不可达 |
| 播放指针 | `mos-scene-hunt:current-authored-game` | **仅当**它正指向这个包时才清，播放回落到官方示范 |

删除前确认框逐条列出：包名、占用大小、「只删这台设备当前浏览器里的副本（含本机试玩进度）」、「其他本地游戏包不受影响」、「线上版本/分享链接/二维码不受影响」，并说明重新获得该游戏的**已有**途径（重新导入你导出的游戏包；若该游戏也在「云端游戏库」目录里，可在那里重新下载）。

### 3.3 容量提示

- 摘要行常驻：`本地游戏包：4 个，占用约 X MB。`（无包时说明为空）
- 额度行仅在 API 可靠时出现：`浏览器额度（估算） 已用 / 额度` + 进度条 + 一句「这是浏览器按本站 origin 计算的估算值，不是手机的可用磁盘空间」
- API 不可用：仍显示包数与实测占用，并写明「当前浏览器没有提供容量估算接口，无法显示系统级剩余空间」
- `persisted()` 可用时补充一句：未被标记为持久 → 长期不打开可能被系统清理，建议保留导出包
- 空间 >=75% 提示「偏紧」，>=90% 提示「下一次保存很可能失败，请先删除不再需要的本地副本」
- 没有「最多 4 个」这类固定上限，也没有把估算值换算成「还能存几个」

### 3.4 保存流程优化

写入顺序改为：**校验 → 一次序列化 → 写入 → 回读比对 → 才更新播放指针**。

- 序列化失败（循环引用）在**碰存储之前**就返回，说明真实原因。
- `localStorage.setItem` 是原子的：配额不足抛错，旧值原样保留。测试用带字节预算的假 Storage 证明这一点（不是靠「总会抛错」的 mock）。
- 写后回读：只有读回的字节与写入的字节完全一致才返回 `ok`，「键存在」不算保存成功。
- 体积预警（非阻塞）：单包 > 1.5 MB 时提示「这份约 X MB，其中约 Y MB 是内嵌图片/文件（占 Z%），这部分最容易压缩」。**1.5 MB 是提醒阈值，不是限制**，不阻止保存。
- 配额失败文案含：这一份多大、为什么被拒、下一步（删本地副本 / 减小内嵌素材）、是否可能无痕浏览、以及「本机上的上一版没有被改动」（仅在确实存在上一版时出现）。
- 离线缓存改为单份：IndexedDB 可用时不再镜像到 localStorage；历史遗留的镜像由面板「清理重复的离线缓存」按需回收，**仅当 IndexedDB 里确实有对应副本时**才删除镜像。

### 3.5 数据迁移

**没有做存储迁移**（localStorage → IndexedDB 这类改动没有必要，且风险高于收益）。旧数据原样可读：键名、格式、`validateGame` 契约都没变。因此不存在「迁移失败回滚」这条路径，也不存在静默清空。

---

## 4. 安全证明：本地删除不会影响线上

**调用链**

```
组件 LocalPackPanel.remove()
  → lib/storage/local-pack.ts deleteLocalPack()
      → window.localStorage.removeItem(authoringKey(id))     // 本地键
      → clearCachedGameContent(id)  → idbDel(...) + removeItem // 本地缓存
      → clearGameState(id)                                    // 本地进度
      → removeHuntIndexEntry(id)                              // 本地索引行
      → clearCurrentAuthoredGameId()                          // 仅当指向该包
```

**四重证据**

1. **静态**：`grep -rn "fetch(" lib/` 只有 3 处 —— `lib/cloud/index.ts:47`（目录）、`lib/content/index.ts:323`（`/content` 包）、`lib/content/share.ts:127`（`/api/games` 只读）。删除路径不经过任何一处；`lib/storage/*` 里没有任何 `fetch`。
2. **单元**：`tests/storage/local-pack.test.ts`「删除不触发任何网络请求」用哨兵替换 `globalThis.fetch`，断言调用 0 次。
3. **真实浏览器**：验收探针在删除期间记录全部请求 —— 非 GET 请求 **0 个**，`/api/` 调用只有 `GET /api/games/<id>`（只读状态查询）。
4. **端到端（线上未被影响）**：先 `POST /api/publish` 发布 `probe-ls-pub` → 面板显示「线上已发布」→ 点「删除本地副本」→ `GET /api/games/probe-ls-pub` 仍 **200**，`X-Game-Version` 与删除前一致；`/select#cloud=<id>.<version>` 仍 **200**。

**ID 共用的处理**：本地与线上共用 `game.id`，但本地记录在 `mos-scene-hunt:authoring:<id>`，删除只 `removeItem` 这一个键；线上数据在服务端存储（`lib/publish`），能力上不可达。

---

## 5. 测试结果

### 5.1 自动化

| 测试 | 命令 | 结果 |
| --- | --- | --- |
| 单元 + 组件测试 | `npx vitest run` | **432 项 / 35 文件 全过**（基线 397 / 32，新增 35 项） |
| 类型检查 | `npx tsc --noEmit` | **0 错误** |
| Lint | `npx eslint .` | 本次改动文件 **0 error**；`lib/content/index.ts` 与 `lib/content/shared-save.ts` 各 1 条既有 `unused import` warning（`origin/master` 上同样存在，未顺手改）；仓库存量 1 条 error 在 `tests/content/visual-tokens.test.ts`（`require()` 风格导入，基线即存在，与本任务无关） |
| 生产构建 | `npx next build` | **成功**，20 条路由 |
| 浏览器验收（新增） | `node tests/e2e/run-probe.mjs probe-local-storage.mjs` | **17/17 通过** |
| 既有端到端套件 | `node tests/e2e/run.mjs` | 38–39 / 40，见 5.3 |

### 5.2 新增测试与逐项对账（对应第三阶段 10 条）

| # | 验收项 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | 现有本地包仍可读取、未丢失 | 单元：`saveAuthoredGameChecked` 写入后 `measureLocalPacks` 能列出同一 ID；探针：4 个种子包全部列出、删除后其余逐字节不变 | 通过 |
| 2 | 数量与大小统计合理 | 单元：单包字节 == `utf8ByteLength(存的内容)`，合计 == 各项之和；探针：实测 542 B / 150,671 B | 通过 |
| 3 | 删除后从本地列表消失 | 单元 + 探针（列表变 3 个、可删除项计数 3） | 通过 |
| 4 | 重新打开后删除仍有效 | 探针：重新加载 `/create` 仍是 3 个 | 通过 |
| 5 | 删除不影响线上访问与发布状态 | 探针：`/api/games` 200 + 版本号不变 + `/select#cloud=` 200 | 通过 |
| 6 | 新包能正常保存并读回 | 单元 `tests/content/save-quota.test.ts`「保存成功」；探针重复保存步骤 | 通过 |
| 7 | 配额不足有清晰提示、旧版可用 | 单元（带字节预算的假 Storage）+ 探针（真实 Chrome 模拟 `QuotaExceededError`，提示含大小/原因/下一步，旧字节不变） | 通过（配额为模拟，见 2.3） |
| 8 | 估算 API 不可用不报错、不显示假容量 | 单元：`storage` 缺失时 `supported=false`、文案不含 MB 数字；组件测试：不出现「浏览器额度（估算）」 | 通过 |
| 9 | 重复保存不累积副本 | 单元：保存 5 次仍只有 1 个键；探针：设计器保存 2 次仍是 1 个键 | 通过 |
| 10 | 其他核心流程无回归 | 探针：`/games` 本机游戏正常；端到端套件见 5.3；`/design` 保存/发布路径未改动 | 通过 |

新增用例明细：`tests/storage/local-pack.test.ts`（17）、`tests/storage/local-pack-panel.test.tsx`（9）、`tests/content/save-quota.test.ts`（9）、`tests/e2e/probe-local-storage.mjs`（17 项浏览器检查）。

### 5.3 既有端到端套件（40 项）的运行记录与归因

| 运行 | 代码 | 结果 | 失败项 |
| --- | --- | --- | --- |
| 基线 ①（`6cd0468` 干净树） | 正式版本 | 39/40 | 「地图页显示雷达任务卡或已进入提示」 |
| 本分支 ① | `51e0405` 内容 | 38/40 | 同上 + 「无 404 资源请求」 |
| 本分支 ② | 同上 | 39/40 | 「无 404 资源请求」 |
| 基线 ②（`--no-build`） | 正式版本 | 套件崩溃 | §B 导航 30 s 超时（环境不稳） |

**归因（有诊断证据）**：另写诊断访问套件覆盖的全部路由（`/`、`/map`、`/quest`、`/bag`、`/select`、`/create`、`/design`、`/games`），记录所有 `>=400` 响应与失败请求，结果是——

```
FAILED net::ERR_ABORTED https://c.tile.openstreetmap.fr/hot/13/6849/3758.png
FAILED net::ERR_FAILED  https://a.tile.openstreetmap.fr/hot/13/6849/3759.png
...
=== console errors ===
Failed to load resource: net::ERR_FAILED
```

**同源请求 0 个 4xx**，失败全部来自外部地图瓦片 `tile.openstreetmap.fr`。而那条检查的判定是「控制台里出现 `404` 或 `Failed to load resource`」，所以外部瓦片任何一个失败都会让它挂。该检查与本任务的代码路径无关：本机存储面板挂在 `/create` 与 `/design`，而套件根本不会访问这两个路由。

结论：这两项失败为**既有 / 环境性**，没有证据表明由本次改动引入；同时也不能据此宣称「40/40 通过」——需在网络稳定的环境下复跑确认。

---

## 6. 剩余问题与风险

1. **iPhone Safari 真机未验证（最重要）**。本报告不含任何真机证据。以下需要在真机上确认，不能以桌面 Chrome 代替：
   - 4 个真实包在面板上的实际字节数与合计；
   - `navigator.storage.estimate()` 是否可用（Safari 各版本支持不一致），不可用时是否只显示包数与实测占用；
   - 真机写满时的错误名与文案是否命中（`QuotaExceededError`）；
   - 无痕浏览下是否给出「浏览器限制」提示而非崩溃；
   - 删除后刷新/重开 Safari，列表与占用是否同步；
   - 关闭标签页后重开，包是否仍在（以及是否被系统清理）。
2. **容量指标本质是估算**。浏览器给的 `usage/quota` 不等于手机剩余磁盘，也不保证不变化；面板已如实标注，但用户仍可能误读为「手机空间」。若真机 `estimate()` 不可用，就完全没有系统级容量可显示，只能显示实测包体积。
3. **既有端到端套件的两项失败**（5.3）：一项在基线即失败，一项受外部地图瓦片影响。建议在网络稳定时复跑，并考虑把外部瓦片请求从「无 404」判定里排除（属既有测试缺口，本次未改）。
4. **1.5 MB 的「偏大」提醒阈值是经验值**，不是浏览器限制，也不阻止保存。若真机显示阈值偏松/偏紧，应按实测调整。
5. **「重新下载」只对云端目录内的游戏成立**。`/api/publish` 发布的自有链接与 `/games` 的静态目录（`content/cloud/catalog.json`）目前不互通 —— 这是既有架构问题，本次未改，因此确认框只承诺「重新导入你导出的游戏包」，并在目录命中时才提「云端游戏库重新下载」。
6. **没有做 localStorage → IndexedDB 迁移**。作者包仍受 localStorage 预算约束；本次只是让用户看得见、删得掉、失败时知道原因。若后续要根治，迁移方案需要单独的备份 + 回滚验证。
7. **历史双份缓存**需用户点一次「清理重复的离线缓存」才回收；不自动删除（避免在用户不知情时动数据）。

---

## 7. 发布建议

- **预览**：可以直接验收。本次已在本地生产构建（`next build` + `next start`）上跑完 17 项浏览器检查与 432 项自动化测试。如需线上预览，请授权后部署到**独立 preview 环境**（Vercel Preview 分支部署），不要动生产。
- **正式发布**：**建议先做一次 iPhone 真机走查再发布**。走查清单就是第 6 节第 1 条的六项，约 10 分钟：打开创作中心 → 看「本机存储」的包数与占用 → 展开明细确认 4 个包的大小与线上状态 → 删除一个副本 → 刷新确认 → 试玩另一个包。
- **未做**：没有部署正式环境，没有删除/下架任何线上游戏，没有改动线上 Blob 数据，没有改发布接口，没有顺手恢复已撤下的游戏。
- **回滚**：分支独立于 `origin/master`（`6cd0468`），未推送远端；不合并即不影响生产。若已合并，回滚只需 revert `51e0405` —— 无数据迁移，无存储格式变更，回滚不丢包。

---

### 附：如何看到真实数值

创作中心（`/design`）→ 页面底部「📦 本机存储」→ 摘要行是包数与总占用 → 点「明细」展开每包大小、内嵌素材占比、线上状态与「删除本地副本」。
创作库（`/create`）默认展开同一份明细。
