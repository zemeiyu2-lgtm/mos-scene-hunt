import type { Game } from "@/lib/game/types";
import { validateGame } from "@/lib/game/types";

const PREFIX = "#hunt=";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function gzipText(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    // Some embedded webviews expose CompressionStream but lack Blob.stream().
    // Treat partial implementations as unavailable and use the JSON fallback.
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzipText(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const safeBytes = new Uint8Array(bytes.length);
    safeBytes.set(bytes);
    const stream = new Blob([safeBytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

/** Creates a self-contained share fragment. No account or server storage is required. */
export async function createGameShareUrl(game: Game): Promise<string> {
  if (typeof window === "undefined") throw new Error("分享链接只能在浏览器中生成");
  const raw = JSON.stringify(game);
  const compressed = await gzipText(raw);
  const payload = compressed ? "g." + toBase64Url(compressed) : "j." + toBase64Url(new TextEncoder().encode(raw));
  return window.location.origin + "/select" + PREFIX + payload;
}

/**
 * Reads a self-contained shared game from the current URL, if present.
 * Convenience wrapper around {@link readSharedGameOutcome} for callers that
 * only need the game (or null).
 */
export async function readSharedGameFromUrl(): Promise<Game | null> {
  const outcome = await readSharedGameOutcome();
  return outcome.status === "ok" ? outcome.game : null;
}

/** Synchronous check: does the current URL carry a share payload at all? */
export function hasSharePayload(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location?.hash;
  return typeof hash === "string" && hash.startsWith(PREFIX);
}

export type SharedGameOutcome =
  | { status: "ok"; game: Game }
  | { status: "absent" }
  | { status: "broken"; reason: string };

/**
 * Reads the share payload and reports WHY it failed when it does.
 *
 * The silent-null behaviour of `readSharedGameFromUrl` hid real failures from
 * recipients: a link truncated by forwarding, or a webview without
 * DecompressionStream, fell back to the demo game with no explanation - it
 * looked like the author had shared the wrong game. Callers that surface UI
 * (the /select briefing) should use this and show the reason.
 */
export async function readSharedGameOutcome(): Promise<SharedGameOutcome> {
  if (typeof window === "undefined") return { status: "absent" };
  // Test harnesses, embedded webviews, or restricted browser contexts may expose
  // a partial window object without a location. That means there is no shared URL.
  const hash = window.location?.hash;
  if (typeof hash !== "string" || !hash.startsWith(PREFIX)) return { status: "absent" };
  try {
    const payload = hash.slice(PREFIX.length);
    const dot = payload.indexOf(".");
    if (dot <= 0) {
      return { status: "broken", reason: "链接中的游戏数据不完整（可能在复制或转发时被截断）。" };
    }
    const kind = payload.slice(0, dot);
    const encoded = payload.slice(dot + 1);
    if (!encoded || (kind !== "g" && kind !== "j")) {
      return { status: "broken", reason: "链接中的游戏数据格式无法识别（可能不完整或已损坏）。" };
    }
    if (kind === "g" && typeof DecompressionStream === "undefined") {
      return {
        status: "broken",
        reason: "当前浏览器不支持解压分享数据。请用手机 Safari（iOS）或更新微信/浏览器后重新打开。",
      };
    }
    const bytes = fromBase64Url(encoded);
    const raw = kind === "g" ? await gunzipText(bytes) : new TextDecoder().decode(bytes);
    if (!raw) {
      return { status: "broken", reason: "链接中的游戏数据无法解压，可能已被截断。请让朋友重新发送完整链接。" };
    }
    // validateGame throws GameDataError for invalid packs; the catch below
    // turns that into a readable "broken" reason instead of a silent fallback.
    const game = validateGame(JSON.parse(raw)).game;
    return { status: "ok", game };
  } catch {
    return { status: "broken", reason: "链接中的游戏数据无法读取（可能不完整或已损坏）。请让朋友重新发送完整链接。" };
  }
}
