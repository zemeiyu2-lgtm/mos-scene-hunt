# MOS Scene Hunt｜阶段二 QA 收尾与发布准备复核

- 复核执行时间：2026-10-29 21:20–21:50（GMT+8）
- 执行范围：只读审查 + 本地/隔离环境测试 + QA 分支内低风险修复 + 操作准备
- 生产侧改动：**无**（未部署、未改变量、未动 Blob、未改账号、未改线上作品）
- 结论：**建议进入下一阶段，但生产发布仍应卡在 P-1（口令轮换）与 P-3（可验证备份）之后**

---

## 1. 执行摘要

本轮把上一轮「测过但没固化成回归」的三处缺口补成了可复跑的测试，并修掉两个在验证过程中暴露出来的真实防御缺陷。

**已完成（实测）**

- 全量测试重跑：单元 **724/724**（53 文件；上一轮为 693/693，本轮新增 31 项）、`tsc --noEmit` **0 错误**、`next build` **成功**（干净构建，无模拟定位开关）。
- 真 HTTP 与浏览器：后台 **59/59**、玩家端 **40/40**、独立发布闭环 **24/24**、备份恢复演练 **24/24**。
- 发布可见性缺口（上一轮列为「建议下一步」的第一项）**已补齐**：新增 17 项路由级测试，直接驱动 `catalog.json` 与 `/api/games/<id>` 两个真实 handler，覆盖「提交 → 审核 → 发布 → 目录可见 → 撤下 → 恢复」。
- 引导管理员调用路径**已核实并钉住**：由 `GET /admin/login` 页面渲染触发，**不由** `POST /api/auth/login` 触发；新增 13 项测试覆盖前置、幂等、并发单飞、不覆盖、不越权提升、不写日志。
- 分支语义**已锁定**：`requires` 是前置门，不是互斥路由；两条路线条件同时满足时两条都可用，已用独立用例固化，**未改引擎**。
- 备份/恢复工具新增「目标目录守卫」，演练从 22 项扩到 24 项。

**修复的真实缺陷（都在产品/工具代码里，非测试妥协）**

| 编号 | 位置 | 问题 | 影响 |
|---|---|---|---|
| D-1 | `lib/cloud/index.ts:packUrl` | registry 条目的 id 校验正则接受 `..` / `.` | 生成 `/api/games/..`，浏览器归一化成 `/api`，取包请求静默打到别的端点 |
| D-2 | `tools/backup/restore.mjs` | 恢复目标只校验「非空」，不校验位置 | 空目录在仓库内时可把生产数据副本恢复进工作树，进而被提交或被打包 |

**未完成（受授权限制）**：P-1 口令轮换、P-2 `.e2e` 清理、P-3 生产 Blob 导出、P-4 Preview 引导变量、P-6 生产部署、P-7 测试包发布。P-5 已就绪未推送。

---

## 2. 基线核验

| 项 | 实测值 | 命令/证据 |
|---|---|---|
| 当前分支 | `qa/phase2-20261029` | `git branch --show-current` |
| HEAD（本轮结束时） | `0df4762` | `git log --oneline -1` |
| HEAD（本轮开始时） | `0ed1e4e` | 与上一轮报告一致 |
| 工作区 | 干净（仅 `.next/` 构建产物，已 gitignore） | `git status --porcelain` |
| 远程 QA 分支 | **不存在** | `git ls-remote origin refs/heads/qa/phase2-20261029` → 空 |
| 生产代码线分支 | `origin/integration/20261029-game-admin` @ `48f55a4` | `git log` |
| 生产代码提交 | `9796b6a`（`48f55a4` 仅在其上追加 1 份文档，`git diff --stat 9796b6a..48f55a4` = 1 file / +58） | `git diff --stat` |
| 我的 P1 提交是否已在生产线 | 是（`c156bfb`、`ef71ab2` 均为 `9796b6a` 祖先） | `git merge-base --is-ancestor` |
| 当前生产部署 | `kcc5lwyok`（6h，Ready，Production） | `vercel ls --environment production` |
| 生产回滚点 | `qahmx0jrz`（11h，Ready，Production） | 同上 |
| 生产变量 | `REGISTRY_STORE`(Secret)、`PUBLISHED_GAMES_STORE`(Config)、`BLOB_READ_WRITE_TOKEN`；**无** `BOOTSTRAP_*` 残留 | `vercel env ls production`（只读名称） |
| Preview 变量 | 上述 3 项 + `REGISTRY_BLOB_PREFIX`、`PUBLISHED_GAMES_BLOB_PREFIX`（独立前缀，4h 前建立） | `vercel env ls preview` |
| 生产哨兵哈希 | `bsop-classic-01` = `2b4f3db6a861d992`；`seminary-field-lab` = `8fb4fbefc9c51219` | HTTP GET + SHA-256，与上一轮完全一致 |
| 线上可见作品 | 仍是 2 个（`bsop-classic-01`、`seminary-field-lab`）；6 个作品保持撤下 | 只读 GET |

