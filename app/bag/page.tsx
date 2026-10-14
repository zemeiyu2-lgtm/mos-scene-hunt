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
import { useUiLocale } from "@/components/ui-locale-provider";

const REWARD_LABEL: Record<string, "bag.rewardKeyword" | "bag.rewardItem" | "bag.rewardBadge" | "bag.rewardStory"> = {
  keyword: "bag.rewardKeyword",
  item: "bag.rewardItem",
  badge: "bag.rewardBadge",
  story: "bag.rewardStory",
};

export default function BagPage() {
  const { t } = useUiLocale();
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
      <Screen title={t("bag.title")}>
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
      .then(() => setImportMsg(t("bag.saveCopied")))
      .catch(() => setImportMsg(t("bag.copyFailed")));
  };

  return (
    <>
    <Screen
      title={t("bag.title")}
      subtitle={`${state.inventory.length} ${t("bag.items")} · ${state.keywords.length} ${t("bag.keywordsCount")}`}
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
            {t("bag.collectedKeywords")}
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
            {t("bag.keywordExplanation")}
          </p>
        </Card>
      ) : null}

      <section className="mt-4 bag-findings-section">
        <h2 className="px-1 text-[13px] font-semibold text-[var(--muted)]">{t("bag.allFindings")}</h2>
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
                        {t(REWARD_LABEL[item.type] ?? "bag.rewardOther")}
                      </span>
                    </div>
                    {item.description ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
                        {item.description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      {t("bag.from")}「{game.scenes.find((s) => s.id === item.sceneId)?.title ?? item.sceneId}」
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <EmptyState
              title={t("bag.emptyTitle")}
              hint={t("bag.emptyHint")}
            />
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Diagnostics                                                */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-5 bag-diagnostics-section">
        <button
          type="button"
          className="card flex w-full items-center justify-between px-4 py-3"
          onClick={() => setShowDiagnostics((v) => !v)}
          aria-expanded={showDiagnostics}
        >
          <span className="text-[13px] font-semibold">{t("bag.deviceStatus")}</span>
          <span className="text-[12px] text-[var(--muted)]">
            {showDiagnostics ? t("bag.collapse") : t("bag.expand")}
          </span>
        </button>

        {showDiagnostics ? (
          <Card className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("bag.location")}
            </p>
            <KV k={t("bag.gpsStatus")} v={gpsStatus} />
            <KV k={t("bag.permission")} v={permission} />
            <KV k={t("bag.source")} v={isSimulated ? t("bag.simulator") : fix ? t("bag.realDevice") : "—"} />
            <KV k={t("bag.fixQuality")} v={quality ? qualityLabel(quality.quality, t) : "—"} />
            <KV
              k={t("bag.coordinates")}
              v={fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : "—"}
              mono
            />
            <KV k={t("bag.accuracy")} v={fix ? `±${Math.round(fix.accuracy)} m` : "—"} mono />
            {quality?.message ? (
              <p className="mt-1 text-[11.5px] leading-snug text-amber-700">{quality.message}</p>
            ) : null}

            <div className="my-3 h-px bg-[var(--line)]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("bag.networkStorage")}
            </p>
            <KV k={t("bag.network")} v={online ? t("common.online") : t("common.offline")} />
            <KV k={t("bag.localStorage")} v={isPersistentStorageAvailable() ? t("bag.available") : t("bag.unavailableMemory")} />
            <KV k={t("bag.saveSize")} v={`${saveSizeBytes()} B`} mono />
            <KV k={t("bag.viewportWidth")} v={`${viewportWidth} px`} mono />

            <div className="my-3 h-px bg-[var(--line)]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("bag.sceneDistances")}
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
              {t("bag.preferences")}
            </p>
            <label className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12px]">{t("bag.accuracySlack")}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--accent)]"
                checked={settings.allowAccuracySlack}
                onChange={(e) => update({ allowAccuracySlack: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12px]">{t("bag.reduceMotion")}</span>
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
      <section className="card mt-4 p-4 bag-save-management">
        <p className="text-[13px] font-semibold">{t("bag.saveManagement")}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
          {t("bag.saveExplanation")}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary h-9 min-h-0 px-3 text-[13px]"
            onClick={exportSave}
          >
            {t("bag.copySave")}
          </button>
          <button
            type="button"
            className="btn btn-ghost h-9 min-h-0 px-3 text-[13px]"
            onClick={() => setShowReset((v) => !v)}
          >
            {t("bag.resetProgress")}
          </button>
        </div>

        {importMsg ? (
          <p className="mt-2 text-[12px] text-[var(--muted)]">{importMsg}</p>
        ) : null}

        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-[var(--muted)]">
            {t("bag.importFromText")}
          </summary>
          <textarea
            className="input mt-2 min-h-[100px] font-mono text-[11px]"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t("bag.pasteJson")}
          />
          <button
            type="button"
            className="btn btn-secondary mt-2 h-9 min-h-0 px-3 text-[13px]"
            onClick={() => {
              const ok = importSaveText(importText);
              setImportMsg(ok ? t("bag.importSuccess") : t("bag.importFailed"));
              if (ok) setImportText("");
            }}
          >
            {t("bag.import")}
          </button>
        </details>

        {showReset ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-[12.5px] font-semibold text-red-800">
              {t("bag.resetWarning")}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-red-700">
              {t("bag.resetExplanation")}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn h-9 min-h-0 bg-red-600 px-3 text-[13px] text-white"
                onClick={() => {
                  resetHunt();
                  setShowReset(false);
                  setImportMsg(t("bag.progressReset"));
                }}
              >
                {t("bag.confirmReset")}
              </button>
              <button
                type="button"
                className="btn btn-secondary h-9 min-h-0 px-3 text-[13px]"
                onClick={() => setShowReset(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {settings.simulatorEnabled ? (
        <p className="mt-3 text-center text-[11.5px] text-purple-700">
          {t("bag.simulatorEnabled")}
        </p>
      ) : null}
    </Screen>
      <TabBar />
    </>
  );
}

function qualityLabel(q: string, t: (key: import("@/lib/i18n/locale").UiMessageKey) => string): string {
  switch (q) {
    case "good":
      return t("bag.qualityGood");
    case "fair":
      return t("bag.qualityFair");
    case "poor":
      return t("bag.qualityPoor");
    case "stale":
      return t("bag.qualityStale");
    default:
      return q;
  }
}
