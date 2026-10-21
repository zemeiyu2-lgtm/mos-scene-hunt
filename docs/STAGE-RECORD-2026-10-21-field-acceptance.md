# MOS Scene Hunt · 阶段记录：真机验收通过后的封存

- 记录日期：2026-10-21
- 仓库：`D:/WorkBuddyData/WorkBuddy/2026-10-04-09-08-00/scene-hunt-sounds`（origin: `zemeiyu2-lgtm/mos-scene-hunt`）
- 分支：`feat/immersive-game-sounds`
- HEAD：`d0ceff6`（feat(sound): unified chapel-bell voice for all six cues）
- 基线：`origin/master` @ `5efbb7e`
- 状态：**全部成果保留在工作区，未提交、未推送、未合并、未发布 Production**

---

## 1. 封存时的改动清单（17 项代码/测试改动 + 本记录 = 18 项，均未提交）

### 已跟踪文件修改（4）
| 文件 | 内容 |
|---|---|
| `app/design/page.tsx` | 设计器：深链接载入、新建空白游戏（含未保存三选一保护）、挑战题型切换与选项编辑、顶部信息卡压缩、保存失败警示条 |
| `lib/content/index.ts` | 存档校验门槛 `saveAuthoredGameChecked`（写前跑 `validateGame`，失败不写、返回具体问题）、`listAuthoredGameIds`、空白标题拦截 |
| `app/create/page.tsx` | 创作中心保存按钮改用同一校验门槛，显示真实失败原因 |
| `.gitignore` | 增加 `.env*` 相关忽略（Vercel CLI 关联时生成 `.env.local`，含 OIDC 令牌，未入库） |

### 新增文件（13）
| 文件 | 用途 |
|---|---|
| `app/design/design-target.ts` | 深链接解析纯函数（返回深拷贝，预览编辑不污染存档） |
| `app/design/design-game.ts` | 空白游戏工厂与冲突 ID 生成（`-2` 后缀） |
| `lib/game/challenge-edit.ts` | 题型切换与选项增删的纯函数（字段重建、答案继承规则） |
| `lib/game/save-errors.ts` | JSON 路径 → 设计者语言（“第 N 个体验点的正确答案”） |
| `tests/design/`（5 个测试文件） | 深链接、空白游戏、挑战编辑、保存门槛、错误文案（32 项） |
| `tests/e2e/probe-design-deeplink.mjs` | 深链接浏览器验收（6 项） |
| `tests/e2e/probe-designer-round2.mjs` | 设计器第二轮验收（13 项） |
| `tests/e2e/probe-save-guard.mjs` | 保存门槛浏览器验收（7 项） |
| `tests/e2e/probe-full-journey.mjs` | 全流程验收：创建→保存→恢复→游玩→导出导入→分享（24 项） |
| `tests/e2e/probe-fieldtest-prep.mjs` | 真机验收前的测试游戏准备与二维码生成（6 项） |
| `tests/e2e/artifacts/fieldtest-alpha-1-*` | 测试游戏 `fieldtest-alpha-1` 的分享链接（LAN/HTTPS）与二维码 PNG/SVG |

**测试游戏数据**：`fieldtest-alpha-1`「真机验收·A线（测试可删）」，两站相邻约 50m，未删除。

---

## 2. 自动化验证结果（2026-10-21 14:2x 复跑）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | ✅ 通过 |
| 单元/集成测试 | `npx vitest run` | ✅ **185/185 通过（15 个文件）** |
| Lint | `npx eslint .` | ✅ **0 错误**；5 个既有警告（game-map×2、content/index、probe-design-batchb 等，与本阶段无关） |
| 生产构建 | `npm run build` | ✅ Compiled successfully 17.0s，15/15 静态页（`next build` 自动改写 `tsconfig.json`，已还原，工作区干净） |
| 浏览器探针（历史执行） | 4 个 `.mjs` | ✅ 6/6、13/13、7/7、24/24（需 `npm run build` + `next start` 后可重跑） |

---

## 3. Vercel Preview 部署信息

