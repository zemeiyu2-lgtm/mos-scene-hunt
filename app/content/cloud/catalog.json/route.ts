import { NextResponse } from "next/server";

const catalog = {
  version: "1.0",
  updatedAt: "2026-10-07",
  games: [
    {
      id: "bsop-eight-secrets",
      title: "神学院的八个秘密",
      author: "MOS Scene Hunt · BSOP Reference 01",
      description: "在真实校园中体验呼召、真理、实践、敬拜、群体、生命、忠心与使命。",
      language: "zh-CN",
      estimatedMinutes: 35,
      difficulty: "easy",
      sceneCount: 8,
      status: "published",
      packFile: "bsop-eight-secrets.json",
    },
    {
      id: "igsl-eight-transformations",
      title: "IGSL的八个转化现场",
      author: "MOS Scene Hunt · IGSL Backup 01",
      description: "从呼召、真理与行动，走向群体、服事、生命与城市使命。",
      language: "zh-CN",
      estimatedMinutes: 50,
      difficulty: "medium",
      sceneCount: 8,
      status: "published",
      packFile: "igsl-eight-transformations.json",
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
