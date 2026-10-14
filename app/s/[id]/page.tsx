"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { importGamePackage } from "@/lib/content";

export default function SharedGamePage() {
  const params = useParams<{ id: string }>();
  const [message, setMessage] = useState("正在加载分享的游戏…");
  useEffect(() => {
    let cancelled = false;
    async function loadSharedGame() {
      try {
        const response = await fetch(`/api/shares/${encodeURIComponent(params.id)}`, { cache: "no-store", headers: { Accept: "application/json" } });
        const payload = await response.json() as { game?: unknown; error?: string };
        if (!response.ok || !payload.game) throw new Error(payload.error || "这份游戏不存在，或分享链接已失效。");
        importGamePackage(JSON.stringify(payload.game));
        if (!cancelled) window.location.replace("/select");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "加载失败，请检查链接或网络。");
      }
    }
    void loadSharedGame();
    return () => { cancelled = true; };
  }, [params.id]);
  return <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-5 py-12"><section className="card w-full p-5 text-center"><div className="text-3xl" aria-hidden="true">🧭</div><h1 className="mt-3 text-lg font-bold">MOS Scene Hunt</h1><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{message}</p>{message !== "正在加载分享的游戏…" ? <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">如果链接已经失效，请联系设计者重新发布，或请对方导出游戏包供你导入。</p> : null}</section></main>;
}
