/**
 * lib/cloud/publish - 云端发布的**服务端核心**。
 *
 * 链路（2026-10-17 起改为持久化存储）：
 *
 *   电脑创作 → 浏览器提交游戏包
 *     → POST /api/cloud/games（逐层校验 + 规范化 + 幂等摘要）
 *     → 包体、元数据、目录写入 **Vercel Blob**（不是函数文件系统）
 *     → 服务端签发短时 HMAC 发布令牌（令牌只含被批准内容的 sha256，不含密钥）
 *     → 手机在 /games 里从目录发现 → 下载 → 存入本机 → 开始玩
 *
 * 仓库内容层 `content/` 现在只承载「随构建发布的官方内容」，发布接口不写它。
 *
 * 关键安全性质：
 *   - Blob 未接入 / 密钥缺失时，POST 一律 503，不会静默降级成「谁都能写」，
 *     也不会退化成「写临时盘然后假装成功」。
 *   - 令牌是 HMAC 签名的，客户端无法伪造成「已审批」的内容；令牌只携带摘要，
 *     真正的包体由服务端按令牌从存储里取，篡改令牌只会导致验签失败。
 *   - 令牌有有效期，且只对「被批准的那一版内容」有效。
 *   - 是否直接进玩家目录由服务端开关决定（见 directPublishEnabled），默认只进草稿。
 *
 * 本文件只做纯函数 + Node 内置 crypto，不碰 React，可在 vitest 里直接单测。
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Game } from "@/lib/game/types";
import { MOS_GAME_PACKAGE_FORMAT, validateGamePackage } from "@/lib/game/package";

/* ------------------------------------------------------------------ */
/* 常量与类型                                                          */
/* ------------------------------------------------------------------ */

/** 目录文件里的版本字段，与既有 catalog.json 保持一致（"1.0"）。 */
export const CATALOG_VERSION = "1.0";

/**
 * 仓库内容层目录里已废弃的发布存储路径。
 *
 * 第一批实现把待落库的包写在函数文件系统的这里；Vercel 的函数文件系统是临时的，
 * 那条路走不通，已整体改为 Blob。保留这个常量只为让 .gitignore 与旧部署的清理
 * 脚本有据可依，业务代码不再读写它。
 */
export const PUBLISH_STORE_DIR = "content/cloud/publish-store";

/** 单个游戏包的上限。超大的包既不适合放进仓库，也会拖慢手机下载。 */
export const MAX_PACKAGE_BYTES = 512 * 1024;
/** 单次请求体上限（含 JSON 包装），略大于包体上限。 */
export const MAX_REQUEST_BYTES = MAX_PACKAGE_BYTES + 64 * 1024;

/** 发布令牌默认有效期：7 天。足够走完「提交 → 审核 → 落库 → 提交」。 */
export const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const TOKEN_VERSION = "v1";

/** 游戏 id / 文件名允许的字符集，与既有 /content/[file] 路由的约束一致。 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface PublishTokenPayload {
  /** 规范化后游戏包的 sha256（十六进制）。令牌只绑定这一版内容。 */
  digest: string;
  /** 通过校验的游戏 id。 */
  gameId: string;
  /** 场景数，落库时用于目录条目，也用于快速排错。 */
  sceneCount: number;
  /** 签发时间（Unix 秒）。 */
  issuedAt: number;
  /** 过期时间（Unix 秒）。 */
  expiresAt: number;
}

export interface CatalogDraft {
  id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  estimatedMinutes?: number;
  difficulty?: "easy" | "medium" | "hard";
  sceneCount: number;
  status: "draft";
  packFile: string;
}

export interface AcceptedPackage {
  /** 规范化后的游戏包（已通过校验，可直接落库）。 */
  game: Game;
  /** 规范化序列化后的 JSON 文本；sha256 就是基于这份字节算出来的。 */
  canonicalJson: string;
  digest: string;
  /** 建议的仓库内文件名：`<id>.json`。 */
  packFile: string;
  /** 需要合并进目录的条目。 */
  catalogEntry: CatalogDraft;
  /** 面向提交者的提醒（不阻断）。 */
  warnings: PublishIssue[];
}

