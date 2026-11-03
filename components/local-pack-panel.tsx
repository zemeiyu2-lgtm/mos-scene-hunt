"use client";

/**
 * 本机存储 — the one place that tells the truth about browser-local packs.
 *
 * Why the UI exists: on iOS Safari the authored library lives in localStorage,
 * which has a small fixed per-origin budget. When it runs out, saving fails and
 * the only obvious escape used to be "clear website data" - which destroys every
 * pack. This panel gives the author three things instead:
 *
 *   1. numbers - how many packs, how big each one is, how much of the browser's
 *      own (estimated) quota is used;
 *   2. a per-pack 「删除本地副本」 with a confirmation that names the pack and
 *      states that published games are untouched;
 *   3. advice - what to do when space is tight, instead of "空间不足".
 *
 * Numbers are never invented: when the browser does not implement
 * `navigator.storage.estimate()`, the quota line is replaced by an explanation
 * and the measured pack bytes are still shown.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatBytes } from "@/lib/storage/bytes";
import {
  deleteLocalPack,
  describeStoragePressure,
  estimateBrowserStorage,
  measureLocalPacks,
  reclaimDuplicatedCache,
  type BrowserStorageEstimate,
  type DeleteLocalPackResult,
  type LocalPackInfo,
  type LocalPackInventory,
} from "@/lib/storage/local-pack";

type OnlineState =
  | { status: "checking" }
  | { status: "published"; versionId: string | null }
  | { status: "not-published" }
  | { status: "unknown" };

const ONLINE_TIMEOUT_MS = 8000;

/**
 * Is this pack published on the server?
 *
 * `/api/games/<id>` answers exactly that: 200 + `X-Game-Version` for a published
 * game, 404 for one that was never published, 400 for an id that cannot be
 * published at all. Any other outcome (offline, 500) is reported as unknown -
 * guessing here would be the one thing that makes the panel untrustworthy.
 */
