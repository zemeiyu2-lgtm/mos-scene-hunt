"use client";

/**
 * Hunt Select.
 *
 * V0.1 ships a single content pack, so this screen's real job is the pre-flight
 * briefing: what the hunt is, how long it takes, and what permission it needs.
 * It is also the gate that requests GPS - deliberately after the player has read
 * why.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useHunt } from "@/components/hunt-provider";
import { useGps } from "@/components/gps-provider";
import { findManifestEntry, importGamePackage } from "@/lib/content";
import { ErrorState, Screen } from "@/components/ui";
import { TabBar } from "@/components/tab-bar";
import { useUiLocale } from "@/components/ui-locale-provider";

export default function SelectPage() {
  const router = useRouter();
  const { t } = useUiLocale();
  const { game, loadError, reloadContent, state, statuses, startHunt, contentSource } = useHunt();
  const { start, status, permission } = useGps();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const begin = () => {
    // Kick off GPS and the hunt together: the permission prompt appears while
    // the map is already loading, so the player is not staring at a blank screen.
    start();
    startHunt();
    router.push("/map");
  };

  const completedCount = statuses.filter((s) => s.status === "completed").length;

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const text = await file.text();
      const result = importGamePackage(text);
      const warningCount = result.issues.filter((issue) => issue.severity === "warning").length;
      setImportMessage(warningCount ? t("select.installedWarnings").replace("{title}", result.game.title).replace("{count}", String(warningCount)) : t("select.installed").replace("{title}", result.game.title));
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : t("select.importFailed"));
    } finally { setImporting(false); }
  };
  const hasProgress = Boolean(state && state.inventory.length > 0);

  if (loadError) {
    return (
      <Screen title={t("select.title")} subtitle={t("select.loadFailed")}>
        <ErrorState
          title={t("select.contentUnavailable")}
          detail={loadError}
          onRetry={() => reloadContent(true)}
        />
      </Screen>
    );
  }

  if (!game) {
    return (
      <Screen title={t("select.title")}>
        <div className="card h-40 animate-pulse" />
      </Screen>
    );
  }

  /**
   * The manifest is presentation-only: it contributes a difficulty hint and,
   * for bundled packs, nothing else. Everything factual on this screen -
   * title, description, scene list, trigger distance - is read off the loaded
   * `game`, which is the authored pack whenever one is active.
   */
  const manifest = findManifestEntry(game.id);
  const isAuthored = contentSource === "local";
  const triggerRange = formatTriggerRange(game.scenes.map((s) => s.location.radius), t);

  return (
    <>
    <Screen title={t("select.title")} subtitle={t("select.confirmStart")}>
      <section className="card select-import-card mb-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold">📦 {t("select.importPackage")}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{t("select.importDescription")}</p>
          </div>
          <button type="button" className="btn btn-secondary shrink-0" onClick={() => importInputRef.current?.click()} disabled={importing}>{importing ? t("select.importing") : t("select.choosePackage")}</button>
          <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImport} />
        </div>
        {importMessage ? <p className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2 text-[11.5px] leading-relaxed">{importMessage}</p> : null}
      </section>
      <section className="card select-game-card story-card overflow-hidden">
        <div className="hero-explore px-5 py-6">
          <p className="game-kicker">
            {isAuthored ? t("select.localCreation") : manifest?.difficulty === "easy" ? t("games.easy") : t("games.hard")} ·{" "}
            {game.language}
          </p>
          <h2 className="mt-2 text-[24px] font-bold leading-tight">{game.title}</h2>
          <div className="game-route mt-4"><span>{t("select.explore")}</span><i>→</i><span>{t("select.choose")}</span><i>→</i><span>{t("select.act")}</span><i>→</i><span>{t("select.reflect")}</span></div>
        </div>

        <div className="p-5">
          {game.description ? (
            <p className="text-[13.5px] leading-relaxed text-[var(--muted)]">{game.description}</p>
          ) : null}

          {game.id === "bsop-eight-secrets" ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
              <p className="text-sm font-bold">{t("select.bsopTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed">{t("select.bsopDescription")}</p>
            </div>
          ) : null}

          <dl className="select-metrics mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: t("select.locations"), v: `${game.scenes.length}` },
              { k: t("select.area"), v: formatArea(game.huntArea?.radiusMeters, t) },
              { k: t("select.trigger"), v: triggerRange },
              { k: t("select.estimated"), v: `${game.estimatedMinutes ?? 20} ${t("home.minutes")}` },
            ].map((item) => (
              <div key={item.k} className="rounded-xl bg-[var(--surface)] px-3 py-2">
                <dt className="text-[11px] text-[var(--muted)]">{item.k}</dt>
                <dd className="tabular mt-0.5 text-[13px] font-semibold">{item.v}</dd>
              </div>
            ))}
          </dl>

          {game.huntArea ? (
            <div className="mt-4 rounded-xl bg-amber-50 px-3.5 py-3 text-[12px] leading-relaxed text-amber-900">
              <p className="font-semibold">
                {t("select.playArea")} · {game.huntArea.name ?? formatArea(game.huntArea.radiusMeters, t)}
                {game.huntArea.shape === "polygon"
                  ? `（${t("select.customPolygon")} · ${game.huntArea.points?.length ?? 0} ${t("select.vertices")}）`
                  : ""}
              </p>
              <p className="mt-0.5">
                {t("select.areaExplanation").replace("{area}", formatArea(game.huntArea.radiusMeters, t)).replace("{range}", triggerRange)}
              </p>
            </div>
          ) : null}

          <div className="select-scene-list mt-4 space-y-2">
            {game.scenes.map((scene, i) => (
              <div key={scene.id} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--line)] text-[11px] font-bold text-[var(--muted)]">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium leading-snug">{scene.title}</p>
                  <p className="text-[11.5px] text-[var(--muted)]">
                    {scene.challenge ? challengeLabel(scene.challenge.type, t) : t("select.noChallenge")}
                    {scene.reward ? ` · ${t("select.reward")}${scene.reward.title}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {hasProgress ? (
        <div className="card mt-4 p-4">
          <p className="text-[13px]">
            {t("select.existingProgress")}
            <span className="font-semibold">
              {" "}
              {completedCount} / {statuses.length} {t("select.completedLocations")}
            </span>
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {t("select.progressKept")}
          </p>
        </div>
      ) : null}

      <div className="card mt-4 p-4">
        <p className="text-[13px] font-semibold">{t("select.beforeStart")}</p>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <li>· {t("home.gpsSafety")}</li>
          <li>· {t("select.locationPermission")}</li>
          <li>· {t("select.noAccount")}</li>
        </ul>
        {permission === "denied" ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700">
            {t("select.permissionDenied")}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2">
        <button type="button" className="btn btn-primary btn-block" onClick={begin}>
          {hasProgress ? t("home.continueHunt") : t("select.startHunt")}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => router.back()}
        >
          {t("common.back")}
        </button>
      </div>

      {status === "unsupported" ? (
        <p className="mt-3 text-center text-[12px] text-red-700">
          {t("select.gpsUnsupported")}
        </p>
      ) : null}
    </Screen>
      <TabBar />
    </>
  );
}

function formatArea(radiusMeters: number | undefined, t: (key: import("@/lib/i18n/locale").UiMessageKey) => string): string {
  if (!Number.isFinite(radiusMeters)) return t("select.notSet");
  const km = (radiusMeters as number) / 1000;
  return km >= 1 ? `${t("select.about")} ${km.toFixed(km < 10 ? 1 : 0)} km` : `${t("select.about")} ${Math.round(radiusMeters as number)} m`;
}

/**
 * The actual trigger radii in this pack, e.g. "15–30 m" or "15 m".
 *
 * Read from the scenes rather than hard-coded: an authored pack sets its own
 * radii, and a briefing that claims "30–50 m" for a pack whose rings are 15 m
 * sends the player looking in the wrong place.
 */
function formatTriggerRange(radii: Array<number | undefined>, t: (key: import("@/lib/i18n/locale").UiMessageKey) => string): string {
  const values = radii
    .map((r) => (typeof r === "number" && Number.isFinite(r) ? Math.round(r) : null))
    .filter((r): r is number => r !== null);
  if (values.length === 0) return t("select.notSet");
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `${min} m` : `${min}–${max} m`;
}

function challengeLabel(type: string, t: (key: import("@/lib/i18n/locale").UiMessageKey) => string): string {
  switch (type) {
    case "choice":
      return t("challenge.choiceType");
    case "keyword":
      return t("challenge.keywordType");
    case "text":
      return t("challenge.textType");
    default:
      return t("select.task");
  }
}
