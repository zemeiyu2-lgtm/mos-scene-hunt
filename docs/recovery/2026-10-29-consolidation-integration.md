# RELEASE-EXEC-04：游戏端与后台并行收尾整合（2026-10-29）

## 一句话

把两条此前各自成立、但互不相连的工作线合流到同一分支，打通「后台审核发布 → 游戏中心发现 → 玩家下载」链路，修复四处「界面看着有、实际是坏的」缺陷，并经 Preview 验证后投产。

## 部署记录

| 环境 | 部署 ID | 来源提交 | 状态 |
|---|---|---|---|
| 回滚点（投产前生产） | `qahmx0jrz` / `dpl_Fvxqu4ReqEUZwBbWm8jbBsi3owBw` | `b46e47e` | Ready，保留可回退 |
| Preview（隔离命名） | `mos-scene-hunt-nzgkst901-zemeiyu2-1187.vercel.app` | `9796b6a` | Ready，已逐个验收 |
| **生产** | `mos-scene-hunt-kcc5lwyok-zemeiyu2-1187.vercel.app` → `mos-scene-hunt.vercel.app` | `9796b6a` | Ready，回归通过 |

Preview 隔离前缀：`REGISTRY_BLOB_PREFIX=mos-preview-20261029-registry`、`PUBLISHED_GAMES_BLOB_PREFIX=mos-preview-20261029-games`。

## 提交清单（基线 `ef71ab2`）

| SHA | 内容 |
|---|---|
| `576c220` | 合并 `feature/gameplay-expansion`（奖励类型选择器、物品门配置、前置场景编辑器、限时挑战 V1.0） |
| `4f488b5` | 挑选到站弹窗（替代自动跳转，含「刷新伪到达」判定） |
| `164c07d` | 挑选音效解锁提示与定性到站文案 |
| `b594799` | 修复四处契约与文案缺陷（见下） |
| `9796b6a` | 新增 15 米验收包与 11 项通关测试 |

## 本轮修复的缺陷

1. **云端目录写死**：`app/content/cloud/catalog.json/route.ts` 现合并「仓库内置包」+「registry 中 `state === "published"` 的作品」；`unlisted` 仍仅直链可达；注册表读取失败降级为内置目录，不 500。
2. **已发布作品可被下载**：`CloudGameEntry` 增加 `source: repo | registry`；`packUrl` 对 registry 来源复用 `/api/games/<id>`——同一条已经过发布门禁的读链路，未新增可取包入口。
3. **创作端发布不再必然失败**：`design/page.tsx` 按真实契约重写（此前要 `playPath`，接口只给 `previewPath`，生产上必失败且未登录先吃 401）；接口新增 `publishedVersionId`，仅当它等于本次 `versionId` 时才给出分享链接。
4. **任务页解锁原因**：改为从 `requires` / `requiresItems` 推导（`lib/game/lock-reason.ts` + 12 项单测），无门禁时才回退原有链式文案。
5. **半径文案对齐**：`DEFAULT_TRIGGER_RADIUS` 本就是 15 米，提示却写「默认 50m」；`r < 10` 分支文案说「低于建议下限 20m」，与阈值自相矛盾。

## 明确排除的既有工作

| 提交/分支 | 处置理由 |
|---|---|
| `e558e83`、`527c781`（首页浅色主题与入口卡） | cherry-pick 在 `app/page.tsx` 冲突 4 处；纯视觉打磨，不在必需清单 |
| `restore/radar-navigation-mapfirst` | 成果已由 squash `5efbb7e` 合入生产，再合并属重复交付且必冲突 |
| `feat/cloud-publish-loop` | 整体合并会删除 `/api/publish`、把二维码退回 2600 字符阈值；仅移植其目录合并思想 |

## 验证结果

- `tsc --noEmit`：0 错误
- `vitest`：49 文件 / **683** 项通过
- `tests/e2e-admin/run.mjs`（隔离数据、真实 HTTP）：**59 / 59** 通过
- 生产回归：12 条路由正常；`/admin/account` 由 404 变 307（新后台页已上线）；已发布两包字节哈希与投产前**完全一致**；6 个已撤回作品仍 404；生产 chunk 含 `timeLimitSeconds`、`前置场景`、`需先完成`
- 玩家端 E2E：本轮**未运行**（沙箱批量删除守卫阻止清理 `.next/trace-build`），非代码失败

## 遗留（按严重度）

1. P0：生产管理员口令与会话明文落盘于 `.e2e/`（既有问题，须轮换 + 清理）
2. P1：后台无作品编辑 / 复制 / 删除；宝物兑现零实现
3. P2：真实手机户外 GPS 闭环从未验证；`Scene.hint` 不渲染；随机事件未实现
4. P3：推送本分支会触发 Vercel 自动预览，而未带隔离前缀时命名空间闸门会按设计抛错（不影响生产）

详见 `D:\MOS-Reports\Scene-Hunt\MOS-Scene-Hunt-收尾整合与交付报告-20261029.md`。
