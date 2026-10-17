import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_BYTES,
  extractGamePayload,
  classifyDuplicate,
  directPublishEnabled,
  canonicalizeGame,
  issuePublishToken,
  readLimitedBody,
  readPublishSecret,
  sha256Hex,
  validateSubmission,
  verifyPublisherAuth,
  verifyPublishToken,
} from "../../lib/cloud/publish-server";
import type { Game } from "../../lib/game/types";

/**
 * 第一批「云端闭环」的服务端核心单测。
 *
 * 覆盖的是**行为契约**而不是实现细节：哪些输入必须被拒绝、哪些必须幂等、
 * 令牌在伪造/过期/缺失密钥下的表现、以及「未配置密钥时绝不放行」这条红线。
 */

const SECRET = "s".repeat(48);
const PUBLISH_KEY = "k".repeat(24);

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "cloud-loop-hunt",
    version: "1.0.0",
    title: "云端闭环测试",
    description: "三个站点的校园寻宝，用于验证发布与下载。",
    author: "测试设计者",
    language: "zh-CN",
    estimatedMinutes: 30,
    difficulty: "easy",
    startLocation: { lat: 14.5844, lng: 120.9794, name: "起点" },
    huntArea: {
      center: { lat: 14.5844, lng: 120.9794 },
      radiusMeters: 150,
      shape: "circle",
      name: "校园",
    },
    entrySceneId: "s1",
    scenes: [
      {
        id: "s1",
        title: "礼拜堂",
        story: "集合点。",
        briefing: "走到礼拜堂门口。",
        location: { lat: 14.5844, lng: 120.9794, radius: 20, name: "礼拜堂" },
        nextSceneId: "s2",
        challenge: { type: "choice", question: "这是什么建筑？", options: ["礼拜堂", "图书馆"], answer: 0 },
        reward: { type: "keyword", title: "起点", value: "出发" },
        place: { name: "礼拜堂", type: "landmark" },
      },
      {
        id: "s2",
        title: "图书馆",
        story: "第二站。",
        location: { lat: 14.5849, lng: 120.9799, radius: 20, name: "图书馆" },
        nextSceneId: "s3",
        challenge: { type: "keyword", question: "在门口写下你看到的词", answer: ["安静"] },
        reward: { type: "keyword", title: "线索", value: "安静" },
      },
      {
        id: "s3",
        title: "钟楼",
        story: "终点。",
        location: { lat: 14.5854, lng: 120.9804, radius: 20, name: "钟楼" },
        nextSceneId: null,
        challenge: { type: "text", question: "今天你带走了什么？", answer: ["平安"] },
        reward: { type: "badge", title: "完成", value: "complete" },
      },
    ],
    ...overrides,
  };
}

