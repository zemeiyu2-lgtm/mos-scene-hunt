# MOS Scene Hunt V1.0 · 回滚方案（ROLLBACK PLAN）

- 编写：2026-10-30 ｜ 适用对象：V1.0 发布候选（`v1.0/platform-optimization`）未来若经用户授权部署到生产后的回滚
- 前提：本方案不执行任何生产操作，仅供用户授权部署后使用。

## 1. 当前生产回滚点（2026-10-30 核实）

| 序 | 部署 ID | 说明 |
| --- | --- | --- |
| 当前生产 | `dpl_DuvsvoRuTkrBTJECHiEJXaqZ3LMr`（`gi2t5r4xs`，10-30 11:20） | 生产别名当前指向，内容 ≈ `3331715` |
| 上一回滚点 | `kcc5lwyok`（10-29） | 存储修复前/后的稳定版本（见 48f55a4 记录） |
| 更早 | `qahmx0jrz`（10-29） | 后台平台首部署 |

**部署前必须记录新回滚点**：部署 V1.0 时先执行 `npx vercel ls --environment production | head`，把当时别名指向的部署 ID 抄入本节，再部署。

## 2. 回滚触发条件（任一满足即回滚）

1. 生产出现真人存档丢失或格式损坏（P0）。
2. 游戏中心/官方示范包不可达（catalog 或 `/api/games/mos-classic-01` 非 200）。
3. 自动演示无法进入或演示污染真人数据。
4. 管理后台登录/审核/发布链路中断。
5. 移动端白屏/地图不可用大面积出现。

## 3. 回滚操作（代码/部署层）

```bash
# 1) 立即把生产别名指回上一稳定部署（不改代码、不改数据）
npx vercel alias set <上一部署URL> mos-scene-hunt.vercel.app
# 2) 核验
curl -s -o /dev/null -w "%{http_code}\n" https://mos-scene-hunt.vercel.app/
curl -s https://mos-scene-hunt.vercel.app/content/cloud/catalog.json | head -c 200
```
或在 Vercel 控制台 Deployments → 选择上一生产部署 → Promote to Production。

## 4. 回滚时的数据影响评估（重要）

V1.0 新增的存储全部是**新增命名空间**（`mos-scene-hunt:demo:*`、`mos-scene-hunt:preview:*`，sessionStorage），**未修改任何既有存储键或信封格式**（D-013）。因此：

- 回滚到旧版本后：真人存档（`save:<gameId>`）无需迁移、无需清理，直接可读。
- sessionStorage 中的 demo/preview 残留会在标签页关闭时自动消失；旧版本不读它们。
- `save-index` 结构未变。
- **无数据库迁移、无 Blob 结构变更**，无需数据回滚步骤。

## 5. 环境变量回滚（如已按建议调整）

若部署时执行了「移除 `NEXT_PUBLIC_ENABLE_GPS_SIMULATOR`、新增 `NEXT_PUBLIC_ENABLE_AUTO_DEMO=1`」：

```bash
# 恢复旧配置（仅在需要回滚演示/模拟器能力时）
npx vercel env add NEXT_PUBLIC_ENABLE_GPS_SIMULATOR production   # 输入 1
npx vercel env rm NEXT_PUBLIC_ENABLE_AUTO_DEMO production
# 环境变量变更需重新部署才生效
```

## 6. 分支回滚

```bash
# 发布候选分支保留不动；回滚时生产直接指向旧部署即可，不需要回退分支
git -C <repo> log --oneline v1.0/platform-optimization -5   # 留档
```

## 7. 回滚后验证清单

- [ ] `/`、`/select`、`/map`、`/games` 均 200
- [ ] `/api/games/mos-classic-01` 200，8 站内容完整
- [ ] `/content/cloud/catalog.json` 返回预期条目
- [ ] 管理后台可登录（/admin/login）
- [ ] 真机打开既有进度：继续寻宝可用

## 8. 不可回滚项（如实声明）

- 若未来引入真实数据迁移（当前没有），需单独备份+迁移方案，不在本方案范围。
- 生产 Blob 中已发布的游戏版本记录不因代码回滚而改变（registry 状态机保证 publishedVersionId 不移动）。