async function probeOnline(gameId: string, signal: AbortSignal): Promise<OnlineState> {
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    // We only need the status line and one header; drop the body (a pack can be
    // up to 256 KB) instead of downloading it just to throw it away.
    void response.body?.cancel();
    if (response.ok) {
      return { status: "published", versionId: response.headers.get("X-Game-Version") };
    }
    if (response.status === 404 || response.status === 400) return { status: "not-published" };
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

export interface LocalPackPanelProps {
  /** Heading text; the panel is reused on 创作中心 and 创作库. */
  title?: string;
  /** Whether the pack list starts expanded. */
  defaultOpen?: boolean;
  /** Extra per-pack buttons, rendered before 「删除本地副本」. */
  renderActions?: (pack: LocalPackInfo) => React.ReactNode;
  /** Called after a successful deletion, with the measured result. */
  onDeleted?: (result: Extract<DeleteLocalPackResult, { ok: true }>) => void;
  /** Bump to force a re-measure (e.g. after the editor saved a pack). */
  refreshKey?: number;
  className?: string;
}

export function LocalPackPanel({
  title = "本机存储",
  defaultOpen = true,
  renderActions,
  onDeleted,
  refreshKey = 0,
  className = "",
}: LocalPackPanelProps) {
  const [inventory, setInventory] = useState<LocalPackInventory | null>(null);
  const [estimate, setEstimate] = useState<BrowserStorageEstimate | null>(null);
  const [online, setOnline] = useState<Record<string, OnlineState>>({});
  const [open, setOpen] = useState(defaultOpen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);

  const refresh = useCallback(() => {
    setInventory(measureLocalPacks());
    void estimateBrowserStorage().then(setEstimate);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const packIds = useMemo(
    () => (inventory?.packs ?? []).map((pack) => pack.id).join("|"),
    [inventory],
  );

  // Online status is a network question, so it is asked once per pack list and
  // cancelled when the list changes or the panel unmounts.
  useEffect(() => {
    if (!packIds) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ONLINE_TIMEOUT_MS);
    const ids = packIds.split("|");
    let cancelled = false;
    setOnline(Object.fromEntries(ids.map((id) => [id, { status: "checking" } as OnlineState])));
    void Promise.all(
      ids.map(async (id) => [id, await probeOnline(id, controller.signal)] as const),
    ).then((entries) => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setOnline(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [packIds]);

  const remove = async (pack: LocalPackInfo) => {
    const publishedNote =
      online[pack.id]?.status === "published"
        ? "这个游戏已发布到线上：线上版本、分享链接和二维码都不会受影响，仍可正常打开。"
        : online[pack.id]?.status === "not-published"
          ? "这个游戏尚未发布到线上，删除本机副本后本机将不再有它；如已导出游戏包，可随时重新导入。"
          : "无法确认它是否已发布到线上；即使已发布，线上版本、分享链接和二维码也不会受影响。";
    const confirmed = window.confirm(
      `删除本机副本「${pack.title}」？\n\n` +
        `· 占用约 ${formatBytes(pack.bytes)}，删除后空间会立即释放。\n` +
        `· 只会删除这台设备当前浏览器里的副本，包括它的本机试玩进度。\n` +
        `· 其他本地游戏包不受影响。\n` +
        `· ${publishedNote}\n\n` +
        // 只承诺已经存在的途径：本机导入（/design 的导入）与云端游戏库下载
        // （仅目录内游戏）。发布到自己链接的游戏不一定在目录里，不能承诺。
        `如需再次使用，可以重新导入你导出的游戏包；如果它同时出现在「云端游戏库」里，也可以在那里重新下载。`,
    );
    if (!confirmed) return;

    setBusyId(pack.id);
    setMessage(null);
    try {
      const result = await deleteLocalPack(pack.id);
      if (!result.ok) {
        setMessage(`删除失败：${result.message} 本机副本仍然保留。`);
        return;
      }
      setMessage(
        `已删除本机副本「${result.title}」，释放约 ${formatBytes(result.freedBytes)}。` +
          (result.wasCurrent ? "当前试玩已切回官方示范内容。" : ""),
      );
      onDeleted?.(result);
    } catch (error) {
      setMessage(
        `删除失败：${error instanceof Error ? error.message : "未知原因"}。本机副本仍然保留。`,
      );
    } finally {
      setBusyId(null);
      refresh();
      setOnline((prev) => {
        const next = { ...prev };
        delete next[pack.id];
        return next;
      });
    }
  };

  const reclaim = async () => {
    setReclaiming(true);
    setMessage(null);
    try {
      const result = await reclaimDuplicatedCache();
      setMessage(
        result.removedIds.length > 0
          ? `已清理 ${result.removedIds.length} 份重复的离线缓存，释放约 ${formatBytes(result.freedBytes)}。游戏内容仍在 IndexedDB 与服务器上，不受影响。`
          : "没有发现重复的离线缓存，空间没有变化。",
      );
      refresh();
    } catch {
      setMessage("清理重复缓存失败，已保留原有数据。");
    } finally {
      setReclaiming(false);
    }
  };

  if (!inventory) {
    return (
      <section className={`card mt-4 p-4 ${className}`} id="local-storage">
        <p className="text-sm font-bold">📦 {title}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">正在读取本机存储……</p>
      </section>
    );
  }

  const pressure = estimate
    ? describeStoragePressure(inventory, estimate, formatBytes)
    : null;
  const packCount = inventory.packs.length;

  return (
    <section className={`card mt-4 p-4 ${className}`} id="local-storage">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">📦 {title}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">
            {inventory.storageAvailable
              ? packCount > 0
                ? `本地游戏包：${packCount} 个，占用约 ${formatBytes(inventory.totalBytes)}。`
                : "本机还没有保存的游戏包。"
              : "这个浏览器当前不允许本网站使用本机存储（可能是无痕浏览或存储被禁用），所以无法读取或保存本地游戏包。"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="btn btn-ghost min-h-9 px-2 text-xs" onClick={refresh}>
            刷新
          </button>
          {packCount > 0 ? (
            <button
              type="button"
              className="btn btn-ghost min-h-9 px-2 text-xs"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
            >
              {open ? "收起" : "明细"}
            </button>
          ) : null}
        </div>
      </div>

      {packCount > 0 && estimate && pressure ? (
        <div className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="font-semibold">
              {estimate.supported && estimate.usage !== null && estimate.quota !== null
                ? "浏览器额度（估算）"
                : "本机游戏包占用"}
            </span>
            <span className="tabular text-[var(--muted)]">
              {estimate.supported && estimate.usage !== null && estimate.quota !== null
                ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`
                : `${formatBytes(inventory.totalBytes)}`}
            </span>
          </div>
          {estimate.supported && pressure.ratio !== null ? (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
              <div
                className={`h-full rounded-full ${
                  pressure.level === "critical"
                    ? "bg-[var(--err-solid)]"
                    : pressure.level === "tight"
                      ? "bg-[var(--warn-solid)]"
                      : "bg-[var(--ok-solid)]"
                }`}
                style={{ width: `${Math.max(2, Math.round(pressure.ratio * 100))}%` }}
              />
            </div>
          ) : null}
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--muted)]">{pressure.note}</p>
          {estimate.persistedSupported ? (
            <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--muted)]">
              {estimate.persisted
                ? "浏览器已把本站存储标记为「持久」，但仍可能因系统空间紧张而被清理。"
                : "浏览器未把本站存储标记为「持久」：长期不打开本站时，系统有可能清理这些数据。建议重要游戏保留一份导出的游戏包。"}
            </p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p role="status" className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2 text-[11.5px] leading-relaxed">
          {message}
        </p>
      ) : null}

      {open && packCount > 0 ? (
        <div className="mt-3 grid gap-2">
          {inventory.packs.map((pack) => {
            const state = online[pack.id] ?? { status: "checking" as const };
            const mediaShare =
              pack.bytes > 0 ? Math.round((pack.embeddedMediaBytes / pack.bytes) * 100) : 0;
            return (
              <div key={pack.id} className="rounded-xl border border-[var(--line)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{pack.title}</p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      {pack.sceneCount} 个体验点 · 约 {formatBytes(pack.bytes)}
                      {pack.mediaCount > 0 ? ` · 内嵌素材 ${pack.mediaCount} 个（${mediaShare}%）` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {pack.isCurrent ? <span className="chip">当前</span> : null}
                    {state.status === "published" ? (
                      <span className="chip bg-[var(--ok-bg)] text-[var(--ok-text)]">线上已发布</span>
                    ) : state.status === "not-published" ? (
                      <span className="chip bg-[var(--surface)]">线上未发布</span>
                    ) : state.status === "unknown" ? (
                      <span className="chip bg-[var(--surface)]">线上状态未知</span>
                    ) : (
                      <span className="chip bg-[var(--surface)]">查询中…</span>
                    )}
                  </div>
                </div>

                {!pack.valid ? (
                  <p className="mt-2 rounded-lg bg-[var(--warn-bg)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--warn-text)]">
                    这条记录无法被读取为游戏（可能已损坏），但它仍占用空间，可以删除。
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {renderActions?.(pack)}
                  <button
                    type="button"
                    className="btn btn-ghost min-h-9 px-3 text-[12px] text-[var(--err-text)]"
                    onClick={() => void remove(pack)}
                    disabled={busyId === pack.id}
                  >
                    {busyId === pack.id ? "正在删除…" : "删除本地副本"}
                  </button>
                  {state.status === "published" && state.versionId ? (
                    <Link
                      href={`/select#cloud=${encodeURIComponent(pack.id)}.${state.versionId}`}
                      className="text-[11px] font-medium text-[var(--muted)] underline"
                    >
                      打开线上版本
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}

          <div className="rounded-xl bg-[var(--surface)] px-3 py-2">
            <p className="text-[10.5px] leading-relaxed text-[var(--muted)]">
              「删除本地副本」只影响这台设备上的浏览器存储，不会删除、下架或修改已发布到线上的游戏。
              线上状态以上方面板为准；网络不可用时显示「线上状态未知」，此时删除仍然只作用于本机。
            </p>
            <button
              type="button"
              className="btn btn-ghost mt-1 min-h-8 px-2 text-[11px]"
              onClick={() => void reclaim()}
              disabled={reclaiming}
            >
              {reclaiming ? "正在检查重复缓存…" : "清理重复的离线缓存"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
