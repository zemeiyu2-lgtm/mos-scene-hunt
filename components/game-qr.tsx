"use client";

import { Component, useRef, type ReactNode } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { planQrForUrl } from "@/lib/content/qr";

/**
 * Local safety net: if the encoder ever throws for an input we accepted,
 * show the copy-link fallback instead of crashing the design page.
 */
class QrErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Share QR block for the design page.
 *
 * Renders the FULL share URL (always including the #hunt= payload - never a
 * truncated link or the site home page) whenever the density plan says a phone
 * camera can scan it. Otherwise shows the precise, actionable reason. The
 * canvas is rendered at 480 px and scaled responsively so it never overflows
 * the card on narrow phones; the downloaded PNG keeps the full 480 px
 * resolution.
 */
export function GameQr({
  url,
  fileNamePrefix,
  onMessage,
}: {
  url: string;
  fileNamePrefix: string;
  onMessage?: (message: string) => void;
}) {
  const plan = planQrForUrl(url);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!plan.ok) {
    return (
      <p className="mt-2 rounded-lg bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900" role="note">
        {plan.reason}
      </p>
    );
  }

  const downloadQrCode = () => {
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) {
      onMessage?.("二维码尚未准备好，请稍后重试。");
      return;
    }
    try {
      const link = document.createElement("a");
      link.download = `${fileNamePrefix}-二维码.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      onMessage?.("二维码 PNG 已生成；请在浏览器下载记录或文件中查看，需要时可再保存到相册。");
    } catch {
      onMessage?.("无法保存二维码图片，请尝试截图保存。");
    }
  };

  return (
    <QrErrorBoundary
      fallback={
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900" role="note">
          二维码生成时出现意外错误；分享链接不受影响，请直接复制链接发送。
        </p>
      }
    >
      <div ref={containerRef} className="mx-auto mt-3 flex w-full max-w-[480px] justify-center rounded-xl bg-white p-3">
        <QRCodeCanvas value={url} size={480} level="L" marginSize={2} style={{ width: "100%", height: "auto" }} />
      </div>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-[var(--muted)]">
        让朋友用手机相机或微信扫一扫。现场展示时请调亮屏幕，并保持二维码完整可见。
      </p>
      <button type="button" className="btn btn-primary btn-block mt-3" onClick={downloadQrCode}>
        下载二维码图片（PNG）
      </button>
    </QrErrorBoundary>
  );
}
