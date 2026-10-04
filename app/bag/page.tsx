"use client";

/**
 * Bag screen (背包 tab).
 *
 * Collectibles on top, diagnostics below. The diagnostics block is not padding:
 * V0.1's acceptance depends on being able to verify GPS state, save state and
 * offline behaviour on a real phone, so the evidence lives on screen rather than
 * only in a console the tester cannot reach.
 */

import { useState } from "react";
import { useHunt } from "@/components/hunt-provider";
import { useGps } from "@/components/gps-provider";
import { useOnlineStatus, useSettings, useViewportWidth } from "@/components/providers";
import { Card, EmptyState, KV, Screen, StatusChip } from "@/components/ui";
import { SimulatorPanel, SimulatorUnavailableNotice } from "@/components/simulator-panel";
import { classifyFix, formatDistance } from "@/lib/location";
import { isPersistentStorageAvailable, saveSizeBytes } from "@/lib/storage";
import { TabBar } from "@/components/tab-bar";

const REWARD_LABEL: Record<string, string> = {
  keyword: "关键词",
  item: "物品",
  badge: "徽章",
  story: "故事碎片",
};

export default function BagPage() {
  const { game, state, statuses, distances, resetHunt, exportCurrentSave, importSaveText } =
    useHunt();
  const { fix, status: gpsStatus, permission, isSimulated } = useGps();
  const { settings, update } = useSettings();
  const online = useOnlineStatus();
  const viewportWidth = useViewportWidth();

  const [showReset, setShowReset] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (!game || !state) {
    return (
      <Screen title="背包">
        <div className="card h-40 animate-pulse" />
      </Screen>
    );
  }

  const quality = fix ? classifyFix(fix) : null;
  const completedCount = statuses.filter((s) => s.status === "completed").length;

  const exportSave = () => {
    const text = exportCurrentSave();
    if (!text) return;
    // Copy rather than download: on a phone, a copied blob is easier to move
    // into a bug report than a file in the Downloads folder.
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setImportMsg("存档已复制到剪贴板。"))
      .catch(() => setImportMsg("复制失败，请改为手动导出。"));
  };

  return (
    <>
    <Screen
      title="背包"
      subtitle={`${state.inventory.length} 件收获 · ${state.keywords.length} 个关键词`}
      headerRight={
        <span className="chip bg-[var(--surface)] text-[11px] text-[var(--muted)]">
          {completedCount}/{statuses.length}
        </span>
      }
    >
      {/* Keywords get their own treatment: they are the narrative currency. */}
      {state.keywords.length ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
            已收集关键词
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {state.keywords.map((word) => (
              <span
                key={word}
                className="rounded-xl bg-white px-3 py-1.5 text-[15px] font-bold text-amber-900 shadow-sm"
              >
                {word}
              </span>
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-amber-800">
            关键词会被后续情境引用。它们由确定性游戏逻辑发放，不会因为刷新页面而改变。
          </p>
        </Card>
      ) : null}

      <section className="mt-4">
        <h2 className="px-1 text-[13px] font-semibold text-[var(--muted)]">全部收获</h2>
        {state.inventory.length ? (
          <ul className="mt-2 space-y-2">
            {state.inventory.map((item) => (
              <li key={item.id}>
                <Card className="flex items-start gap-3 p-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface)] text-[19px]">
                    {item.icon ?? (item.type === "keyword" ? "🔑" : item.type === "badge" ? "🏅" : "◆")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14.5px] font-semibold leading-snug">{item.title}</p>
                      <span className="chip shrink-0 bg-[var(--surface)] text-[10.5px] text-[var(--muted)]">
                        {REWARD_LABEL[item.type] ?? item.type}
                      </span>
                    </div>
                    {item.description ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
                        {item.description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      来自「{game.scenes.find((s) => s.id === item.sceneId)?.title ?? item.sceneId}」
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <EmptyState
              title="背包还是空的"
              hint="走到第一个地点并完成任务，就会获得第一个关键词。"
            />
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Diagnostics                                                */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-5">
        <button
          type="button"
          className="card flex w-full items-center justify-between px-4 py-3"
          onClick={() => setShowDiagnostics((v) => !v)}
          aria-expanded={showDiagnostics}
        >
          <span className="text-[13px] font-semibold">设备与运行状态</span>
          <span className="text-[12px] text-[var(--muted)]">
            {showDiagnostics ? "收起 ▴" : "展开 ▾"}
          </span>
        </button>

        {showDiagnostics ? (
          <Card className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              定位
            </p>
            <KV k="GPS 状态" v={gpsStatus} />
            <KV k="权限" v={permission} />
            <KV k="来源" v={isSimulated ? "模拟器" : fix ? "真实设备" : "—"} />
            <KV k="定位质量" v={quality ? qualityLabel(quality.quality) : "—"} />
            <KV
              k="当前坐标"
              v={fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : "—"}
              mono
            />
            <KV k="精度" v={fix ? `±${Math.round(fix.accuracy)} m` : "—"} mono />
            {quality?.message ? (
              <p className="mt-1 text-[11.5px] leading-snug text-amber-700">{quality.message}</p>
            ) : null}

            <div className="my-3 h-px bg-[var(--line)]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              网络与存储
            </p>
            <KV k="网络" v={online ? "在线" : "离线"} />
            <KV k="本地存储" v={isPersistentStorageAvailable() ? "可用" : "不可用（内存模式）"} />
            <KV k="存档大小" v={`${saveSizeBytes()} B`} mono />
            <KV k="视口宽度" v={`${viewportWidth} px`} mono />

            <div className="my-3 h-px bg-[var(--line)]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              各地点距离
            </p>
            {statuses.map((row) => {
              const d = distances[row.scene.id];
              return (
                <KV
                  key={row.scene.id}
                  k={`${row.scene.title}`}
                  v={
                    <span className="inline-flex items-center gap-1.5">
                      <StatusChip status={row.status} />
                      <span className="tabular">
                        {d ? formatDistance(d.distance) : "—"}
                      </span>
                    </span>
                  }
                />
              );
            })}

            <div className="my-3 h-px bg-[var(--line)]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              偏好
            </p>
            <label className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12px]">允许精度补偿（更易触发）</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--accent)]"
                checked={settings.allowAccuracySlack}
                onChange={(e) => update({ allowAccuracySlack: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12px]">减少动画</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--accent)]"
                checked={settings.reduceMotion}
                onChange={(e) => update({ reduceMotion: e.target.checked })}
              />
            </label>

            <SimulatorUnavailableNotice />
          </Card>
        ) : null}
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Save management                                            */}
      {/* ---------------------------------------------------------- */}
      <section className="card mt-4 p-4">
        <p className="text-[13px] font-semibold">存档</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
          进度保存在本机浏览器中。刷新页面、切到后台再回来，进度都会保留。
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary h-9 min-h-0 px-3 text-[13px]"
            onClick={exportSave}
          >
            复制存档
          </button>
          <button
            type="button"
            className="btn btn-ghost h-9 min-h-0 px-3 text-[13px]"
            onClick={() => setShowReset((v) => !v)}
          >
            重置进度
          </button>
        </div>

        {importMsg ? (
          <p className="mt-2 text-[12px] text-[var(--muted)]">{importMsg}</p>
        ) : null}

        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-[var(--muted)]">
            从文本导入存档
          </summary>
          <textarea
            className="input mt-2 min-h-[100px] font-mono text-[11px]"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="粘贴导出的 JSON…"
          />
          <button
            type="button"
            className="btn btn-secondary mt-2 h-9 min-h-0 px-3 text-[13px]"
            onClick={() => {
              const ok = importSaveText(importText);
              setImportMsg(ok ? "导入成功。" : "导入失败：内容不是有效的存档。");
              if (ok) setImportText("");
            }}
          >
            导入
          </button>
        </details>

        {showReset ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-[12.5px] font-semibold text-red-800">
              ⚠️ 重置会清空全部进度
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-red-700">
              已完成的地点、全部关键词与奖励都会被删除，且无法恢复。此操作只影响本机存档。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn h-9 min-h-0 bg-red-600 px-3 text-[13px] text-white"
                onClick={() => {
                  resetHunt();
                  setShowReset(false);
                  setImportMsg("进度已重置。");
                }}
              >
                确认重置
              </button>
              <button
                type="button"
                className="btn btn-secondary h-9 min-h-0 px-3 text-[13px]"
                onClick={() => setShowReset(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {settings.simulatorEnabled ? (
        <p className="mt-3 text-center text-[11.5px] text-purple-700">
          GPS 模拟器已启用。可在「地图」页展开模拟器面板调整位置。
        </p>
      ) : null}
    </Screen>
      <TabBar />
    </>
  );
}

function qualityLabel(q: string): string {
  switch (q) {
    case "good":
      return "良好";
    case "fair":
      return "一般";
    case "poor":
      return "较差";
    case "stale":
      return "已过期";
    default:
      return q;
  }
}
