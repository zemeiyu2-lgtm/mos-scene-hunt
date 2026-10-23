# MOS Scene Hunt 历史功能审计报告

- 日期：2026-10-24
- 审计对象：基线 `5efbb7ef`、手机预览 `85ed49c8`（PR #69）、历史综合改进分支 head `130b2d2`（feat/immersive-game-sounds，基线 + 9 提交，+5657/−177）、PR #67/#68/#69
- 方法：逐文件源码对比 + 探针/单测实际运行记录 + 提交说明交叉核验；不使用 ahead/behind 数字判定缺失
- 恢复分支：`recovery/20261024-historical-features`（基于 `85ed49c8`）

## 一、判定总表

| # | 功能 | 历史来源 | 关键文件 | 基线/预览现状 | 判定 | 恢复方式 |
|---|---|---|---|---|---|---|
| 1 | 首页文字精简、地图演示区扩大、主按钮三态自适应 | PR #66 `7bdbf75`（squash 进入 `5efbb7e`）| `app/page.tsx` | 存在；与 `7bdbf75` 0 行差异；探针 S1/S1b/S2/S3 通过 | **完整保留** | 无需恢复 |
| 2 | 游戏中心/创作（设计）中心入口 | 同上 | `app/page.tsx:137` | 存在；入口文案「设计中心」与 /design 页标题「创作中心」不一致 | **部分缺失**（命名统一在 `130b2d2`）| cherry-pick `130b2d2` |
| 3 | 地图优先创作体验、导入抽屉收起、地图工作区 | PR #67 squash | `app/design/page.tsx` | 存在；B1/B2 探针通过 | **完整保留** | 无需恢复 |
| 4 | 地图点选场景、区域绘制、圆形取景、标记点击不丢点 | PR #67 + `eba4df3` 等效内容 | `app/design/page.tsx`、`components/game-map.tsx` | 存在；19/19 + 11/11 探针通过；B7 断言 teardown 代码在场 | **完整保留** | 无需恢复 |
| 5 | 绘制中保存按钮禁用 | PR #69 `85ed49c8` | `app/design/page.tsx` | 存在；探针 11/11 | **完整保留** | 恢复分支基于此提交 |
| 6 | 根据游戏包坐标初始化地图、区域变化重新取景 | PR #67 | design/map 页 | N10、C3 探针通过 | **完整保留** | 无需恢复 |
| 7 | 北向固定地图、手机朝向指针 | PR #67 | `components/game-map.tsx` | 存在（N2/N3 通过）；但 `25461eb` 新增 `lib/location/heading.ts` 设备朝向融合不在基线 | **部分缺失** | cherry-pick `25461eb` |
| 8 | 任务面板折叠/到达展开、紧凑雷达、不显示距离数字 | PR #67 | `app/map/page.tsx` | N1/N4/N5/N9 通过 | **完整保留** | 无需恢复 |
| 9 | 游戏内显式退出确认（回游戏中心）、任务页进度补强 | `25461eb`/`a1cfc29` | `app/quest/page.tsx`、`app/scene/[sceneId]/page.tsx` | 基线 quest/scene 无此实现（+48/+27 行） | **确认缺失** | cherry-pick |
| 10 | 游戏包导入/导出/格式兼容 | 基线 + `8ea98cc` 增强 | `lib/content/index.ts` | 基础导入存在；`8ea98cc` 的 +129 行增强（导入后状态、design-game/design-target）缺失 | **部分缺失** | cherry-pick `8ea98cc` |
| 11 | 沉浸声音系统（分层合成、限幅器、钟声语音、/dev/sounds 调试页）| `b26a34b`+`d0ceff6`+`a1cfc29` | `components/sound.tsx`（最终 +403 行）、`app/dev/sounds/page.tsx` | 基线 sound.tsx 为早期版本，无钟声合成 | **确认缺失** | 按序 cherry-pick 三提交 |
| 12 | 挑战编辑 `challenge-edit.ts` + 测试 | `8ea98cc` | `lib/game/challenge-edit.ts`（161 行）| 不存在 | **确认缺失** | cherry-pick |
| 13 | 保存错误恢复 `save-errors.ts` + 测试 | `8ea98cc` | `lib/game/save-errors.ts`（118 行）| 不存在（基线仅有 227b0ca 的基础恢复） | **确认缺失** | cherry-pick |
| 14 | 二维码分档渲染、按模块密度解释性 gate、480px 响应式 | `28c4341` | `lib/content/qr.ts`、`components/game-qr.tsx`、design page | 基线为固定 280px + 2600 字符一刀切 | **确认缺失** | cherry-pick `28c4341` |
| 15 | 分享诊断、链接接收端恢复增强 | `a1cfc29` | `lib/content/share.ts`(+64)、`app/select/page.tsx`(+24) | 基线无诊断 | **确认缺失** | cherry-pick |
| 16 | 微信/Viber/Facebook/系统分享入口 | PR #68（`a201d13`/`c187447`/`54100df`）| `app/design/page.tsx`（+43/−3）| 不存在；且与 `130b2d2` 的 design page 大改**无重叠提交**（两者独立，最终态差异 596 行）| **确认缺失** | cherry-pick PR #68 三提交，冲突处手工协调 |
| 17 | 大型游戏包二维码失败提示 | 基线（2600 阈值）+ `28c4341` 分档 | design page | 基础提示存在；分档解释缺失 | **部分缺失** | 随 #14 恢复 |
| 18 | 声音相关探针/单测、challenge-edit/save-guard/qr 测试 | 各提交附带 | `tests/`（+20 文件）| 不存在 | **确认缺失** | 随各提交恢复 |
| 19 | `lib/location/heading.ts` | `25461eb` | `lib/location/heading.ts` | 不存在 | **确认缺失** | cherry-pick |
| 20 | 保存错误恢复（玩家进度层面）| 基线 `227b0ca` | storage/hunt-provider | 基础存在 | **完整保留**（增强随 #13）| — |

## 二、恢复执行计划（提交粒度，保留原始实现）

批次 A（创作中心/导入/交互）：
1. `8ea98cc` checkpoint: iPhone field acceptance baseline（design 增强版 + challenge-edit + save-errors + content/index）
2. `c43c5d6` chore(e2e): E2E_BASE_URL override（测试基建）
3. `130b2d2` 首页小改（命名统一）

批次 B（二维码/分享/接收端）：
4. `28c4341` explainable QR gate
5. `a1cfc29` round-2 field feedback（share 诊断 + 蓝尾 + 退出游戏中心 + 15m 默认）
6. PR #68：`a201d13` → `c187447` → `54100df`（社交分享入口）

批次 C（声音等）：
7. `b26a34b` immersive sound pass
8. `d0ceff6` chapel-bell voice
9. `25461eb` iPhone 8 项 UX 修复（含 heading.ts）

冲突预防：`85ed49c8` 对 design page 仅 +1 行（play 按钮 disabled）；cherry-pick 冲突时以保留该行为准。`25461eb` 中 `trigger-radius.ts` 被 `a1cfc29` 移除（重构回 `resolveRadius`），按最终态 `130b2d2` 为准。

## 三、测试基准（历史值，本次须重跑）

Vitest 119/119、tsc 0 错、build 通过、探针 design 11/11、acceptance 19/19、radar 11/11、home 7/7。恢复后 130b2d2 附带的约 20 个新测试文件将并入 Vitest。

## 四、真机验证项（自动化不可替代）

二维码实扫、微信/Viber 应用间分享、实际 GPS 朝向与户外地图交互、钟声语音在手机扬声器上的效果、分享链接在微信内打开行为。
