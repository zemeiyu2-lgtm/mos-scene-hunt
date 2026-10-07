export type CloudGameStatus = "published" | "draft" | "unlisted" | "archived";

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
      } catch {}
    }
    throw error instanceof Error ? error : new Error("无法读取云端游戏目录");
  }
}

export function publishedGames(catalog: CloudCatalog): CloudGameEntry[] {
  return catalog.games.filter((game) => game.status === "published");
}

export function packUrl(entry: CloudGameEntry): string {
  // The catalog is trusted platform data, but reject path traversal defensively.
  const file = entry.packFile.trim();
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(file)) {
    throw new Error("云端游戏包路径无效");
  }
  return `/content/${encodeURIComponent(file)}`;
}
