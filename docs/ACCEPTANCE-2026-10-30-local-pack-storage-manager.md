# 本机游戏包存储管理 · 独立验收报告（2026-10-30）

> 任务：对 `feat/local-pack-storage-manager` 分支（`51e0405` + `8629778`）做独立验收：核验代码与 Git 状态、专项审查数据安全、补齐缺失的自动化验证、实证复核 E2E 失败、整理 iPhone 真机验收清单，为合并评审提供证据。
> 状态：**有条件通过**——自动化证据齐备，无已知高风险数据删除问题；**iPhone 真机验证未执行**，单独列为待办。
> 本轮纪律：未推送、未合并、未部署生产；未删除任何用户数据；未做大规模重构。

---

## 1. 核验时间与实际提交

| 项 | 值 |
| --- | --- |
| 核验时间 | 2026-10-30 08:48–09:15（GMT+8），全部检查为本轮实际执行 |
| 仓库 | `D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt` |
| 分支 | `feat/local-pack-storage-manager`（从 `6cd0468` 切出，领先 `origin/master` 2 个提交） |
| HEAD | `8629778` `fix(storage): 配额写满时仍能认出当前游戏，并补充验收报告` |
| 提交链 | `6cd0468`（正式版本）→ `51e0405`（feat）→ `8629778`（fix） |
| 工作区 | **核心代码无未提交修改**；未跟踪文件 3 个（`diag-creator-crash.mjs` / `diag-creator-stress.mjs` / `diag-stale-chunk.mjs`，前一会话遗留诊断脚本，未改动） |
| 本轮新增改动（未提交） | 见第 5 节「本轮修复与新增测试」，共 2 个库文件小修 + 3 个测试文件 + `package.json`/`package-lock.json`（新增 devDependency `fake-indexeddb`） |

## 2. Git 差异和文件范围

`git diff 6cd0468..8629778 --stat`：13 个文件，+2609 / −31。

| 文件 | 变更 | 说明 |
| --- | --- | --- |
| `lib/storage/local-pack.ts` | 新增 429 行 | 盘点 `measureLocalPacks()`、单包删除 `deleteLocalPack()`、容量估算降级、压力文案、清理重复缓存入口 |
| `lib/storage/index.ts` | +78 | 缓存不再无条件镜像到 localStorage（仅 IDB 不可用回退）；新增 `pruneDuplicatedContentCache()`、`removeHuntIndexEntry()` |
| `lib/storage/bytes.ts` | 新增 43 行 | UTF-8 真实字节计量 + `formatBytes()`（纯函数） |
| `lib/content/index.ts` | +144/−? | 重写 `saveAuthoredGameChecked()`：一次序列化 / 循环引用前置拦截 / 体积预警 / 配额分级文案 / 写后读回校验 |
| `lib/content/shared-save.ts` | +5/−1 | 读回比较复用 `serialized`，避免大包二次 stringify |
| `components/local-pack-panel.tsx` | 新增 370 行 | 本机存储面板（含线上状态查询，只读 GET） |
| `app/create/page.tsx` | +41/−? | 本机游戏库列表换用面板；删除入口统一走 `deleteLocalPack`；移除旧 `removeGame` |
| `app/design/page.tsx` | +26 | 挂载面板（默认折叠）；保存成功刷新测量；删除当前包时丢弃内存草稿并 `reloadContent`，防止把已删除的包写回 |
| 测试 ×3 | 新增 | `tests/storage/local-pack.test.ts`（18）、`local-pack-panel.test.tsx`（9）、`tests/content/save-quota.test.ts`（10） |
| E2E 探针 ×1 | 新增 | `tests/e2e/probe-local-storage.mjs`（17 项） |
| 报告 ×1 | 新增 | `docs/STAGE-RECORD-2026-10-29-local-storage-quota.md` |

**调用关系核验**：删除路径 `deleteLocalPack → clearCachedGameContent / clearGameState / removeHuntIndexEntry / clearCurrentAuthoredGameId`，全链不 import `lib/publish`、无任何 `fetch`；面板的线上状态只发 `GET /api/games/<id>`。地图、雷达、导航、试玩、发布接口路径零改动（diff 证实）。

## 3. 数据安全审查结果