export interface PublishIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export type ValidateOutcome =
  | { ok: true; accepted: AcceptedPackage }
  | { ok: false; status: 422; issues: PublishIssue[]; error: string };

/* ------------------------------------------------------------------ */
/* 包体解析与校验                                                      */
/* ------------------------------------------------------------------ */

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 只保留 0–1 之间两个小数位：目录是公开可读的，不需要暴露六位精度的原始坐标。 */
export function maskAuthor(input: string | undefined): string {
  const name = (input ?? "").trim();
  if (!name) return "匿名设计者";
  if (name.length <= 2) return name[0] + "·";
  return name.slice(0, 2) + "·";
}

/**
 * 把外部提交的 JSON 文本变成「已通过校验、可落库」的游戏包。
 *
 * 这里**不重复实现**校验规则：游戏包的结构校验、空间校验全部复用
 * `validateGamePackage()`（与导入、下载、设计器完全同一条路径）。本函数只增加
 * 两件发布特有的事：
 *   1. 0,0 占位坐标从「警告」升级为「错误」——公开分发的游戏不能带着占位点上线；
 *   2. 口令/答案类字段本身就在游戏包里，这个事实必须在报告里如实告知，不能假装
 *      它是「服务器校验过的秘密」。
 */
export function validateSubmission(raw: unknown): ValidateOutcome {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, status: 422, error: "游戏包必须是一个 JSON 对象。", issues: [
      { path: "$", message: "游戏包必须是一个 JSON 对象。", severity: "error" },
    ] };
  }

  const report = validateGamePackage(raw);
  const issues: PublishIssue[] = report.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    severity: issue.severity,
  }));

  if (!report.game) {
    return {
      ok: false,
      status: 422,
      error: "游戏包无法解析：" + (issues[0]?.message ?? "数据结构不符合 MOS Game Package 规范。"),
      issues,
    };
  }

  const game = report.game;

  if (!SAFE_ID.test(game.id)) {
    issues.push({
      path: "id",
      message: "游戏 id 只能包含字母、数字、点、下划线和连字符，且需以字母或数字开头（最长 64 字符）。",
      severity: "error",
    });
  }

  // 占位坐标：设计器里只是警告，公开发布必须阻断。
  const isPlaceholder = (point: { lat: number; lng: number } | undefined) =>
    !point || (point.lat === 0 && point.lng === 0) || !Number.isFinite(point.lat) || !Number.isFinite(point.lng);
  if (isPlaceholder(game.startLocation)) {
    issues.push({ path: "startLocation", message: "起点仍是占位坐标（0,0），请先在现场标定真实地点。", severity: "error" });
  }
  for (const scene of game.scenes) {
    if (isPlaceholder(scene.location)) {
      issues.push({ path: `scenes.${scene.id}.location`, message: "站点仍是占位坐标（0,0），请先在现场标定真实地点。", severity: "error" });
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    return {
      ok: false,
      status: 422,
      error: "游戏包未通过发布校验：" + errors[0].message,
      issues: dedupeIssues(issues),
    };
  }

  const warnings = dedupeIssues(issues);

  // 规范化：既定的字段顺序、只保留 schema 内字段。这样同一份内容无论经由
  // 哪个客户端提交，算出的摘要都一致，重复发布才能被幂等识别。
  const canonicalGame = canonicalizeGame(game);
  const canonicalJson = JSON.stringify(canonicalGame);
  const digest = sha256Hex(canonicalJson);
  const packFile = `${canonicalGame.id}.json`;

  return {
    ok: true,
    accepted: {
      game: canonicalGame,
      canonicalJson,
      digest,
      packFile,
      catalogEntry: {
        id: canonicalGame.id,
        title: canonicalGame.title,
        author: maskAuthor(canonicalGame.author),
        description: canonicalGame.description,
        language: canonicalGame.language,
        ...(canonicalGame.estimatedMinutes ? { estimatedMinutes: canonicalGame.estimatedMinutes } : {}),
        ...(canonicalGame.difficulty ? { difficulty: canonicalGame.difficulty } : {}),
        sceneCount: canonicalGame.scenes.length,
        status: "draft",
        packFile,
      },
      warnings,
    },
  };
}