**与旧报告的差异（以本轮实测为准）**

1. 单元测试从 693 变为 **724**：本轮新增 `tests/cloud/*`（17）、`tests/auth/bootstrap.test.ts`（13）、`tests/game/branches.test.ts`（+1）。
2. 上一轮报告说 `lib/cloud`「只靠注释与一次手工闭环保证」——本轮已补测试，该表述作废。
3. 上一轮报告把 `publish-flow` 记为 21 项；本轮补了 4 项目录断言，实测 **24** 项。
4. 备份演练上一轮记 22 项；本轮加 2 项守卫，实测 **24** 项。
5. `git worktree list` 中存在 2 个 `prunable` 工作树（`scene-hunt-cloud`、`wt-cc81a09`），属历史遗留，本轮未处理（不影响构建与测试）。

---

## 3. 测试证据表

全部为本轮**新运行**，无一条复用旧日志。工作目录均为 `D:/WorkBuddyData/WorkBuddy/2026-10-04-09-08-00/scene-hunt-integration`。

| # | 测试 | 命令 | 总数 | 通过 | 失败 | 退出码 | 证据位置 | 证据类型 |
|---|---|---|---|---|---|---|---|---|
| 1 | 单元/集成（vitest） | `npx vitest run --reporter=dot` | 724 | 724 | 0 | 0 | 终端汇总 `53 passed / 724 passed` | 本轮新运行 |
| 2 | 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` | — | — | 0 | 0 | 无输出即无错误 | 本轮新运行 |
| 3 | 生产构建 | `node node_modules/next/dist/bin/next build` | — | — | 0 | 0 | `.next/BUILD_ID=wl36N-D5DF1md9aySWMrs` | 本轮新运行 |
| 4 | 后台真 HTTP | `node tests/e2e-admin/run.mjs http://127.0.0.1:3220` | 59 | 59 | 0 | 0 | 终端 `=== 结果：59 通过 / 0 失败 ===` | 本轮新运行（隔离 fs 存储 + 种子管理员） |
| 5 | 玩家端浏览器 | `CHROME_PATH=... node tests/e2e/run.mjs` | 40 | 40 | 0 | 0 | `tests/e2e/artifacts/e2e-summary.json` + 截图 | 本轮新运行 |
| 6 | 独立发布闭环 | `BASE_URL=http://127.0.0.1:3222 ... node tools/qa/publish-flow.mjs` | 24 | 24 | 0 | 0 | 终端 PASS 列表 | 本轮新运行 |
| 7 | 备份/恢复演练 | `node tools/backup/drill.mjs` | 24 | 24 | 0 | 0 | 终端 PASS 列表（`PASS=24 / FAIL=0`） | 本轮新运行 |
| 8 | 菲圣测试包 | `npx vitest run tests/content/fisheng-pack.test.ts` | 9 | 9 | 0 | 0 | 含在 #1 内，单独跑亦通过 | 本轮新运行 |
| 9 | 目录可见性 | `npx vitest run tests/cloud` | 17 | 17 | 0 | 0 | 含在 #1 内 | 本轮新运行 |
| 10 | 引导管理员 | `npx vitest run tests/auth/bootstrap.test.ts` | 13 | 13 | 0 | 0 | 含在 #1 内 | 本轮新运行 |

未覆盖（明确说明，不冒充已测）：

- 真实手机 + 户外 GPS 闭环（需设备与实地，环境不可替代）。
- 生产 Blob 端到端导出（需 P-3 授权）。
- 多实例并发写入下的 registry 一致性（单进程测试无法覆盖，需真实并发）。
- 邮件送达/找回密码（平台未实现该能力）。

---

## 4. 实际修复