逐项按验收指令核对，**未发现高风险数据删除问题**。两处边缘缺陷已在本轮以最小修复 + 测试闭环（见第 5 节）。

### 3.1 通过项

| 审查点 | 结论 | 证据 |
| --- | --- | --- |
| 删除 A 包是否误删 B 包 | 不会。只删 `authoring:<id>`、`content:<id>`、`save:<id>`、save-index 中该行、指针（仅当指向该包） | 代码走读 + 单测「只删除目标包，其他包与它们各自的进度原样保留」 |
| 播放指针复位覆盖异常状态 | 覆盖。指针判断直接读 localStorage（不依赖配额敏感的探测写）；即使指针残留指向已删除的包，`resolveActiveGameId()` 也会回落官方示范包 | 代码走读（`lib/content/index.ts:403`）+ 单测「配额已满时仍能认出当前游戏」 |
| 保存失败时旧版本完整 | 完整。序列化失败在写前拦截；`setItem` 原子，配额错时旧值不动；读回校验只有字节一致才返回 ok | 单测（带字节预算的假 Storage）：「写入被拒绝时保留上一版」「保存失败时原有数据和播放指针均保持不变」 |
| 序列化/写入/回读漏洞 | 循环引用在碰存储前返回；写入后逐字节比对 | 单测「循环引用在写入之前就被拦下」「读回校验」 |
| localStorage 与 IndexedDB 不一致 | 修复后安全，见 5.1-F1 | 新增 6 项 IDB 路径单测 |
| 异常输入（同 ID 覆盖、损坏 JSON、超大素材、循环引用） | 损坏条目仍列出可删（`valid:false`）；超大素材只计 warning 不阻止保存；循环引用安全拦截；同 ID 覆盖是设计行为且有确认流程（与本次无关） | 单测 + 代码走读 |
| 云端请求失败/离线时线上状态 | 正确显示「线上状态未知」：非 200/404/400、网络错误、8 秒超时一律 `unknown`，确认框措辞相应变化，不冒充「未发布」 | 组件测试「网络不可用时显示线上状态未知」+ 探针 |
| 删除不触发网络 | 静态（无 fetch）+ 单测（哨兵 fetch 0 次调用）+ 探针（删除期间非 GET 请求 0 个） | 三重证据 |
| 删除本地副本后云端仍可访问 | 探针：发布→删除本地副本→`GET /api/games/<id>` 仍 200 且版本号不变 | `probe-local-storage.mjs` |

### 3.2 已知残留（低风险，如实记录，不阻塞合并）

1. **删除已发布包会同时回收它的本机进度与离线缓存**（设计行为，确认框已明示）。玩家再玩线上版需重新下载；无网络时该包暂不可玩一次。
2. `clearCachedGameContent` 中 IndexedDB 删除失败会被吞掉（`.catch(() => undefined)`）：极端情况下 IDB 里可能残留孤儿缓存。只占 IDB 配额（充裕侧），不占 localStorage，无数据丢失。
3. `lib/content` 的旧 `deleteAuthoredGame()` 已无调用方（死代码），且其语义不完整（不清进度/缓存）。建议下阶段删除，防止未来误用。
4. 读回校验失败分支理论上返回错误时新值已落盘（`setItem` 原子性使该分支实际不可达），无实际风险。

## 4. 测试命令与真实结果（本轮全部实跑）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元 + 组件测试 | `npx vitest run --no-file-parallelism --pool=forks` | **37 文件 / 443 项 全过**（分支原 432 + 本轮新增 11） |
| 类型检查 | `npx tsc --noEmit` | **0 错误** |
| Lint（改动文件） | `npx eslint <6 个改动文件>` | **0 error / 0 warning** |
| 生产构建 | `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1 npx next build` | **成功**，20 条路由 |
| 本机存储浏览器探针 | `node tests/e2e/run-probe.mjs probe-local-storage.mjs` | **17/17 通过**（含修复后复跑） |
| 既有 E2E 套件（分支） | `node tests/e2e/run.mjs --no-build` | **39/40**，失败 1 项（见第 6 节） |
| 既有 E2E 套件（基线对照） | 正式版本 `6cd0468` 在独立工作区 `scene-hunt-baseline-check` 构建 + 复跑 | **39/40**，失败同一项（见第 6 节） |