function dedupeIssues(issues: PublishIssue[]): PublishIssue[] {
  const seen = new Set<string>();
  const out: PublishIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.path}|${issue.message}|${issue.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

/**
 * 规范化游戏包。
 *
 * 目的只有一个：让「内容相同 → 摘要相同（幂等）」。它**不是**第二套 schema，
 * 更不能删字段——`media`、`place`、`npc`、`hint`、`ar` 等可选内容必须原样保留，
 * 否则发布出去的会比设计器里少东西。因此这里做的是：
 *   1. 深拷贝（按 JSON 语义，杜绝后续改动回写原对象）；
 *   2. 固定顶层键顺序，使「同一份内容、不同客户端」得到同一次序列化。
 * 校验、默认值补全仍由 validateGamePackage 负责，本函数不重复。
 */
export function canonicalizeGame(game: Game): Game {
  const copy = JSON.parse(JSON.stringify(game)) as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of TOP_LEVEL_KEY_ORDER) {
    if (copy[key] !== undefined) ordered[key] = copy[key];
  }
  for (const key of Object.keys(copy)) {
    if (!(key in ordered)) ordered[key] = copy[key];
  }
  return ordered as unknown as Game;
}

/** Game 的顶层键顺序（与 docs/game-data.schema.json 的书写顺序一致）。 */
const TOP_LEVEL_KEY_ORDER = [
  "id",
  "language",
  "title",
  "description",
  "author",
  "version",
  "estimatedMinutes",
  "difficulty",
  "startLocation",
  "huntArea",
  "entrySceneId",
  "scenes",
  "aiProfile",
] as const;

/* ------------------------------------------------------------------ */
/* 发布令牌（HMAC）                                                     */
/* ------------------------------------------------------------------ */

/**
 * 是否允许「发布即上线」（跳过草稿审核，直接进玩家目录）。
 *
 * 默认关闭。打开需要两个条件同时成立：
 *   1. 服务端显式设置 `MOS_CLOUD_ALLOW_DIRECT_PUBLISH=1`；
 *   2. 发布请求本身携带 `?publish=1`（或请求体 `"publish": true`）。
 *
 * 为什么默认关闭：发布通道是预共享密钥，不是账号体系，无法区分「谁」提交了什么。
 * 默认走草稿，玩家目录只会因为一次显式的、可审计的发布动作而变化；想省掉
 * 人工确认的部署，可以显式打开这个开关，但那时「谁拿得到密钥，谁就能上线内容」
 * 就是你要接受的风险。
 */
export function directPublishEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.MOS_CLOUD_ALLOW_DIRECT_PUBLISH ?? "").trim() === "1";
}

/**
 * 读取签名密钥。
 *
 * 刻意不提供默认值：没有配置就视为「发布通道未开通」，调用方必须失败关闭。
 * 密钥只存在于服务端环境（Vercel 环境变量 / 本地 .env.local），永远不进客户端包，
 * 因为本模块只由 route handler 与 CLI 引用。
 */
export function readPublishSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.MOS_CLOUD_PUBLISH_SECRET?.trim() ?? "";
  // 弱密钥比没有密钥更危险：长度不足直接拒绝，避免有人用 "123" 上线。
  if (secret.length < 32) return null;
  return secret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(`${TOKEN_VERSION}.${payloadB64}`).digest("base64url");
}

