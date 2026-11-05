/**
 * Pack -> view model guards.
 *
 * The important property is negative: nothing may be invented. A pack without a
 * duration must yield `null`, not a plausible-looking "30 分钟"; an annotation
 * may add framing but must not be able to change a number the pack owns.
 */

import { describe, expect, it } from "vitest";
import {
  areaLabel,
  availableCities,
  availableTags,
  durationLabel,
  firstSentence,
  packsInCategory,
  sortPacks,
  summarizePack,
  type ExplorePack,
} from "@/lib/explore/summary";
import type { PackAnnotation } from "@/lib/explore/annotations";

const packFixture = {
  id: "demo-pack",
  title: "测试探索",
  description: "第一句话说明这是什么。第二句话继续展开。",
  language: "zh-CN",
  author: "作者甲",
  estimatedMinutes: 45,
  difficulty: "medium",
  startLocation: { lat: 14.5, lng: 120.9, name: "校园集合点", radius: 10 },
  huntArea: { radiusMeters: 230, name: "校区" },
  scenes: [
    { id: "s1", title: "一", story: "x", location: { lat: 1, lng: 1, radius: 10 }, challenge: { type: "choice", question: "q", options: ["a"], answer: 0 }, reward: { type: "keyword", title: "词一" } },
    { id: "s2", title: "二", story: "x", location: { lat: 1, lng: 1, radius: 10 }, challenge: { type: "choice", question: "q", options: ["a"], answer: 0 }, reward: { type: "keyword", title: "词二" } },
    { id: "s3", title: "三", story: "x", location: { lat: 1, lng: 1, radius: 10 }, challenge: { type: "choice", question: "q", options: ["a"], answer: 0 }, reward: { type: "badge", title: "徽章" } },
  ],
};

const source = { gameId: "demo-pack", updatedAt: "2026-11-05T00:00:00.000Z" };

describe("summarizePack — 读真实数据", () => {
  it("从探索包读取站点、时长、难度、范围与集合点", () => {
    const pack = summarizePack(packFixture, source, null);
    expect(pack).not.toBeNull();
    expect(pack!.sceneCount).toBe(3);
    expect(pack!.minutes).toBe(45);
    expect(pack!.difficulty).toBe("medium");
    expect(pack!.place).toBe("校园集合点");
    expect(pack!.areaMeters).toBe(230);
    expect(pack!.challengeMix).toEqual([{ type: "choice", count: 3 }]);
    expect(pack!.rewardMix).toEqual([
      { type: "keyword", count: 2 },
      { type: "badge", count: 1 },
    ]);
  });

  it("没有标注时用探索包自己的第一句话，而不是编造宣传语", () => {
    const pack = summarizePack(packFixture, source, null);
    expect(pack!.tagline).toBe("第一句话说明这是什么。");
    expect(pack!.category).toBeNull();
    expect(pack!.tags).toEqual([]);
    expect(pack!.featured).toBe(false);
  });

  it("缺失字段一律为 null，不补默认值", () => {
    const bare = {
      id: "bare-pack",
      title: "只有标题",
      scenes: [{ id: "s1", title: "一", story: "x", location: { lat: 1, lng: 1, radius: 10 } }],
    };
    const pack = summarizePack(bare, { gameId: "bare-pack", updatedAt: source.updatedAt }, null);
    expect(pack).not.toBeNull();
    expect(pack!.minutes).toBeNull();
    expect(pack!.difficulty).toBeNull();
    expect(pack!.place).toBeNull();
    expect(pack!.areaMeters).toBeNull();
    expect(pack!.tagline).toBeNull();
    expect(pack!.description).toBe("");
    expect(pack!.startPoint).toBeNull();
  });

  it("不合法的难度值被丢弃，而不是猜测", () => {
    const pack = summarizePack({ ...packFixture, difficulty: "extreme" }, source, null);
    expect(pack!.difficulty).toBeNull();
  });

  it("无法解析的数据返回 null（页面据此走 404，而不是渲染半张卡）", () => {
    expect(summarizePack(null, source, null)).toBeNull();
    expect(summarizePack({ id: "x" }, source, null)).toBeNull();
    expect(summarizePack({ id: "x", title: "t", scenes: [] }, source, null)).toBeNull();
  });
});