| 文件 | 修改原因 | 提交 | 回归 |
|---|---|---|---|
| `lib/cloud/index.ts` | `packUrl` 的 registry id 正则 `^[a-zA-Z0-9._-]+$` 接受 `..` 与 `.`，`encodeURIComponent` 不转义点号，产出 `/api/games/..` → 归一化为 `/api`。改用平台权威规则 `GAME_ID_PATTERN`（`/^[a-z0-9][a-z0-9._-]{0,63}$/`），不再重复实现一份近似正则 | `0df4762` | `tests/cloud/catalog-visibility.test.ts`（"rejects an unsafe registry id"） |
| `tools/backup/restore.mjs` | 恢复目标只校验「不存在或为空」，未校验位置。新增 `guardTargetDir`：拒绝仓库内、`public/`、`.next/`、`node_modules/`，并允许 `--repo-root` 覆盖基准 | `0df4762` | `tools/backup/drill.mjs` +2 项（"拒绝恢复到仓库内目录"、"拒绝恢复到 public/"） |
| `tests/game/branches.test.ts` | 增加 `requires` 语义用例：两条支线前置同时满足时**都**可用，前置未满足时**都**锁 | `0df4762` | 该文件 27/27 |
| `tests/cloud/catalog-visibility.test.ts`（新） | 发布可见性无回归保护 | `0df4762` | 15/15 |
| `tests/cloud/catalog-degrade.test.ts`（新） | registry 故障时目录必须降级而非 500 | `0df4762` | 2/2 |
| `tests/auth/bootstrap.test.ts`（新） | 引导路径曾被误述；需要钉住「GET 页面触发、POST 登录不触发」 | `0df4762` | 13/13 |
| `tools/qa/publish-flow.mjs` | 增加目录同步断言（`source=registry`、`packFile=""`、撤下/恢复时目录同步） | `0df4762` | 24/24 |

未改：游戏引擎逻辑、路由契约、UI 文案、生产配置。

---

## 5. 备份与恢复

**工具**：`tools/backup/{export,verify,restore,drill}.mjs`

| 维度 | 实现 | 证据 |
|---|---|---|
| 覆盖对象 | `users/`、`sessions/`、`works/`、`audit/`、`published/` 五类 | 演练 `counts={"users":2,"sessions":1,"works":1,"audit":2,"published":2}` |
| 脱敏 | 默认 `--mode=redacted`：`users/*.json` 的 `passwordHash`/`passwordSalt` → `"REDACTED"` 并打 `_redacted`；`full` 必须显式指定 | "redacted 用户记录不含口令材料" |
| 完整性 | `manifest.json` 记录每个对象的 sha256 + 字节数 | "字节一致"×8 |
| 篡改检出 | 改一个字节即失败并指出对象路径 | "篡改对象被检出" |
| 清单外文件 | 备份目录多出文件即失败 | "清单外文件被检出" |
| 输出位置 | 拒绝仓库内、`public/`、`.next/`、`node_modules/`；拒绝覆盖非空目录 | "拒绝写入 public/（防公开泄漏）" |
| 恢复 | **默认 dry-run**；目标须空；redacted 备份默认拒绝恢复 `users/`（避免造出无法登录的账号），需 `--allow-redacted-users` 才做结构演练 | "恢复预演（不写盘）"、"拒绝用脱敏备份做可登录恢复" |
| 恢复目标 | 新增守卫：即使为空也不许落进仓库/public | "拒绝恢复到仓库内目录"、"拒绝恢复到 public/" |
| 只读源 | fs 仅 `readFile`；Blob 仅 `list` + `get` | 代码审查 `export.mjs:collectBlob` |

**未覆盖**：Blob 真实端到端（需 P-3）；未验证跨账号/跨区域复制；未验证「导出过程中源正在被写入」的一致性（当前实现无快照语义，属已知限制）。

---

## 6. P-1 至 P-7 状态