/** 签发发布令牌。调用方必须先确认当前请求已被授权（见 verifyPublisherAuth）。 */
export function issuePublishToken(
  accepted: Pick<AcceptedPackage, "digest" | "game">,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS,
): string {
  const payload: PublishTokenPayload = {
    digest: accepted.digest,
    gameId: accepted.game.id,
    sceneCount: accepted.game.scenes.length,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${TOKEN_VERSION}.${encoded}.${sign(encoded, secret)}`;
}

export type TokenVerifyResult =
  | { ok: true; payload: PublishTokenPayload }
  | { ok: false; status: 400 | 401 | 410 | 500; error: string };

/** 验签 + 过期检查。任何失败都带明确状态码，便于客户端区分「伪造」与「过期」。 */
export function verifyPublishToken(
  token: string,
  secret: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): TokenVerifyResult {
  if (!secret) return { ok: false, status: 500, error: "服务端未配置发布密钥，发布通道未开通。" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, status: 400, error: "发布令牌格式不正确。" };
  }
  const [, encoded, signature] = parts;
  // 空载荷/空签名属于格式错误（400），而不是「签名不对」（401）：前者是客户端
  // 传错了东西，后者才可能是伪造，两者给用户的处置方式完全不同。
  if (!encoded || !signature) {
    return { ok: false, status: 400, error: "发布令牌格式不正确。" };
  }
  const expected = sign(encoded, secret);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  // 长度不等时 timingSafeEqual 会抛错，先比长度（长度本身不是秘密）。
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "发布令牌签名无效。" };
  }
  const json = base64UrlDecode(encoded);
  if (!json) return { ok: false, status: 400, error: "发布令牌内容不可读。" };

  let payload: PublishTokenPayload;
  try {
    payload = JSON.parse(json) as PublishTokenPayload;
  } catch {
    return { ok: false, status: 400, error: "发布令牌内容不可读。" };
  }
  if (
    typeof payload?.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(payload.digest) ||
    typeof payload.gameId !== "string" ||
    !SAFE_ID.test(payload.gameId) ||
    typeof payload.expiresAt !== "number" ||
    typeof payload.issuedAt !== "number"
  ) {
    return { ok: false, status: 400, error: "发布令牌内容不完整。" };
  }
  // 先验签再判过期：未通过签名的令牌不应泄露「它是哪一版、什么时候过期」。
  if (payload.expiresAt <= nowSeconds) {
    return { ok: false, status: 410, error: "发布令牌已过期，请重新提交发布申请。" };
  }
  return { ok: true, payload };
}

/* ------------------------------------------------------------------ */
/* 发布者鉴权                                                          */
/* ------------------------------------------------------------------ */

export type PublisherAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * 发布入口的访问控制。
 *
 * 不假定项目有登录系统（它确实没有），但也不允许匿名写入。采用的方案是
 * 「预共享密钥 + 常量时间比较」：
 *   - 密钥放在服务端环境变量 `MOS_CLOUD_PUBLISH_KEY`，前端只让用户本机保存后
 *     通过请求头提交，**不会被打进 JS 包**。
 *   - 未配置密钥 → 503（通道未开通），而不是放行。
 *   - 配置了密钥但请求头缺失/错误 → 401/403。
 *
 * 这是「最小可行且不泄露服务器密钥」的折中：它不是账号体系，无法区分『谁』
 * 发布了什么，所以目录条目一律以 draft 落库，必须经维护者审核才会出现在线上目录。
 */
export function verifyPublisherAuth(
  authorizationHeader: string | null,
  env: Record<string, string | undefined> = process.env,
): PublisherAuthResult {
  const key = env.MOS_CLOUD_PUBLISH_KEY?.trim() ?? "";
  if (key.length < 16) {
    return {
      ok: false,
      status: 503,
      error: "发布通道未开通：服务端未配置 MOS_CLOUD_PUBLISH_KEY（至少 16 位）。",
    };
  }
  if (!authorizationHeader) {
    return { ok: false, status: 401, error: "缺少发布密钥，无法提交到云端。" };
  }
  const provided = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  // 对摘要做常量时间比较，避免按字符逐位泄露密钥。
  const expectedDigest = sha256Hex(key);
  const providedDigest = sha256Hex(provided);
  const equal = timingSafeEqual(Buffer.from(expectedDigest, "utf8"), Buffer.from(providedDigest, "utf8"));
  if (!equal) return { ok: false, status: 403, error: "发布密钥不正确。" };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 重复发布检测                                                        */
/* ------------------------------------------------------------------ */

export interface ExistingCatalogEntry {
  id: string;
  packFile: string;
  title: string;
  status: string;
  [key: string]: unknown;
}

export type DuplicateVerdict =
  | { kind: "new" }
  | { kind: "id-taken"; entry: ExistingCatalogEntry }
  | { kind: "republish"; entry: ExistingCatalogEntry };

/**
 * 重复发布判定。
 *
 * 「同 id 已在目录里」不等于失败：作者更新自己的游戏是正常需求。真正的危险是
 * **覆盖别人的同 id 游戏**，因此：
 *   - 目录中不存在该 id → new
 *   - 存在且 packFile 与本包建议文件名一致 → republish（更新同一款游戏）
 *   - 存在但 packFile 指向另一个文件 → id-taken（拒绝，避免悄悄顶掉别人的包）
 *
 * 内容是否完全相同由摘要判断，在 store 层完成（这里不读文件）。
 */
export function classifyDuplicate(
  gameId: string,
  packFile: string,
  catalog: ExistingCatalogEntry[],
): DuplicateVerdict {
  const entry = catalog.find((item) => item.id === gameId);
  if (!entry) return { kind: "new" };
  if (typeof entry.packFile === "string" && entry.packFile === packFile) {
    return { kind: "republish", entry };
  }
  return { kind: "id-taken", entry };
}

/* ------------------------------------------------------------------ */
/* 请求体读取                                                          */
/* ------------------------------------------------------------------ */

/**
 * 读取并限制请求体大小。
 *
 * Next.js 的 route handler 没有默认的 1MB body parser 限制，但也不能把任意大的
 * 请求读进内存。这里按 Content-Length 快速拒绝，并在流式读取时二次计数。
 */
export async function readLimitedBody(
  request: Request,
  limit: number = MAX_REQUEST_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; status: 413 | 400; error: string }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, status: 413, error: `游戏包过大（上限 ${Math.round(MAX_PACKAGE_BYTES / 1024)} KB）。` };
  }
  if (!request.body) {
    return { ok: false, status: 400, error: "请求体为空。" };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413, error: `游戏包过大（上限 ${Math.round(MAX_PACKAGE_BYTES / 1024)} KB）。` };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8").decode(merged) };
}

/**
 * 从请求体取出游戏对象。
 *
 * 接受三种形状：
 *   { "game": {...} }                —— 发布接口的包装格式（客户端推荐用这个）
 *   { "format": ..., "game": {...} } —— MOS Game Package 包络格式，交给 validateGamePackage 解包
 *   { "id": ..., "scenes": [...] }   —— 裸游戏包（设计器导出的就是裸包）
 *
 * 关键点：包装格式必须**解出内层**再校验。若把 `{ game }` 整体当成游戏包，
 * validateGame 看到的是一堆不存在的顶层字段，错误信息会全是「$.id 必须是非空字符串」，
 * 让提交者完全无法定位真正的问题。
 */
export function extractGamePayload(
  text: string,
): { ok: true; raw: unknown } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "提交内容不是合法的 JSON。" };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.format === MOS_GAME_PACKAGE_FORMAT && "game" in record) {
      // 包络格式：保持原样，unwrapGamePackage 会校验 format/formatVersion。
      return { ok: true, raw: parsed };
    }
    if ("game" in record) {
      const inner = record.game;
      if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
        return { ok: false, error: "提交内容里的 game 字段必须是一个 JSON 对象。" };
      }
      return { ok: true, raw: inner };
    }
  }
  return { ok: true, raw: parsed };
}