环境备注：`next build` 首次被执行沙箱的批量删除保护拦截（清理 `.next` 触发），改为手动清理后重跑成功；与代码无关。

## 5. 本轮修复与新增测试

### 5.1 两个最小修复（均为安全增强，非重构）

**F1 · `lib/storage/index.ts` `pruneDuplicatedContentCache()`（严重程度：低-中，已修复）**
- 问题：清理重复缓存只检查 IndexedDB 键**存在**（`!authoritative → continue`），不校验副本结构。若 IDB 值损坏但为 truthy，镜像（可能是唯一可读的离线副本）会被删掉——正对验收项「能证明 IndexedDB 中存在**有效**副本后才删除镜像」。
- 修复：删除镜像前额外要求 IDB 值为对象且含 `game` 字段（与 `readCachedGameContent` 的可读标准一致）。缺 game 字段视为"无效副本"，镜像保留。
- 证据：新单测「IndexedDB 副本损坏（缺 game 字段）时，镜像被保留」「IndexedDB 读取抛错时镜像被保留」。

**F2 · `lib/storage/local-pack.ts` `deleteLocalPack()` 指针复位（严重程度：低，已修复）**
- 问题：`clearCurrentAuthoredGameId()` 走防御适配器（先探测写）。配额绝对写满时探测失败 → 只清内存映射，**真实 localStorage 里的指针残留**并指向已删除的包。`8629778` 修了"读"（直接读指针判断 isCurrent），未修"删"。实际影响被两个因素压低：删除先释放包字节，探测通常随之成功；即使残留，`resolveActiveGameId` 也会安全回落示范包——但"删除后指针应清掉"这一契约在配额满时会被破坏。
- 修复：`wasCurrent` 时先直接 `removeItem` 指针键（removeItem 不占配额），再调 `clearCurrentAuthoredGameId()` 通知监听者并清内存镜像。
- 证据：新单测「配额写满时删除当前包，真实播放指针仍被清掉」。

### 5.2 新增/修改测试清单（11 个新用例）

| 文件 | 新增用例 | 对应验收项 |
| --- | --- | --- |
| `tests/storage/content-cache.test.ts`（新增 6 项，用 fake-indexeddb 走真实 IDB 路径） | IDB 可用时缓存不镜像；有有效副本才删镜像；无副本保留镜像；损坏副本保留镜像；IDB 抛错保留镜像；删缓存清两侧 | IndexedDB 一致性、缓存清理安全 |
| `tests/storage/content-cache-fallback.test.ts`（新增 3 项） | IDB 不可用回退写 localStorage 且可读回；清理为严格 no-op；删缓存只清目标键 | IndexedDB 不可用回退 |
| `tests/content/save-quota.test.ts`（+1） | 保存失败时原有数据与播放指针均不变 | 保存失败场景 |
| `tests/storage/local-pack.test.ts`（+1） | 配额写满时删除当前包仍清掉真实指针 | 指针复位异常覆盖 |

已有测试已充分覆盖的项目（删除隔离、非当前包指针保持、无网络请求、云端未知状态、估算降级、读回校验等）未重复编写。

## 6. E2E 失败分类（本轮实证，非引用旧结论）

| 失败项 | 本轮分支复跑 | 本轮基线 `6cd0468` 复跑 | 分类 |
| --- | --- | --- | --- |
| 地图页显示雷达任务卡或已进入提示 | ✗ 失败（页面渲染正常、无 JS 错误，仅该断言不满足） | ✗ **失败（同一项）** | **既有基线失败**。与本次改动无关的实证：① 基线同样失败（本轮独立构建复现）；② 本次 diff 不含 `/map` 路由任何依赖（改动只在 `/create`、`/design` 与 lib/storage、lib/content 保存路径）；③ 失败现场无异常请求 |
| 无 404 资源请求 | ✓ 通过 | ✓ 通过 | 上轮失败为**外部地图瓦片**（`tile.openstreetmap.fr`）网络抖动，本轮网络稳定即通过，维持「外部依赖失败」分类 |

复现步骤：`node tests/e2e/run.mjs`（分支）/ 在 `scene-hunt-baseline-check` 工作区同命令（基线）。报告与截图：`tests/e2e/artifacts/e2e-summary.json`（两个工作区各一份，`ranAt` 分别为 2026-10-30T01:02:37Z 与 01:08:07Z）。