describe("validateSubmission - 发布前的包校验", () => {
  it("通过校验的包被接受，并给出规范化摘要与建议文件名", () => {
    const result = validateSubmission(makeGame());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted.game.id).toBe("cloud-loop-hunt");
    expect(result.accepted.packFile).toBe("cloud-loop-hunt.json");
    expect(result.accepted.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.accepted.catalogEntry.status).toBe("draft");
    expect(result.accepted.catalogEntry.sceneCount).toBe(3);
  });

  it("同一份内容重复提交得到同一个摘要（幂等的基础）", () => {
    const a = validateSubmission(makeGame());
    const b = validateSubmission(makeGame());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.accepted.digest).toBe(b.accepted.digest);
  });

  it("只有可选字段被重新排序时，摘要不变", () => {
    const base = makeGame();
    // 重建一个键顺序不同、内容相同的对象。
    const reordered = {
      scenes: base.scenes,
      title: base.title,
      id: base.id,
      description: base.description,
      version: base.version,
      language: base.language,
      author: base.author,
      estimatedMinutes: base.estimatedMinutes,
      difficulty: base.difficulty,
      startLocation: base.startLocation,
      huntArea: base.huntArea,
      entrySceneId: base.entrySceneId,
    };
    const a = validateSubmission(base);
    const b = validateSubmission(reordered);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.accepted.digest).toBe(b.accepted.digest);
  });

  it("改动内容会改变摘要", () => {
    const a = validateSubmission(makeGame());
    const b = validateSubmission(makeGame({ title: "云端闭环测试 v2" }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.accepted.digest).not.toBe(b.accepted.digest);
  });

  it("保留 media / place / briefing 等可选内容，不因规范化而丢失", () => {
    const game = makeGame();
    game.scenes[0].media = [
      { id: "m1", kind: "document", title: "说明书", url: "https://example.com/a.pdf" },
    ];
    const result = validateSubmission(game);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roundTripped = JSON.parse(result.accepted.canonicalJson) as Game;
    expect(roundTripped.scenes[0].media?.[0]?.url).toBe("https://example.com/a.pdf");
    expect(roundTripped.scenes[0].place?.name).toBe("礼拜堂");
    expect(roundTripped.scenes[0].briefing).toBe("走到礼拜堂门口。");
  });

  it("0,0 占位坐标被升级为阻断错误（设计器里只是警告）", () => {
    const game = makeGame();
    game.scenes[1].location = { lat: 0, lng: 0, radius: 20 };
    const direct = validateSubmission(game);
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    expect(direct.status).toBe(422);
    expect(direct.issues.some((i) => i.severity === "error" && i.message.includes("占位坐标"))).toBe(true);
  });

  it("结构性错误（缺场景、断链）被拒绝", () => {
    const result = validateSubmission({ id: "broken", title: "坏包", scenes: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("非对象输入被拒绝", () => {
    for (const raw of [null, 42, "string", []]) {
      const result = validateSubmission(raw);
      expect(result.ok).toBe(false);
    }
  });

  it("非法游戏 id（会导致文件名逃逸）被拒绝", () => {
    const result = validateSubmission(makeGame({ id: "../evil" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === "id" && i.severity === "error")).toBe(true);
  });

  it("作者名在目录条目中被脱敏", () => {
    const result = validateSubmission(makeGame({ author: "张三丰" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted.catalogEntry.author).toBe("张三·");
  });

  it("canonicalizeGame 不修改入参对象", () => {
    const game = makeGame();
    const before = JSON.stringify(game);
    const copy = canonicalizeGame(game);
    (copy as { title: string }).title = "被改掉";
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe("发布令牌 - 签发与校验", () => {
  const accepted = (() => {
    const result = validateSubmission(makeGame());
    if (!result.ok) throw new Error("fixture 未通过校验");
    return result.accepted;
  })();

  it("正常签发后可以通过验签", () => {
    const token = issuePublishToken(accepted, SECRET, 1_000);
    const verified = verifyPublishToken(token, SECRET, 1_001);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.digest).toBe(accepted.digest);
    expect(verified.payload.gameId).toBe("cloud-loop-hunt");
  });

  it("令牌不携带游戏内容本身（只有摘要与元数据）", () => {
    const token = issuePublishToken(accepted, SECRET, 1_000);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect(Object.keys(payload).sort()).toEqual(["digest", "expiresAt", "gameId", "issuedAt", "sceneCount"]);
    expect(token).not.toContain("礼拜堂");
  });

  it("篡改载荷导致验签失败（401）", () => {
    const token = issuePublishToken(accepted, SECRET, 1_000);
    const [v, , sig] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ digest: "a".repeat(64), gameId: "x", sceneCount: 1, issuedAt: 1, expiresAt: 9_999_999_999 }),
    ).toString("base64url");
    const verified = verifyPublishToken(`${v}.${forgedPayload}.${sig}`, SECRET, 1_001);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.status).toBe(401);
  });

  it("用别的密钥签的令牌无效", () => {
    const token = issuePublishToken(accepted, "x".repeat(48), 1_000);
    const verified = verifyPublishToken(token, SECRET, 1_001);
    expect(verified.ok).toBe(false);
  });

  it("过期令牌返回 410，而不是笼统失败", () => {
    const token = issuePublishToken(accepted, SECRET, 1_000, 60);
    const verified = verifyPublishToken(token, SECRET, 1_061);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.status).toBe(410);
  });

  it("未配置密钥时一律 500（失败关闭，不发不可验证的令牌）", () => {
    const verified = verifyPublishToken("v1.abc.def", null, 0);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.status).toBe(500);
  });

  it("格式错误的令牌返回 400", () => {
    for (const bad of ["", "abc", "v2.abc.def", "v1.abc", "v1.."]) {
      const verified = verifyPublishToken(bad, SECRET, 0);
      expect(verified.ok).toBe(false);
      if (!verified.ok) expect(verified.status).toBe(400);
    }
  });
});

describe("审核闸门 - 直接发布必须始终关闭", () => {
  it("即使部署环境设置了旧的直接发布开关，也必须进入待审核草稿", () => {
    expect(directPublishEnabled({ MOS_CLOUD_ALLOW_DIRECT_PUBLISH: "1" })).toBe(false);
    expect(directPublishEnabled({})).toBe(false);
  });
});

describe("访问控制 - 未授权请求不能写入", () => {
  it("未配置发布密钥时返回 503，并明确说明未开通", () => {
    const auth = verifyPublisherAuth("Bearer anything", {});
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.status).toBe(503);
  });

  it("密钥过短（<16 位）视为未配置", () => {
    const auth = verifyPublisherAuth("Bearer short", { MOS_CLOUD_PUBLISH_KEY: "short" });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.status).toBe(503);
  });

  it("缺少 Authorization 头返回 401", () => {
    const auth = verifyPublisherAuth(null, { MOS_CLOUD_PUBLISH_KEY: PUBLISH_KEY });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.status).toBe(401);
  });

  it("错误的密钥返回 403", () => {
    const auth = verifyPublisherAuth("Bearer wrong-key-wrong-key", { MOS_CLOUD_PUBLISH_KEY: PUBLISH_KEY });
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.status).toBe(403);
  });

  it("正确的密钥（带或不带 Bearer 前缀）通过", () => {
    expect(verifyPublisherAuth(`Bearer ${PUBLISH_KEY}`, { MOS_CLOUD_PUBLISH_KEY: PUBLISH_KEY }).ok).toBe(true);
    expect(verifyPublisherAuth(PUBLISH_KEY, { MOS_CLOUD_PUBLISH_KEY: PUBLISH_KEY }).ok).toBe(true);
  });

  it("签名密钥过短视为未配置（避免弱密钥上线）", () => {
    expect(readPublishSecret({ MOS_CLOUD_PUBLISH_SECRET: "short" })).toBeNull();
    expect(readPublishSecret({ MOS_CLOUD_PUBLISH_SECRET: SECRET })).toBe(SECRET);
    expect(readPublishSecret({})).toBeNull();
  });
});

