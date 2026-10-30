# 本地存储问题 · 最终修复、提交与正式部署记录（2026-10-30）

> 前置文档：`docs/ACCEPTANCE-2026-10-30-local-pack-storage-manager.md`（独立验收，结论「有条件通过」）。
> 本记录覆盖：最终修复提交、完整测试复跑、Vercel Production 部署与核验、iPhone 真机验收清单。
> 所有结果均为 2026-10-30 09:34–10:00（GMT+8）实际执行所得。

---

## 1. Git 状态与提交

| 项 | 值 |
| --- | --- |
| 仓库 / 分支 | `D:\WorkBuddyData\WorkBuddy\2026-10-04-09-08-00\scene-hunt` / `feat/local-pack-storage-manager` |
| 开工时 HEAD | `8629778`（未提交改动：两处安全修复 + 测试 + fake-indexeddb） |
| **最终 commit** | `7ea65a8` `fix(storage): 缓存清理只认有效 IndexedDB 副本；配额满时真删播放指针`（父提交 `8629778`，9 文件 +488/−4） |
| 附加 commit | `3c6b44c` `chore: 忽略 .vercel 链接产物与 .env*`（父提交 `7ea65a8`；`vercel link` 生成，防止密钥文件误入库） |
| 提交后工作区 | 干净（仅剩 3 个遗留未跟踪诊断脚本 `diag-creator-crash/stress/stale-chunk.mjs`，有意不入库） |
| 未包含 | 诊断脚本 ×3、`tsconfig.json` 工具改写（已还原）、`e2e-summary.json` 测试产物（已还原） |

## 2. 两处安全修复的代码证据

**F1 `lib/storage/index.ts` `pruneDuplicatedContentCache()`**
```ts
const authoritative = await idbGet<{ game?: unknown }>(key, contentStore);
// Only a structurally valid copy proves the mirror is redundant.
if (!authoritative || typeof authoritative !== "object" || !authoritative.game) continue;
```
损坏/缺失的 IndexedDB 副本一律保留 localStorage 镜像，不可能删除唯一有效副本。测试钉住：`tests/storage/content-cache.test.ts`「IndexedDB 副本损坏（缺 game 字段）时，镜像被保留」「IndexedDB 读取抛错时，镜像被保留」。

**F2 `lib/storage/local-pack.ts` `deleteLocalPack()`**
```ts
if (wasCurrent) {
  try { window.localStorage.removeItem(CURRENT_AUTHORED_KEY); } catch { /* ... */ }
  clearCurrentAuthoredGameId();
}
```
配额写满时防御适配器的探测写会失败（只清内存镜像），现在先直接 `removeItem`（不占配额）再通知监听者。测试钉住：`tests/storage/local-pack.test.ts`「配额写满时删除当前包，真实播放指针仍被清掉」。

**其余三项重点**（继承自 `51e0405`/`8629778`，本轮复验）：保存失败旧版本+指针不变（`save-quota.test.ts`「保存失败时，原有数据和播放指针均保持不变」）；删除零网络请求（哨兵 fetch 单测 + 探针「非 GET 请求 0 个」）；离线缓存 IDB 可用时单份、不可用回退 localStorage（`content-cache-fallback.test.ts` 3 项）。

## 3. fake-indexeddb 依赖核验

- `package.json`：`devDependencies["fake-indexeddb"] = "^6.2.6"`；`dependencies` 中不存在 ✓
- `package-lock.json`：根节点 devDependencies 含同名条目，`node_modules/fake-indexeddb` 版本 `6.2.6` 一致 ✓（`npm ls` 通过）

## 4. 完整测试结果（本轮实跑）

| 检查 | 结果 |
| --- | --- |
| 全量 Vitest（37 文件） | **443/443 通过** |
| `tsc --noEmit` | **0 错误** |
| ESLint（6 个改动文件） | **0 error / 0 warning** |
| `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1 next build` | **成功**（20 条路由） |
| 存储探针 `run-probe.mjs probe-local-storage.mjs` | **17/17 通过** |
| 既有 E2E `run.mjs`（分支，ranAt 01:41:18Z） | **39/40** |
| 既有 E2E（基线 `6cd0468` 对照，ranAt 01:08:07Z） | **39/40** |

## 5. E2E 基线失败情况（不掩盖）

- 失败项：**「地图页显示雷达任务卡或已进入提示」**——分支与本轮基线 `6cd0468` **同一项失败**，属既有基线失败，与本分支改动无关（基线无本分支任何代码）。
- 上轮失败的「无 404 资源请求」本轮通过（外部地图瓦片 `tile.openstreetmap.fr` 网络抖动所致）。
- 基线差异总计：**0 项**（两轮失败集合完全相同）。

## 6. 正式部署记录

