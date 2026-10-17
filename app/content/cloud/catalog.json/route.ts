import { NextResponse } from "next/server";

const catalog = {
  version: "1.1",
  updatedAt: "2026-10-17",
  games: [
    {
      id: "rizal-park-discovery",
      title: "黎刹公园：寻找最后的宝藏",
      author: "MOS Scene Hunt · 官方母版",
      description: "观察、图片线索、团队挑战与最终宝藏兑现的轻量户外寻宝示范。坐标需由设计者现场确认。",
      language: "zh-CN",
      estimatedMinutes: 25,
      difficulty: "easy",
      sceneCount: 5,
      status: "published",
      packFile: "rizal-park-discovery.json",
    },
  ],
};

export function GET() {
  return NextResponse.json(catalog, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
