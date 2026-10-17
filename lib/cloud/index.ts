export type CloudGameStatus = "published" | "draft" | "unlisted" | "archived";

/**
 * 目录条目对**玩家**而言的可获取状态。
 *
 * 三态必须分清，否则「看得见」会被误当成「能下载」：
 *   - downloadable  已发布且包文件可取 → 显示下载按钮
 *   - unavailable   已发布但包不可取（文件缺失/被清理）→ 只读展示，不给下载入口
 *   - hidden        草稿 / 已下架 / 已归档 → 压根不展示
 *
 * 服务端目录已按同一规则过滤；这里再做一次是因为离线缓存可能比服务端旧。
 */
export type CloudAvailability = "downloadable" | "unavailable" | "hidden";

export interface CloudGameEntry {
  id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  estimatedMinutes?: number;
  difficulty?: "easy" | "medium" | "hard";
  sceneCount: number;
  status: CloudGameStatus;
  packFile: string;
}

export interface CloudCatalog {
  version: string;
  updatedAt: string;
  games: CloudGameEntry[];
}

const CATALOG_URL = "/content/cloud/catalog.json";
const CACHE_KEY = "mos-scene-hunt:cloud-catalog";

function validEntry(value: unknown): value is CloudGameEntry {
  if (!value || typeof value !== "object") return false;
  const x = value as Record<string, unknown>;
  return typeof x.id === "string" && typeof x.title === "string" &&
    typeof x.author === "string" && typeof x.description === "string" &&
    typeof x.language === "string" && typeof x.sceneCount === "number" &&
    typeof x.packFile === "string" &&
    ["published","draft","unlisted","archived"].includes(String(x.status));
}

function parseCatalog(raw: unknown): CloudCatalog {
  const x = raw as Record<string, unknown>;
  const games = Array.isArray(x?.games) ? x.games.filter(validEntry) : [];
  return {
    version: typeof x?.version === "string" ? x.version : "1.0",
    updatedAt: typeof x?.updatedAt === "string" ? x.updatedAt : "",
    games,
  };
}

export async function loadCloudCatalog(): Promise<CloudCatalog> {
  try {
    const response = await fetch(CATALOG_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = parseCatalog(await response.json());
    if (typeof window !== "undefined") {
      localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    }
    return catalog;
  } catch (error) {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) return parseCatalog(JSON.parse(cached));
      } catch {
        // A broken local cache must not hide the original catalog fetch error.
      }
    }
    throw error instanceof Error ? error : new Error("无法读取云端游戏目录");
  }
}

/** 玩家可见的条目：只有已发布状态才进入列表（草稿/下架/归档一律不可见）。 */
export function publishedGames(catalog: CloudCatalog): CloudGameEntry[] {
  return catalog.games.filter((game) => game.status === "published");
}

/**
 * 判断条目能否真正获取。
 *
 * `verifiedOnServer` 为 true 表示目录来自网络（服务端已确认包文件存在且 id 一致），
 * 此时已发布即视为可下载。为 false 表示来自离线缓存，缓存可能已经过期（例如游戏
 * 刚被下架），因此额外要求 packFile 通过安全校验——真正的失败会在下载时以 404 明确报出，
 * 不会静默变成「点了没反应」。
 */
export function cloudAvailability(
  entry: CloudGameEntry,
  verifiedOnServer: boolean,
): CloudAvailability {
  if (entry.status !== "published") return "hidden";
  if (verifiedOnServer) return "downloadable";
  return isSafePackFile(entry.packFile) ? "downloadable" : "unavailable";
}

/** 与 packUrl 使用同一套规则，避免「能显示却拼不出 URL」。 */
export function isSafePackFile(file: string): boolean {
  return typeof file === "string" && /^[a-zA-Z0-9._-]+\.json$/.test(file.trim()) && !file.includes("..");
}

export function packUrl(entry: CloudGameEntry): string {
  // The catalog is trusted platform data, but reject path traversal defensively.
  const file = entry.packFile.trim();
  if (!isSafePackFile(file)) {
    throw new Error("云端游戏包路径无效");
  }
  return `/content/${encodeURIComponent(file)}`;
}