| 项 | 值 |
| --- | --- |
| 部署目标 | Vercel 项目 `mos-scene-hunt`（账号 `zemeiyu2-1187`），正式 URL https://mos-scene-hunt.vercel.app |
| 部署命令 | `npx vercel deploy --prod --yes`（本地源码上传，`--prod` 直接提升生产） |
| 部署 ID/URL | `mos-scene-hunt-6yc5ia8xd-zemeiyu2-1187.vercel.app`，状态 **Ready**（创建于 2026-10-30 09:47:02 GMT+8） |
| 代码对应 | 部署源 = 工作树 @ `7ea65a8`（提交后仅 `.gitignore` 一行保护性改动与 3 个未构建引用的诊断脚本在树中，均不影响构建产物）。CLI 部署不带 gitCommitSha 元数据，已用**构建产物指纹**核验（见下） |
| 指纹核验 ① | 部署前后 `https://mos-scene-hunt.vercel.app/create` 引用的 JS chunk 哈希集合**发生变化**（生产别名已切到新构建） |
| 指纹核验 ② | 生产 bundle `chunks/3e_0sis7tw_ud.js` 中命中分支新特性字符串 `清理重复的离线缓存`（部署前该字符串在页面与 bundle 中均为 0 次） |

**部署后核验**：`/`、`/design`、`/create`、`/games`、`/select`、`/content/cloud/catalog.json` 全部 **200**；`/api/games/<未发布id>` 返回 404（预期行为）。

**生产数据与环境确认（未动）**：环境变量 `REGISTRY_STORE`、`PUBLISHED_GAMES_STORE`、`BLOB_READ_WRITE_TOKEN` 只读查看后原样保留（`vercel link` 生成的 `.env.local` 已被 `.gitignore` 挡住，未提交、未上传）；无数据库迁移、无 Blob 清理、未发布任何测试游戏包、未改管理员账号。游戏中心与目录正常（200）；已有正式游戏的服务端数据未做任何写操作（部署过程不触碰 Blob 存储）。

## 7. iPhone Safari 真机验收清单（待执行）

**口径声明：桌面浏览器测试 ≠ 模拟配额异常 ≠ 真实 iPhone Safari 配额。第 1–8 项桌面上已有自动化证据，但真机项必须在 iPhone Safari 现场执行，不得互相冒充。**

记录字段（每项）：设备型号 / iOS 版本 / Safari 版本 / 操作步骤 / 预期 / 实际 / 截图编号。

| # | 场景 | 操作 | 预期 |
| --- | --- | --- | --- |
| 1 | 四个现有包读取 | 打开创作库 /create | 「本机游戏库」列出 4 个真实包；打开 https://mos-scene-hunt.vercel.app/create 后数据与桌面端无关（本机各自的） |
| 2 | 占用计量 | 展开「本机存储」明细 | 每包显示字节数、体验点数、内嵌素材占比；总占用=各包之和 |
| 3 | 图片/PDF 素材 | 导入带照片/文件的游戏包并保存 | 保存成功；>1.5 MB 出现体积提醒（不阻止）；重新打开素材可显示 |
| 4 | 保存失败保护 | 连续导入大图直到写满 | 提示含「本机存储已满」+ 本次包大小 +「上一版没有被改动」；旧包逐字节可读；页面不崩溃 |
| 5 | 删除本地副本 | 删除一个本地包 | 确认框写明包名、只删本机、其他包不受影响；删除后仅该包及其进度/缓存消失 |
| 6 | 删除后云端可访问 | 删除一个已发布包的本地副本 | 「线上版本」链接仍可打开（需联网）；`/api/games/<id>` 仍 200、版本不变 |
| 7 | Safari 刷新与重开 | 刷新页面 / 杀掉 Safari 重开 | 包列表与占用一致；进度保留；无白屏无崩溃 |
| 8 | 离线与恢复 | 飞行模式查看明细 → 恢复联网 | 离线时显示「线上状态未知」而非「未发布」；恢复联网后状态刷新为真实值 |
| 9 | 指针与进度完整 | 删除当前正在玩的包 → 重进 | 提示「已切回官方示范内容」；重开后回落示范包；其他包进度完整 |

## 8. 尚未解决的问题

1. **iPhone 真机验收未执行**（本清单第 7 节）——「配额」问题的最终场景，需真机走查后方可宣称问题关闭。
2. 既有基线失败「地图页显示雷达任务卡」仍存在（与本任务无关，需单独排查）。
3. 死代码 `deleteAuthoredGame()` 建议下轮删除；E2E「无 404」判定建议排除外部瓦片。
4. 3 个遗留诊断脚本仍未跟踪（diag-creator-crash/stress/stale-chunk.mjs），需决定保留或删除。
5. 分支尚未合并、尚未推送远端（本轮未获推送/合并授权，仅部署授权）——生产当前运行的是 `7ea65a8` 的内容，而 `origin/master` 仍为 `6cd0468`，合并评审请尽快安排以消除漂移。