| 编号 | 事项 | 状态 | 理由 |
|---|---|---|---|
| P-1 | 生产管理员口令轮换 | **条件通过·待授权** | 轮换入口、会话失效机制、失败恢复路径均已核实；未执行（禁止） |
| P-2 | `.e2e` 敏感文件清理 | **条件通过·待授权** | 22 个文件已逐个分类，无自动化依赖；建议**在 P-1 之后**执行 |
| P-3 | 生产 Blob 只读导出与备份核验 | **条件通过·待授权** | 工具与演练就绪；生产读取需项目级 `BLOB_READ_WRITE_TOKEN`（无只读作用域） |
| P-4 | Preview 引导管理员变量 | **条件通过·待授权** | 方案与验证脚本就绪；变量**未**添加 |
| P-5 | 推送 QA 分支 | **就绪·待授权** | 1 个提交、11 文件、敏感扫描通过；**未推送**、未建 PR |
| P-6 | 生产部署与回滚 | **条件通过·待授权** | 干净构建成功、健康检查与回滚点已明确；未部署 |
| P-7 | 测试包发布到生产 | **阻塞** | 会进入公开目录并被玩家下载；建议只在隔离 Preview 发布 |

### P-1 口令轮换

- 目的：让唯一管理员口令脱离「曾经落盘」的状态，并使所有既有会话立即失效。
- 已核实：`POST /api/auth/password` 先校验旧口令与策略（`MIN_PASSWORD_LENGTH=12`），再以 scrypt 重哈希，随后 `credentialEpoch+1`；`verifySession` 比对 epoch，旧会话立即失效（不依赖逐条撤销是否成功）。提交点之后不再返回 5xx。
- 前置：① 备用管理员可独立登录（用户已报告成功，我**未**验证、也不会索要凭据）；② 新口令存进密码管理器，不落仓库。
- 失败回退：若新口令丢失，用备用管理员登录后重置；若备用管理员不可用，需走部署侧重建（成本高，因此 ① 必须成立）。
- 执行方式（授权后）：登录 `/admin/account` → 填旧/新口令 → 确认返回 `status=complete`；随后用无痕窗口验证旧会话失效、新口令可登录。
- 风险：轮换会踢掉所有设备（含正在排障的会话），需在无人操作窗口执行。

### P-2 `.e2e` 清理

`scene-hunt-admin/.e2e/` 共 22 个文件，逐个分类（`/.e2e/` 已被 `.gitignore:51` 覆盖，从未进 Git）：

| 类别 | 文件 | 处理建议 |
|---|---|---|
| **含真实凭据（敏感）** | `deploy-credentials.env`（明文口令）、`admin-cookies.txt`、`admin-cookies2.txt`（`__Host-mos_sess` 生产会话，已过期） | P-1 轮换成功后删除；新凭据只存密码管理器 |
| **含 PII（低敏）** | `login-resp.json`、`users-ro.json`、`work-detail.html` | 可删（管理员邮箱与 id 无长期价值） |
| **证据（建议保留）** | `import-apply.json`、`import-dryrun.json`、`pre-bsop-classic-01.json`、`post-bsop-classic-01.json`、`pre-deploy-hashes.txt`、`audit-now.html`、`audit-page.html`、`works-list.json`、`works-now.html`、`works-page.html`、`admin-status.html` | 迁移与投产证据，保留 |
| **日志** | `build-fix.log`、`build-verify.log` | 无 token/口令命中，可留可删 |
| **失效指针** | `e2e-run-dir.txt`、`local-e2e-dir.txt` | 指向已被清理的临时目录，可删 |
| **脚本** | `create-backup-admin.mjs` | 一次性脚本，建议删除（功能已被 `tools/qa/seed-admin.mjs` 取代） |

影响分析：`tests/`、`tools/`、`package.json`、`scripts/` 对 `.e2e` 的引用数 = **0**（grep 实测），删除不影响构建与全部测试。
未执行原因：删除不可逆且涉及凭据文件，按规则停在授权关口。

### P-3 生产 Blob 只读导出

- 读取范围：`registry/*`（users、sessions、works、audit）与 `published-games/*`（包与 meta）。
- 权限：Vercel Blob 的 `BLOB_READ_WRITE_TOKEN` 是**项目级读写**令牌，没有只读作用域——这是 P-3 的核心风险：工具代码只做 `list`+`get`，但令牌本身具备写能力，因此执行时必须由人确认「只跑导出脚本」。
- 输出位置：`D:/MOS-Backups/<date>/`（仓库外，工具会强制校验）。
- 写操作证明：工具不包含 `put`/`del`/`copy`；执行前后可用 Blob 列表条目数与 mtime 对比。
- 命令（未执行）：
  ```
  node tools/backup/export.mjs --store=blob --prefix=registry --prefix-games=published-games \
       --out=D:/MOS-Backups/prod-<date> --mode=full
  node tools/backup/verify.mjs --manifest=D:/MOS-Backups/prod-<date>/manifest.json
  ```
  令牌通过环境变量注入，不写进命令行、不落盘。

