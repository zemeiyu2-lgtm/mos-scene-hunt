"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { importGamePackageChecked, markCurrentAuthoredGame } from "@/lib/content";
import { packUrl, type CloudGameEntry } from "@/lib/cloud";
import { safeReturnPath } from "@/lib/nav/safe-return";

/**
 * 开始探索 — the one primary action on the detail page.
 *
 * It hands over to the EXISTING play flow, unchanged: the pack is downloaded
 * from the same public content route `/games` uses (`packUrl`, which rejects any
 * file name that is not a bare `*.json`), installed into the local library with
 * the same `importGamePackageChecked`, marked as the active pack, and the router
 * navigates to `/select?game=<id>`. Nothing about GPS, unlocking, progress or the
 * map is touched here — if this button were removed, the old download path would
 * still work exactly as before.
 *
 * The pack file comes from the server's validated catalogue entry and is passed
 * through `packUrl()` rather than concatenated here, so the traversal guard is
 * the same one the cloud download path uses.
 *
 * `from` is only appended when it survives the allow-list; the value is never
 * forwarded raw.
 *
 * Failure modes stay visible instead of silently navigating:
 *  - a content conflict is shown, because overwriting a local pack could erase
 *    someone's progress;
 *  - a network failure offers a retry, not a dead button.
 */
export function StartExploreButton({
  gameId,
  title,
  packFile,
  fromPath,
  hasProgress = false,
}: {
  gameId: string;
  title: string;
  /** Catalogue pack file name, already validated server-side. */
  packFile: string;
  /** Where the player came from, so `/select` can return them there. */
  fromPath: string;
  hasProgress?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const entry: CloudGameEntry = {
        id: gameId,
        title,
        author: "",
        description: "",
        language: "zh-CN",
        sceneCount: 0,
        status: "published",
        packFile,
      };
      const response = await fetch(packUrl(entry), { cache: "no-cache" });
      if (!response.ok) throw new Error(`探索包读取失败（HTTP ${response.status}）`);
      const outcome = importGamePackageChecked(await response.text());
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      if (outcome.status === "conflict") {
        setError("本机已有同名但内容不同的探索包。为避免覆盖你的进度，未自动替换；请到创作中心处理后再试。");
        return;
      }
      const game = outcome.game;
      markCurrentAuthoredGame(game.id);
      // Return target: validated, or omitted entirely (then `/select` falls back
      // to browser history). Never the raw parameter.
      const safeFrom = safeReturnPath(fromPath);
      const query = `game=${encodeURIComponent(game.id)}`;
      router.push(safeFrom ? `/select?${query}&from=${encodeURIComponent(safeFrom)}` : `/select?${query}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "探索包读取失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-primary btn-block" onClick={() => void start()} disabled={busy}>
        {busy ? "正在准备…" : hasProgress ? "继续探索" : "开始探索"}
      </button>
      {error ? (
        <p className="mt-2 rounded-xl bg-[var(--err-bg)] px-3 py-2 text-[13px] leading-relaxed text-[var(--err-text)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