describe("summarizePack — 标注只能加框架，不能改事实", () => {
  const annotation: PackAnnotation = {
    category: "place-activity",
    tags: ["校园", "户外"],
    tagline: "编辑写的一句话。",
    audience: "16 岁以上",
    goals: ["到达三个地点"],
    featured: true,
    featuredRank: 5,
  };

  it("标注补充分类、标签与编辑语", () => {
    const pack = summarizePack(packFixture, source, annotation);
    expect(pack!.category).toBe("place-activity");
    expect(pack!.tags).toEqual(["校园", "户外"]);
    expect(pack!.tagline).toBe("编辑写的一句话。");
    expect(pack!.audience).toBe("16 岁以上");
    expect(pack!.featured).toBe(true);
  });

  it("标注不能改动站点数、时长或难度", () => {
    const withAnnotation = summarizePack(packFixture, source, annotation)!;
    expect(withAnnotation.sceneCount).toBe(3);
    expect(withAnnotation.minutes).toBe(45);
    expect(withAnnotation.difficulty).toBe("medium");
  });

  it("标注里的未知分类被忽略", () => {
    const pack = summarizePack(packFixture, source, { category: "marketing" as never });
    expect(pack!.category).toBeNull();
  });

  it("模型里不存在评分、参与人数一类字段", () => {
    const pack = summarizePack(packFixture, source, annotation)!;
    const keys = Object.keys(pack);
    expect(keys).not.toContain("rating");
    expect(keys).not.toContain("participants");
    expect(keys).not.toContain("popularity");
  });
});

describe("摘要文案与排序", () => {
  const make = (over: Partial<ExplorePack>): ExplorePack => ({
    ...(summarizePack(packFixture, source, null) as ExplorePack),
    ...over,
  });

  it("第一句话截断不吞掉问号感叹号", () => {
    expect(firstSentence("太棒了！后面还有。")).toBe("太棒了！");
    expect(firstSentence("   ")).toBeNull();
  });

  it("时长与范围的展示在缺失时为 null", () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(45)).toBe("约 45 分钟");
    expect(durationLabel(60)).toBe("约 1 小时");
    expect(durationLabel(90)).toBe("约 1 小时 30 分钟");
    expect(areaLabel(null)).toBeNull();
    expect(areaLabel(230)).toBe("约 230 m 范围");
    expect(areaLabel(1500)).toBe("约 1.5 km 范围");
  });

  it("精选优先，其次按更新时间", () => {
    const a = make({ gameId: "a", featured: true, featuredRank: 10, updatedAt: "2026-01-01" });
    const b = make({ gameId: "b", featured: false, updatedAt: "2026-03-01" });
    const c = make({ gameId: "c", featured: true, featuredRank: 5, updatedAt: "2026-02-01" });
    expect(sortPacks([a, b, c], "featured").map((p) => p.gameId)).toEqual(["c", "a", "b"]);
    expect(sortPacks([a, b, c], "latest").map((p) => p.gameId)).toEqual(["b", "c", "a"]);
  });

  it("分类筛选只命中真的归入该分类的包", () => {
    const inCat = make({ gameId: "in", category: "place-activity" });
    const noCat = make({ gameId: "none", category: null });
    expect(packsInCategory([inCat, noCat], "place-activity").map((p) => p.gameId)).toEqual(["in"]);
    expect(packsInCategory([inCat, noCat], "nature-outdoor")).toEqual([]);
  });

  it("筛选选项只来自真实数据", () => {
    const one = make({ gameId: "1", tags: ["校园", "户外"], city: { cityId: "x", name: "X 城" } });
    const two = make({ gameId: "2", tags: ["校园"], city: { cityId: "x", name: "X 城" } });
    expect(availableTags([one, two])).toEqual([
      { tag: "校园", count: 2 },
      { tag: "户外", count: 1 },
    ]);
    expect(availableCities([one, two])).toEqual([{ cityId: "x", name: "X 城", count: 2 }]);
    expect(availableCities([make({ gameId: "3", city: null })])).toEqual([]);
  });
});
