# STAGE-RECORD｜服务器开发第一阶段：游戏发布与读取 — 最终验收报告

- 日期：2026-10-25
- 阶段状态：**结项（含明确标注的遗留验证项，见 §8）**
- 开发分支：`recovery/20261024-historical-features`
- 分支最终 HEAD：`268d1d7e38d0a50656b76d4c0a567229fbe2b346`
- 正式版 master 基线：`5efbb7ef00d748e8cdb9d1b71328a397895241ba`（未修改、未合并、未部署）
- 仓库：`zemeiyu2-lgtm/mos-scene-hunt`

## 1. 阶段目标与范围

让创作者能够发布游戏包并生成分享链接，让玩家能够通过链接读取指定的已发布版本。范围包括：发布/读取接口缺陷修复、版本不可覆盖保障、生产可持久化存储（Vercel Blob）、创作者发布→链接→二维码→玩家读取链路打通、自动化测试。不含：第四批功能、团队协作、账户体系、生产发布。

## 2. 最终代码与部署信息

| 项 | 值 | 来源 |
|---|---|---|
| 分支 HEAD（本地=远程） | `268d1d7e38d0a50656b76d4c0a567229fbe2b346` | 本轮 git 核验（2026-10-25 15:35） |
| 提交链 | `feca0ee` → `2c392c3`（阶段主体）→ `b7e3e37`（云端发现修复 1）→ `268d1d7`（云端发现修复 2） | 本轮 git log 核验 |
| 验收部署 URL | https://mos-scene-hunt-3x1fjqsba-zemeiyu2-1187.vercel.app | 本轮 `vercel inspect`：● Ready，创建于 2026-10-25 15:09 |
| 部署来源提交 | `268d1d7`（临时 detached worktree 干净部署，规避未跟踪目录） | 历史执行记录 |
| 工作副本 | `E:/MOS-Audit/mos-scene-hunt-20261020/work/scene-hunt` | — |

## 3. 云端 API、Blob 持久化与版本不可变性验收

**来源：历史报告（2026-10-25 执行的真实云端验收，非本轮重跑）。** 验收部署为 268d1d7 的 Preview，存储为既有 Blob store `mos-scene-hunt-shares`（sin1）。

| 项 | 结果 |
|---|---|
| 首次发布返回 gameId/versionId/分享路径（`#cloud=`） | ✅ 201 |
| latest 与指定版本读取内容一致 | ✅ |
| 同内容不同 JSON 键序重复发布幂等（无假 409） | ✅ `created=false` |
| 新版本发布后旧版本 `?v=` 内容不变（`immutable` 缓存头）；latest 正确前移 | ✅（Blob 内 meta 实测前移） |
| 不存在游戏/版本 404（`game_not_found`/`version_not_found`） | ✅ |
| 非法输入 400/415/413；500 不泄露内部路径与异常细节 | ✅（运行时日志确认错误仅服务端记录） |
| 数据真实写入 Vercel Blob 且跨部署存活 | ✅ `vercel blob list` 实测；数据跨 2 次部署可读 |
| latest 缓存传播 | ✅ 收紧为 `max-age=10 + SWR=30` 后实测 5 秒内传播 |

版本不可变性由两层强制：应用层下载比对（不同内容 → 409）+ Vercel Blob 平台层拒绝对已存在路径的无 `allowOverwrite` 写入（提交 `b7e3e37`）。

## 4. 手机端人工验收（负责人报告通过）

以下五项由项目负责人实际操作并报告通过；非 WorkBuddy 自动化执行，本记录不虚构设备日志、截图或时间戳：

1. 页面正常打开并进入创作中心。
2. 成功创建或打开测试游戏。
3. 点击发布，成功生成分享链接。
4. 二维码正常显示，手机相机能够识别。
5. 通过分享链接打开游戏并成功游玩。

## 5. 自动化检查结果（来源：历史报告，对应提交 268d1d7 前后代码）

- `npm test`：32 文件 / 394 项全过（`2c392c3`）；云端修复后 397 项全过（`b7e3e37`/`268d1d7`）。
- `npm run typecheck`：通过。`npm run build`：通过，两个 API 路由均为动态。
- `npm run lint`：全仓大量既有告警/错误来自未跟踪 `.next-stale-*` 生成目录与既有代码，非本阶段引入；对阶段改动文件 scoped lint 为 0 errors。
- 本轮补充执行：`tests/content/share.test.ts` 7 项旧式链接单测在 HEAD（`268d1d7`）通过（2026-10-25 15:37）。

## 6. 本轮（结项日）只读核验结果

来源：本轮执行（2026-10-25 15:35–15:40）。

- 分支/HEAD/远程三方一致（`268d1d7`）；提交链 `feca0ee→2c392c3→b7e3e37→268d1d7` 完整。
- `origin/master` 仍为 `5efbb7e`。
- 验收部署 `3x1fjqsba` 状态 ● Ready。
- 环境变量：`PUBLISHED_GAMES_STORE=blob` 仅存在于 Preview；`BLOB_READ_WRITE_TOKEN` 为既有三环境配置（11 天前）——Production 变量未被本阶段修改。
- 用户原有未提交内容受保护：`tests/e2e/artifacts/e2e-summary.json` 改动、`.next-stale-*` ×14、`docs/recovery/` 报告 ×8、`visual-evidence/`（26 项）均原样保留。
- 补测（安全、无写入）：验收部署的 `/select` 页面 JS bundle 中实测包含 `hunt=` 与 `cloud=` 两套解码逻辑（chunk `2y4ng0bhki8s-.js`）。

## 7. Production 与正式版保护状态

- master 未修改、未合并、未部署。
- 未向 Production 添加任何环境变量；未执行 `vercel deploy --prod`。
- 未清理、未覆盖任何用户文件、报告、测试证据或临时目录。

## 8. 遗留事项（未验证项，如实记录）

1. **旧式 `#hunt=` 链接云端浏览器全流程**：已有证据为代码层（部署 bundle 含解码逻辑 + 7 项单测通过 + 代码未改动）；完整浏览器交互实跑未执行，列为遗留验证项。
2. **浏览器端异常路径**（指定版本读取失败 UI、二维码扫码后错误展示）：API 级错误处理已自动化验证；真实浏览器交互未系统化测试。
3. Production 环境启用需人工在 Vercel 控制台添加 `PUBLISHED_GAMES_STORE=blob`（按规未代操作）。
4. 全仓 lint 既有告警（`.next-stale-*` 未被 eslint ignore 等）属环境维护事项，不属本阶段范围。

## 9. 阶段结论与下一阶段边界

**结论：服务器第一阶段结项。** 云端发布、读取、版本保护与持久化验收证据已归档（本文件 + 历史云端验收）；手机端五项人工验收已如实记录；代码、远程分支与 Preview 部署关系已核实；遗留事项明确列出。

下一阶段边界：第四批功能或生产发布均未开始。进入下一阶段前，建议先处理 §8.3（Production 配置）与确认遗留验证项的优先级。
