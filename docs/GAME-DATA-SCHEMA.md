# 游戏数据模式（GAME DATA SCHEMA）

本文档定义内容包（`content/*.json`）的字段语义。机器可校验的 JSON Schema 见同目录 `game-data.schema.json`；运行时校验由 `lib/game/types.ts` 的 `validateGame()` 执行（schema 管结构，validateGame 管语义，两者互补）。

## 顶层结构

```jsonc
{
  "$schema": "../../docs/game-data.schema.json",
  "id": "demo-hunt",              // 必填，全局唯一，[a-z0-9-]
  "language": "zh-CN",            // 必填，影响答案归一化的取向
  "title": "Demo Hunt · 记忆之路", // 必填，玩家可见
  "description": "…",             // 必填，寻宝选择页的简介
  "author": "…",                  // 必填
  "version": "0.1.0",             // 必填，内容包自身版本
  "estimatedMinutes": 25,         // 可选，预计时长
  "difficulty": "easy",           // 可选：easy | normal | hard

  "startLocation": { … },         // 必填，见下
  "huntArea": { … },              // 可选，整体探索区域，通常 0.5–2km
  "entrySceneId": "scene-a",      // 必填，必须指向 scenes[0].id

  "aiProfile": { … },             // 可选，AI 扩展位
  "scenes": [ … ]                 // 必填，至少 1 个，线性链
}
```

## startLocation

寻宝的集合点，**几何上必须落在所有场景的触发半径之外**（端到端测试强制执行此不变式）。

```jsonc
{
  "lat": 14.584481,
  "lng": 120.9794,
  "name": "寻宝起点 · 集合点",
  "radius": 80        // 可选， metres；触发半径预设见下
}
```

## HuntArea（整体探索区域）

```jsonc
{
  "center": { "lat": 14.584481, "lng": 120.9794 },
  "radiusMeters": 1500,
  "name": "Rizal Park 城市探索区 · 1.5 km"
}
```

`huntArea` 是“整场游戏”的探索边界；`scene.location.radius` 是“单个地点”的 GPS 触发圈。两者必须分开设计。V0.3 推荐城市步行游戏使用约 1–2 km 的整体区域、25–50m 的单站触发圈。

## Scene（场景）

```jsonc
{
  "id": "scene-a",                 // 必填，包内唯一
  "title": "第一站 · 观察",        // 必填
  "story": "……\n\n……",             // 必填，情境叙事；空行分段
  "briefing": "向南走大约 100 米", // 可选，任务清单里的引导语
  "location": {
    "lat": 14.583604,
    "lng": 120.9794,
    "radius": 50,                  // 可选，缺省 50
    "name": "第一站 · 观察点"      // 可选，地图与任务页显示
  },
  "challenge": { … },             // 必填，见下
  "reward": { … },                // 必填，见下
  "nextSceneId": "scene-b",       // 最后一站为 null
  "npc": { … },                   // 可选，AI 扩展位
  "dialogue": [ … ],              // 可选，AI 扩展位
  "ar": { … },                    // 可选，AR 扩展位
  "mapStyle": { "icon": "1" }     // 可选，地图标记上的字形
}
```

### place（真实地点元数据）

V0.3 开始，真实场景可以声明地点身份、观察重点、访问提示与资料来源。它不参与 GPS 判定，只负责让内容作者能够把“真实地点”与“内容依据”一起保存。

```jsonc
{
  "place": {
    "name": "Chinese Garden",
    "type": "garden",
    "observationFocus": "水面、植物、桥与人的活动",
    "accessNote": "只在开放公共区域活动。",
    "source": {
      "name": "National Parks Development Committee",
      "url": "https://npdc.gov.ph/rizal-park/"
    }
  }
}
```

### 几何约束（validateGame 与 E2E 双重强制）

1. **起点在所有场景半径之外**——否则玩家没动就解锁第一站。
2. **相邻场景不互相落入对方半径**——否则答完一站的瞬间下一站自动解锁，连锁触发。
3. **场景坐标互不重合**。
4. `radius` 建议取预设值 `[20, 30, 50, 80, 100]`（ metres ），偏离预设会产生警告而非错误。
5. `nextSceneId` 必须形成单一线性链，不允许分叉、环与孤岛。

## Challenge（挑战）

V0.1 仅支持三种类型：

### type: "text"（简答）

```jsonc
{
  "type": "text",
  "question": "这条路把你带向哪里？",
  "prompt": "用一个词回答",          // 可选
  "answer": ["归处", "回家", "家"],   // 字符串数组，任一命中即对
  "hint": "……"                       // 可选，玩家可展开
}
```

匹配规则（`lib/game/answers.ts`）：全角折叠 → 繁转简 → 小写 → 剥标点后全等比对；长度 ≥5 且基本为拉丁字母的答案启用一次错别字容忍（Levenshtein ≤1）。**CJK 永远不做模糊匹配**——一个汉字的差异就可能是另一个词。

### type: "choice"（选择）

```jsonc
{
  "type": "choice",
  "question": "最近一栋建筑的外墙主色是？",
  "options": ["白色", "灰色", "红色", "蓝色", "黄色", "绿色"],
  "answer": 1,                        // 正确项的下标
  "hint": "……"
}
```

选项至少 2 个，`answer` 必须落在下标范围内。

### type: "keyword"（关键词）

```jsonc
{
  "type": "keyword",
  "question": "用一个字概括脚下这条路的作用",
  "answer": ["方向", "路", "方向感"],
  "acceptedKeywords": ["道"],        // 可选，额外的宽容匹配词
  "hint": "……"
}
```

与 text 的区别是语义：keyword 的答案会进入背包成为「已收集的关键词」，可被后续场景的谜题引用。

## Reward（奖励）

```jsonc
// 关键词奖励：完成时把 value 加入背包关键词
{ "type": "keyword", "title": "记忆", "value": "记忆", "description": "……" }

// 徽章奖励：只有展示意义，不产生关键词
{ "type": "badge", "title": "走完记忆之路", "description": "……" }

// 物品奖励（预留）：value 是资产 id，不是可收集词
{ "type": "item", "title": "……", "value": "asset/xxx" }
```

**历史教训**：曾把 badge 的 `value` 也当关键词收进背包，产生「path-done」这样的幽灵关键词。现在的规则是：**只有 `type === "keyword"` 的奖励才会派生关键词**，badge/item 的 `value` 永远是资产引用。

## aiProfile（AI 扩展位，V0.1 不生效）

```jsonc
{
  "tone": "克制、安静、略带怀旧",
  "canon": [                       // 未来 AI 生成时必须遵守的事实
    "本寻宝的主题是「记忆」",
    "场景与 GPS 规则由引擎决定，任何叙述都不能改变解锁条件"
  ],
  "allowGeneration": false         // 总开关；V0.1 恒为 false
}
```

设计红线：**AI 不得决定 GPS 规则**。解锁、判定、奖励由确定性引擎执行；AI 只允许参与 story/briefing/hint/npc/dialogue 这些叙述字段的生产。

## 校验层次

| 层 | 工具 | 管什么 |
| --- | --- | --- |
| 结构 | `docs/game-data.schema.json`（JSON Schema） | 字段存在性、类型、枚举、格式 |
| 语义 | `lib/game/types.ts` 的 `validateGame()` | 引用完整性、几何约束、线性链、关键词泄漏 |
| 验收 | `tests/e2e/run-e2e.mjs` §F | 用独立实现的 Haversine 复核几何不变式 |

写好一个新内容包的流程：JSON 先过 schema → `loadGame()` 会跑 `validateGame()` → 端到端验收会跑几何复核。三层都绿才算合格。
