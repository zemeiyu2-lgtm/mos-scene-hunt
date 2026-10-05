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
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipText(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const safeBytes = new Uint8Array(bytes.length);
  safeBytes.set(bytes);
  const stream = new Blob([safeBytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Creates a self-contained share fragment. No account or server storage is required. */
export async function createGameShareUrl(game: Game): Promise<string> {
  if (typeof window === "undefined") throw new Error("分享链接只能在浏览器中生成");
  const raw = JSON.stringify(game);
  const compressed = await gzipText(raw);
  const payload = compressed ? "g." + toBase64Url(compressed) : "j." + toBase64Url(new TextEncoder().encode(raw));
  return window.location.origin + "/select" + PREFIX + payload;
}

/** Reads a self-contained shared game from the current URL, if present. */
export async function readSharedGameFromUrl(): Promise<Game | null> {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const payload = hash.slice(PREFIX.length);
    const [kind, encoded] = payload.split(".");
    if (!encoded || (kind !== "g" && kind !== "j")) return null;
    const bytes = fromBase64Url(encoded);
    const raw = kind === "g" ? await gunzipText(bytes) : new TextDecoder().decode(bytes);
    if (!raw) return null;
    return validateGame(JSON.parse(raw)).game;
  } catch {
    return null;
  }
}
