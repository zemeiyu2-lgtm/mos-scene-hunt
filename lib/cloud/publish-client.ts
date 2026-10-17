"use client";

/**
 * lib/cloud/publish-client - 浏览器侧的「发布到云端」客户端。
 *
 * 只做两件事：
 *   1. 把设计器里的当前游戏提交到 `/api/cloud/games`（POST）；
 *   2. 把返回的凭据（令牌 + 获取路径）变成可复制/可扫码的完整 URL。
 *
 * 刻意不做的事：
 *   - 不在浏览器里做任何授权判断（那是服务端的事，客户端判断只是 UX 提示）；
 *   - 不缓存发布密钥到任何会被同步的地方——只放 localStorage，且由用户显式
 *     填写、可一键清除。它不是「账号」，只是这台设备访问发布通道的钥匙。
 *
 * 发布状态说明（必须让设计者看到）：提交成功 ≠ 玩家能在游戏中心看到。
 * 线上目录来自仓库提交，必须由维护者落库 + 重新部署才会对玩家生效。
 */

export type PublishPhase =
  | "idle"
  | "submitting"
  | "accepted"
  | "rejected"
  | "unauthorized"
  | "disabled"
  | "offline";

export interface PublishIssueView {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface PublishAccepted {
  phase: "accepted";
  game: { id: string; title: string; version: string; sceneCount: number; packFile: string };
  digest: string;
  token: string;
  /** 完整 URL（已按当前站点 origin 拼好），供复制与二维码使用。 */
  retrievalUrl: string;
  unchanged: boolean;
  duplicate: "new" | "republish";
  warningCount: number;
  warnings: PublishIssueView[];
  message: string;
  nextStep: string;
}

export interface PublishFailure {
  phase: Exclude<PublishPhase, "idle" | "submitting" | "accepted">;
  message: string;
  issues: PublishIssueView[];
  /** 服务端给出的具体状态码，便于排查。 */
  status: number;
  conflict?: { id: string; packFile: string; title: string };
}

export type PublishResult = PublishAccepted | PublishFailure;

const PUBLISH_KEY_STORAGE = "mos-scene-hunt:cloud-publish-key";

/**
 * 发布密钥只保存在本机浏览器。
 *
 * 存下来的是「用户自己粘贴的共享密钥」，不是服务器密钥：服务器只保存它的
 * 环境变量副本，两者相同才代表有写权限。清除后设备就失去发布能力。
 */
export function readPublishKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PUBLISH_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function savePublishKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    if (key.trim()) window.localStorage.setItem(PUBLISH_KEY_STORAGE, key.trim());
    else window.localStorage.removeItem(PUBLISH_KEY_STORAGE);
  } catch {
    /* 存储被禁用时发布仍可用（本次手动输入），只是不会记住。 */
  }
}

/** 把接口返回的 retrievalPath 变成当前站点下的完整 URL。 */
export function toAbsoluteRetrievalUrl(retrievalPath: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return new URL(retrievalPath, base || "http://localhost").toString();
}

/** 读取接口错误体中的 message / issues，兼容非 JSON（例如托管平台的 HTML 错误页）。 */
function parseErrorBody(text: string, status: number): { message: string; issues: PublishIssueView[]; conflict?: PublishFailure["conflict"] } {
  try {
    const body = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      issues?: unknown;
      conflict?: PublishFailure["conflict"];
    };
    const issues = Array.isArray(body.issues)
      ? body.issues
          .filter((item): item is { path?: unknown; message?: unknown; severity?: unknown } =>
            Boolean(item && typeof item === "object"))
          .map((item) => ({
            path: typeof item.path === "string" ? item.path : "$",
            message: typeof item.message === "string" ? item.message : "",
            severity: item.severity === "warning" ? ("warning" as const) : ("error" as const),
          }))
      : [];
    const message =
      typeof body.message === "string" && body.message
        ? body.message
        : `服务器返回 HTTP ${status}。`;
    return { message, issues, conflict: body.conflict };
  } catch {
    // 托管平台（网关/部署保护）返回 HTML 时，不要把它整页塞给设计者。
    const trimmed = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      message: `服务器返回 HTTP ${status}${trimmed ? "：" + trimmed : ""}`,
      issues: [],
    };
  }
}