## 7. iPhone 真机验收清单（待执行，不得以桌面结果冒充）

**前置声明：桌面 Chrome 无法真实写满配额（其额度按磁盘计算，10 GB 量级），上轮与本轮的"配额不足"均为错误路径模拟。以下必须在真机 Safari 完成。**

记录模板：每项填写 设备型号 / iOS 版本 / Safari 版本 / 实际结果 / 截图（建议存入 `docs/` 或按团队惯例归档）。

| # | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 打开创作库（/create），展开「本机存储」明细 | 列出真实包数与各自大小、总占用；与设置→Safari→高级→网站数据中的本站数据量级不矛盾；无包时显示空态而非报错 |
| 2 | 导入一个带照片的游戏包并保存 | 保存成功；面板立即显示该包字节数与内嵌素材占比；>1.5 MB 时出现体积提醒但不阻止保存 |
| 3 | 制造保存失败（连续导入大图包直到写满） | 提示含「本机存储已满」、本次包大小、「上一版没有被改动」（确有旧版时）；旧包仍可打开；页面不崩溃 |
| 4 | 删除一个**未发布**的本地包 | 确认框写明包名与「尚未发布到线上」；删除后仅该包及其进度/缓存消失；其他包、播放中的游戏不受影响 |
| 5 | 删除一个**已发布**包的本地副本 | 确认框写明「线上不受影响」；删除后「打开线上版本」链接仍可打开游戏（需网络）；版本号不变 |
| 6 | 开启飞行模式（或断网）后查看明细 | 每包显示「线上状态未知」，而非「线上未发布」；确认框措辞为「无法确认是否已发布」；此时删除仍只作用于本机 |
| 7 | 删除当前正在玩的包 → 退出页面 → 重新进入 | 提示「已切回官方示范内容」；重开后为官方示范包或上次指针；无白屏、无报错；其他包进度仍在 |
| 8 | 全程观察 Safari | 无卡死、无崩溃、无内存告警杀页；杀页重开后包数据仍在（若被系统清理，面板的「非持久」提示语应与现象一致） |
| 9 | 无痕窗口补充检查 | 面板显示「浏览器不允许本机存储」；保存给出「隐私模式」提示而非崩溃；关闭无痕窗口后正式窗口数据无变化 |

## 8. 合并建议

**有条件通过。** 条件与依据：

1. ✅ Git 差异清晰（13 文件，范围严格限定在本机存储/保存提示/两个页面的挂载点）；工作区状态明确（除 3 个遗留未跟踪诊断脚本与本轮报告外无未提交核心改动）。
2. ✅ 无已知高风险数据删除问题；两处边缘缺陷已修复并有测试钉住。
3. ✅ 删除隔离、指针复位、保存失败、缓存回退/清理安全均有本轮实跑的测试证据（443 项单测 + 17 项浏览器探针）。
4. ✅ E2E 失败 1 项已实证为既有基线失败（基线与本分支同项失败），另 1 项上轮失败本轮通过（外部瓦片）。
5. ⏳ **待办**：iPhone 真机验收（第 7 节）未执行——这是"配额"问题的最终场景，合并前或合并后发布前必须补做。
6. ✅ 全程未推送、未合并、未部署生产、未删除任何数据。

## 9. 下一阶段建议

1. **真机走查**（约 15 分钟）：按第 7 节清单在 iPhone Safari 执行并留档；重点 #3（真实写满）与 #6（离线未知态）。
2. **提交本轮改动**：`lib/storage/index.ts`、`lib/storage/local-pack.ts` 两处修复 + 3 个测试文件 + `fake-indexeddb` devDependency，建议以 `fix(storage): 缓存清理只认有效副本；配额满时指针真删` 单独提交（本轮未提交，留待确认）。
3. **下下轮小清理**：移除死代码 `deleteAuthoredGame()`；考虑把外部地图瓦片从 E2E「无 404」判定中排除（既有测试缺口）；修复「地图雷达任务卡」这条基线失败（独立于本任务）。
4. **保留物**：基线对照工作区 `scene-hunt-baseline-check` 已切到 `6cd0468`（原 459de0e），如无他用可删除；`tests/e2e/artifacts/e2e-summary.json` 被本轮复跑覆盖（原文件此前已备份，见上轮报告 §1）。