describe("请求体形状", () => {
  const game = makeGame();

  it("{ game } 包装会被解出内层（而不是整体当成游戏包）", () => {
    const result = extractGamePayload(JSON.stringify({ game }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.raw as Game).id).toBe(game.id);
  });

  it("裸游戏包原样通过", () => {
    const result = extractGamePayload(JSON.stringify(game));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.raw as Game).id).toBe(game.id);
  });

  it("game 字段不是对象时明确报错", () => {
    const result = extractGamePayload(JSON.stringify({ game: "nope" }));
    expect(result.ok).toBe(false);
  });

  it("非 JSON 明确报错", () => {
    expect(extractGamePayload("<html>").ok).toBe(false);
  });
});

describe("重复发布判定", () => {
  const catalog = [
    { id: "mine", packFile: "mine.json", title: "我的", status: "published" },
    { id: "theirs", packFile: "theirs-2026.json", title: "别人的", status: "published" },
  ];

  it("新 id 判定为 new", () => {
    expect(classifyDuplicate("brand-new", "brand-new.json", catalog).kind).toBe("new");
  });

  it("同 id 同文件判定为 republish（更新自己的游戏）", () => {
    expect(classifyDuplicate("mine", "mine.json", catalog).kind).toBe("republish");
  });

  it("同 id 但指向别的包文件判定为 id-taken（拒绝顶掉别人的 id）", () => {
    const verdict = classifyDuplicate("theirs", "theirs.json", catalog);
    expect(verdict.kind).toBe("id-taken");
  });
});

describe("请求体限制", () => {
  function request(text: string, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/cloud/games", {
      method: "POST",
      body: text,
      headers,
    });
  }

  it("正常体积可以直接读取", async () => {
    const result = await readLimitedBody(request('{"a":1}'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('{"a":1}');
  });

  it("声明超限时按 Content-Length 快速拒绝（413）", async () => {
    const result = await readLimitedBody(
      request("{}", { "content-length": String(MAX_REQUEST_BYTES + 1) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it("实际流超限时同样拒绝（413）", async () => {
    const big = "x".repeat(2048);
    const result = await readLimitedBody(request(big), 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it("空请求体返回 400", async () => {
    const result = await readLimitedBody(new Request("http://localhost/", { method: "POST" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("sha256Hex 稳定且能区分内容", () => {
    expect(sha256Hex("a")).toBe(sha256Hex("a"));
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});