| 项 | 值 |
|---|---|
| 部署类型 | **Preview**（非 Production；`vercel deploy`，未用 `--prod`） |
| URL | `https://mos-scene-hunt-533g0jcqu-zemeiyu2-1187.vercel.app` |
| 部署 ID | `dpl_FiknXawp8PPdeVTSRRRQ13zLWvBo` |
| 部署时间 | 2026-10-21 13:59:56（CST），Ready 26s |
| 项目 | `mos-scene-hunt`（`prj_JtB7eEJ0LyiJja0GgKVEQIDE0ulA`），既有项目，未新建 |
| 账号 | Vercel `zemeiyu2-1187` |
| 访问保护 | ⚠️ **开启 Vercel Authentication（SSO）**：预览 URL 无凭据访问返回 302→vercel.com 登录；Production 域名 `mos-scene-hunt.vercel.app` 公开（200），但为旧版本 |
| GPS 模拟器 | **关闭**（未设置 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`；客户端开关编译为恒假；SSR 无模拟器渲染） |
| 代码版本 | **当前工作副本**（部署包中检出「新建空白游戏」「必须是非空字符串」两个仅存在于未提交修改的字符串） |
| 环境变量 | 项目侧仅有既有 `BLOB_READ_WRITE_TOKEN`（本应用未使用）；无部署必需变量 |

---

## 4. 已通过的真机验收（用户 iPhone 12 Pro 实测，2026-10-21）

针对**上述 Preview 测试版本**，已确认通过：
- ✅ 真实 GPS 定位与目标区域解锁
- ✅ 选择题作答与判定
- ✅ 关键词题作答与判定
- ✅ 教堂钟声音效（外放可听）
- ✅ 奖励领取
- ✅ 游戏完整流程走完（完成态）
- ✅ 二维码扫描后进入游戏

> 结论适用边界：以上验收针对 Preview 部署 `dpl_FiknXaw…` 所对应的代码状态（= 当前工作副本）。

---

## 5. 尚未确认的事项

1. **其他设备免登录访问未确认**：预览域名的 SSO 保护仍在（未按禁令修改保护设置）。本次扫码成功是在已登录 Vercel 的浏览器环境；**未登录设备访问预览域名会被重定向到 Vercel 登录页**。生产域名公开但为旧版本。
2. 分享链接在**未登录 Vercel 的第三方设备**上能否直接进入游戏，尚未实测。
3. iOS 端音频在静音开关切换、后台切回等边界场景的行为未逐项验证。
4. 真实户外多点、长距离路线下的 GPS 漂移与触发稳定性未做多轮统计。
5. 服务器/浏览器时区、弱网环境下的离线包行为未专项验证。

---

## 6. 恢复与继续开发

```bash
cd "D:/WorkBuddyData/WorkBuddy/2026-10-04-09-08-00/scene-hunt-sounds"
git branch --show-current      # feat/immersive-game-sounds
git log --oneline -1           # d0ceff6
git status --short             # 本阶段已固化为本地检查点提交（checkpoint: iPhone field acceptance baseline）
```

- Git 身份：`YU ZE MEI <zemeiyu2@gmail.com>`；远程 `origin` 指向 GitHub 仓库
- Vercel 关联：`.vercel/project.json`（projectId `prj_JtB7…`）；`.env.local` 含 OIDC 令牌，**已被 .gitignore 排除，勿提交**
- 本地预览：`npm run build && npx next start -p 3102 -H 0.0.0.0`
- 需模拟器联调时：`NEXT_PUBLIC_ENABLE_GPS_SIMULATOR=1 npm run build`
- 重新部署预览：`npx vercel deploy`（**不要** `--prod`）
- 浏览器探针：`npx next start -p 3102` 后 `E2E_BASE_URL=http://127.0.0.1:3102 node tests/e2e/probe-*.mjs`（需 puppeteer-core 与本地 Chrome）

## 7. 风险提示

- 18 项改动已固化为本地检查点提交 `checkpoint: iPhone field acceptance baseline`（仅本地，未推送）；此后任何 `checkout/clean/reset` 损失都可由该提交恢复。
- 预览域名随新部署变化，旧二维码会失效；正式验收时需重新发布并重新生成二维码。