export interface PublishOptions {
  /** 发布密钥（用户本机填写）。空字符串会在服务端得到 401。 */
  key: string;
  /** 自定义站点根地址，默认当前 origin。 */
  origin?: string;
  /** 测试可注入 fetch。 */
  fetchImpl?: typeof fetch;
}

/**
 * 提交游戏包到云端发布通道。
 *
 * 失败分层返回，而不是抛异常：调用方需要区分「未联网 / 未开权限 / 包不合法」
 * 三种完全不同的处置方式（重试、去要密钥、回设计器改内容）。
 */
export async function submitGameForPublish(game: unknown, options: PublishOptions): Promise<PublishResult> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch("/api/cloud/games", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
      },
      body: JSON.stringify({ game }),
      cache: "no-store",
    });
  } catch (error) {
    return {
      phase: "offline",
      status: 0,
      message:
        "无法连接云端发布接口：" +
        (error instanceof Error ? error.message : String(error)) +
        "。请检查网络或当前部署是否包含本接口。",
      issues: [],
    };
  }

  const text = await response.text();

  if (!response.ok) {
    const parsed = parseErrorBody(text, response.status);
    const phase: PublishFailure["phase"] =
      response.status === 401 || response.status === 403
        ? "unauthorized"
        : response.status === 503
          ? "disabled"
          : "rejected";
    return {
      phase,
      status: response.status,
      message: parsed.message,
      issues: parsed.issues,
      conflict: parsed.conflict,
    };
  }

  let body: {
    game?: PublishAccepted["game"];
    digest?: string;
    token?: string;
    retrievalPath?: string;
    unchanged?: boolean;
    duplicate?: "new" | "republish";
    warningCount?: number;
    warnings?: PublishIssueView[];
    message?: string;
    nextStep?: string;
  };
  try {
    body = JSON.parse(text);
  } catch {
    return {
      phase: "rejected",
      status: response.status,
      message: "服务器返回了无法解析的响应，请稍后重试。",
      issues: [],
    };
  }
  if (!body.token || !body.retrievalPath || !body.game) {
    return {
      phase: "rejected",
      status: response.status,
      message: "服务器响应缺少发布凭据，已中止。",
      issues: [],
    };
  }

  return {
    phase: "accepted",
    game: body.game,
    digest: body.digest ?? "",
    token: body.token,
    retrievalUrl: toAbsoluteRetrievalUrl(body.retrievalPath, options.origin),
    unchanged: Boolean(body.unchanged),
    duplicate: body.duplicate === "republish" ? "republish" : "new",
    warningCount: body.warningCount ?? 0,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    message: body.message ?? "游戏包已通过校验。",
    nextStep: body.nextStep ?? "",
  };
}

/**
 * 发布状态的四句话说明。
 *
 * 这四句是本功能的核心诚实性要求：设计者必须知道「已提交」和「玩家能下载」
 * 之间还差一次落库与部署，否则会在现场发现手机上空无一物。
 */
export const PUBLISH_STATUS_EXPLAINER = [
  "① 提交：这里把游戏包送到云端发布通道，服务端逐层校验并返回发布凭据。",
  "② 落库：维护者用 `npm run cloud:publish -- <凭据链接>` 把包写进 content/，目录状态默认 draft。",
  "③ 部署：改动提交到功能分支 → 通过 PR 合并 → 托管平台为新提交生成部署。",
  "④ 玩家可见：目录条目改为 published 后，手机游戏中心才会列出这款游戏。",
] as const;
