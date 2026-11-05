"use client";

import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { planQrForUrl } from "@/lib/content/qr";
import { packHref } from "@/lib/explore/client";

/**
 * Share a pack by its public URL.
 *
 * The canonical link is `/explore/<gameId>` — the detail page — not the old
 * self-contained `#hunt=` payload. A public pack is readable by anyone, so a
 * short link is both safer (no content in the URL) and stable across versions.
 *
 * Copy is the primary action because it works in every browser; the native share
 * sheet is offered when the platform has one. The QR uses the platform's existing
 * density planner, so a phone camera can actually resolve it.
 */
export function SharePack({ gameId, title }: { gameId: string; title: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = origin ? `${origin}${packHref(gameId)}` : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const qrPlan = url ? planQrForUrl(url) : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard permissions are uneven; showing the URL beats failing silently.
      window.prompt("复制这个链接发送给朋友：", url);
    }
  };

  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title, text: `一起探索：${title}`, url });
    } catch {
      // The user dismissed the sheet — not an error worth reporting.
    }
  };

  return (
    <section className="card mt-4 p-4" aria-labelledby="share-pack-title">
      <h2 id="share-pack-title" className="text-[15px] font-bold">
        分享这个探索
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
        朋友打开链接会直接看到这一页，不需要先找到目录。
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
          {copied ? "已复制" : "复制链接"}
        </button>
        {canShare ? (
          <button type="button" className="btn btn-ghost" onClick={() => void share()}>
            系统分享
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setShowQr((v) => !v)}>
            {showQr ? "收起二维码" : "二维码"}
          </button>
        )}
      </div>
      {canShare ? (
        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => setShowQr((v) => !v)}>
          {showQr ? "收起二维码" : "显示二维码"}
        </button>
      ) : null}
      {showQr && qrPlan ? (
        qrPlan.ok ? (
          <div className="mt-3 rounded-xl bg-white p-3">
            <QRCodeCanvas
              value={url}
              size={480}
              level="L"
              marginSize={2}
              style={{ width: "100%", height: "auto" }}
            />
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-[var(--warn-bg)] p-3 text-[12px] leading-relaxed text-[var(--warn-text)]">
            {qrPlan.reason}
          </p>
        )
      ) : null}
      {url ? (
        <p className="mt-2 break-all text-[12px] leading-relaxed text-[var(--muted)]">{url}</p>
      ) : null}
    </section>
  );
}