### P-4 Preview 引导变量

- 变量：`BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD`，仅 `preview` 作用域。
- 现状：**未添加**（`vercel env ls preview` 无此二项）。
- 泄漏面：服务端环境变量，不下发客户端；风险主要在 Preview 部署日志与截图。
- 方案：用一次性 QA 邮箱 + 一次性强口令 → 部署一次 Preview → 访问 `/admin/login` 触发引导 → 用 `tools/qa/publish-flow.mjs` 跑闭环 → **立即删除两个变量并重新部署**。
- 验证脚本：已具备（`tools/qa/{seed-admin,publish-flow}.mjs`），本地已跑通 24/24。

### P-5 推送 QA 分支

- 待推：`origin/integration/20261029-game-admin..HEAD`，**1 个提交** `0df4762`，11 个文件（4 新增测试/工具文件 + 7 修改）。
- 目标分支：`feat/qa-phase2-20261029`（新分支），不推 `master`、不开 PR。
- 敏感扫描：diff 内仅命中 `process.env.BLOB_READ_WRITE_TOKEN`（变量名，非值）0 处凭据字面量。
- 命令（未执行）：
  ```
  git push origin qa/phase2-20261029:feat/qa-phase2-20261029
  ```
- 冲突面：与 `integration/20261029-game-admin` 无重叠文件冲突（本轮只碰测试与工具 + `lib/cloud`）。回退：远端删分支即可，无副作用。

### P-6 生产部署与回滚

