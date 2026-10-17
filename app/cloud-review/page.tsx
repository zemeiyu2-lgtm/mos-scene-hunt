"use client";

import { useState } from "react";

type Submission = {
  id: string;
  digest: string;
  title: string;
  author?: string;
  description?: string;
  language?: string;
  sceneCount?: number;
  receivedAt?: string;
  updatedAt?: string;
  packFile?: string;
};

export default function CloudReviewPage() {
  const [key, setKey] = useState("");
  const [items, setItems] = useState<Submission[]>([]);
  const [message, setMessage] = useState("输入审核密钥后，读取待审核清单。");
  const [busy, setBusy] = useState(false);

  async function loadQueue() {
    if (!key.trim()) {
      setMessage("请先输入审核密钥。");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/cloud/review", {
        headers: { Authorization: `Bearer ${key.trim()}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        setItems([]);
        setMessage(data.message ?? `读取失败（${response.status}）。`);
        return;
      }
      setItems(Array.isArray(data.games) ? data.games : []);
      setMessage(`读取完成：${Array.isArray(data.games) ? data.games.length : 0} 个待审核版本。`);
    } catch {
      setMessage("网络请求失败，请检查预览环境是否可访问。");
    } finally {
      setBusy(false);
    }
  }

  async function approve(item: Submission) {
    if (!key.trim()) return;
    const confirmed = window.confirm(`确认审核通过「${item.title}」？只有这一版摘要会被批准。`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await fetch("/api/cloud/review", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: item.id, digest: item.digest, decision: "approve" }),
      });
      const data = await response.json();
      setMessage(data.message ?? (response.ok ? "审核操作完成。" : `审核失败（${response.status}）。`));
      if (response.ok) await loadQueue();
    } catch {
      setMessage("审核请求失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">MOS SCENE HUNT · MAINTENANCE</p>
        <h1 className="text-2xl font-semibold">云端游戏审核</h1>
        <p className="text-sm text-muted-foreground">审核密钥只保存在当前页面内存中，不写入本地存储。请勿在公共设备上操作。</p>
      </header>

      <section className="space-y-3 rounded-xl border p-4">
        <label htmlFor="review-key" className="block text-sm font-medium">审核密钥</label>
        <input
          id="review-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          placeholder="输入 MOS_CLOUD_REVIEW_KEY"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={loadQueue} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? "处理中…" : "读取待审核清单"}
          </button>
          <a href="/games" className="rounded-lg border px-4 py-2 text-sm">查看玩家游戏目录</a>
        </div>
        <p role="status" className="text-sm text-muted-foreground">{message}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">待审核版本</h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">当前没有已加载的待审核项目。</p>
        ) : items.map((item) => (
          <article key={item.id + ":" + item.digest} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h3 className="font-semibold">{item.title || item.id}</h3>
                <p className="text-xs text-muted-foreground">ID：{item.id} · 场景数：{item.sceneCount ?? "未知"}</p>
                {item.author ? <p className="text-sm text-muted-foreground">作者：{item.author}</p> : null}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => approve(item)}
                className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >审核通过并发布</button>
            </div>
            {item.description ? <p className="text-sm">{item.description}</p> : null}
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">查看版本摘要</summary>
              <code className="mt-2 block break-all text-xs">{item.digest}</code>
            </details>
          </article>
        ))}
      </section>
    </main>
  );
}