- 前置检查：干净构建已成功（无 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`）；`tsc` 0 错；724 单测全绿。
- 生产基线：`kcc5lwyok`；回滚点 `qahmx0jrz`。
- 部署后健康检查：`/`、`/games`、`/admin/login`、`/content/cloud/catalog.json`、`/api/games/bsop-classic-01`（哈希 `2b4f3db6a861d992`）、`/api/games/seminary-field-lab`（`8fb4fbefc9c51219`）。
- 回滚触发条件：上述任一端点 5xx 或哨兵哈希变化，或 `/games` 目录缺内置包。
- 本轮**未**验证回滚演练（回滚会切换别名，属生产动作）。

### P-7 测试包发布

- 包：`content/fisheng-comprehensive-test.json`，6 站、id `fisheng-comprehensive-test`，通过仓库真实校验器；坐标是**公开公园的演示坐标**，非校园、非真实活动点位。
- 影响：一旦发布，会出现在所有玩家的 `/games` 目录并可下载。
- 建议：只在**隔离 Preview**（前缀 `registry-preview` / `published-games-preview`）发布验证；生产发布需单独授权，且发布前应把标题/描述明确标注「测试包」。

---

## 7. 风险清单

| 级别 | 编号 | 风险 | 证据 | 影响 | 缓解 |
|---|---|---|---|---|---|
| 高 | H-1 | 生产管理员口令可能已被轮换，而本机凭据文件仍是旧值 | `.e2e/deploy-credentials.env` 的登录返回 `invalid_credentials`（13:48 前有效，仅试 2 次未触发锁定） | 自动化与应急进不去后台 | 由你确认口令状态；P-1 时一并把凭据存进密码管理器 |
| 中 | M-1 | Blob 令牌无只读作用域 | Vercel 令牌模型 | 导出脚本持有写权限 | 执行时人工确认只跑 export；前后比对对象数 |
| 中 | M-2 | `.e2e` 仍存 2 个历史生产会话 Cookie | 文件存在，`__Host-mos_sess` 值 43 字符 | 已过期，但仍是敏感材料 | P-2 清理 |
| 中 | M-3 | 单管理员，备用管理员未经验证 | 我未登录验证（不做） | 口令丢失时恢复成本高 | P-1 前请自行确认备用管理员可登录 |
| 中 | M-4 | 目录与读端点有 30s 级缓存 | `catalog.json` 返回 `max-age=30, stale-while-revalidate=120`；`/api/games` 默认 `max-age=10, swr=30` | 撤下后最长约 30–150s 才从 `/games` 消失 | 属设计取舍；紧急撤下需知会「非即时」 |
| 低 | L-1 | `packUrl` 曾接受 `..` | 本轮已修 | 已消除 | 回归测试锁定 |
| 低 | L-2 | 玩家端 2 条断言陈旧（文案移到 `title`、跨域瓦片 404） | 上一轮修正 | 曾误报 | 已修并复跑 40/40 |
| 低 | L-3 | 分支不互斥 | `state.ts:sceneGateOpen` + 新用例 | 多结局设计需注意 | 若要真互斥需新增字段，**不要**改 `requires` 语义 |
| 低 | L-4 | `worktree` 有 2 个 prunable 条目 | `git worktree list` | 仅整洁性问题 | `git worktree prune`（未执行） |

---

## 8. 生产未变更证明

本轮**没有**执行下列任一操作：

| 未执行的操作 | 可核对证据 |
|---|---|
| 生产部署 / 别名切换 | `vercel ls --environment production` 顶部仍是 `kcc5lwyok`（6h），无新条目 |
| 生产回滚 | 同上；`qahmx0jrz` 仍是 11h 的那条 |
| 生产环境变量变更 | `vercel env ls production` 仅 3 项，创建时间分别为 11h / 4d / 15d，无新增 |
| 生产 Blob 读/写/删 | 本轮未调用任何 Blob API（仅本地 fs 演练） |
| 生产账号与口令 | 未调用 `/api/auth/*`、`/admin/account`；未登录生产后台 |
| 线上作品发布/撤回/可见性 | 仅 GET 两个哨兵端点，哈希与上轮一致（`2b4f3db6a861d992` / `8fb4fbefc9c51219`） |
| 测试包发布 | 只在本地隔离 registry 发布，键在临时目录 |
| 远程推送 / PR | `git ls-remote origin qa/phase2-20261029` 为空 |

---

## 9. 下一步最短路径

**决策 1（建议先做）：批准 P-1 口令轮换**
你需要做的：确认备用管理员（`xmjzkj@…`）能独立登录 → 授权轮换 → 我把新口令交给你的密码管理器流程（不落仓库）。
批准后执行：`/admin/account` 改密 → 无痕窗口验证旧会话失效 → 记录 `credentialEpoch` 递增与审计条目 → 同步更新/删除 `.e2e` 中的凭据文件。

**决策 2：批准 P-3 生产只读导出（可与 P-1 同批）**
批准后执行：导出 → `verify` → 报告对象数、总字节、清单哈希；落 `D:/MOS-Backups/`，不进仓库、不进 `public/`。

**决策 3：批准 P-5 推送 QA 分支**
批准后执行：`git push origin qa/phase2-20261029:feat/qa-phase2-20261029`（不开 PR）。

P-4、P-6、P-7 建议等 P-1/P-3 完成后再单独批准；P-6 与 P-7 不应合并授权。

---

## 10. 交付清单

**新增文件**

| 路径 | 说明 |
|---|---|
| `tests/cloud/catalog-visibility.test.ts` | 15 项，发布可见性链路 |
| `tests/cloud/catalog-degrade.test.ts` | 2 项，目录降级 |
| `tests/auth/bootstrap.test.ts` | 13 项，引导管理员与调用路径 |
| `docs/qa/phase2-release-readiness-review.md` | 本报告 |

**修改文件**

| 路径 | 变更 |
|---|---|
| `lib/cloud/index.ts` | `packUrl` 改用 `GAME_ID_PATTERN` |
| `tools/backup/restore.mjs` | 恢复目标守卫 |
| `tools/backup/drill.mjs` | +2 项守卫断言 |
| `tools/qa/publish-flow.mjs` | +4 项目录断言 |
| `tests/game/branches.test.ts` | +1 项 `requires` 语义用例 |

**提交**

| SHA | 内容 |
|---|---|
| `0ed1e4e` | 上一轮：测试包 + 发布闭环 + 备份恢复工具 |
| `0df4762` | 本轮：发布可见性/引导/分支语义测试 + 两处防御修复 |
| `HEAD` | 追加提交本报告 |

**测试日志**：`tests/e2e/artifacts/`（玩家端，含截图）、终端输出见第 3 节命令。

**仍未完成**：P-1～P-4、P-6、P-7（待授权）；真实设备 GPS 实测；生产 Blob 端到端。
