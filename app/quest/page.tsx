"use client";

/**
 * Quest screen (任务 tab).
 *
 * The hunt as a checklist: what is done, what is next, what is still locked,
 * and the live distance to each. This is the screen a player opens when they
 * are not sure where to go.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHunt } from "@/components/hunt-provider";
import { EmptyState, ProgressBar, Screen, StatusChip } from "@/components/ui";
import { formatDistance, resolveRadius } from "@/lib/location";
import { TabBar } from "@/components/tab-bar";
import { useUiLocale } from "@/components/ui-locale-provider";

export default function QuestPage() {
  const router = useRouter();
  const { t } = useUiLocale();
  const { game, state, statuses, distances, current, ratio, complete, loading } = useHunt();

  if (loading || !game || !state) {
    return (
      <Screen title={t("quest.title")} subtitle={t("quest.loading")}>
        <div className="card h-40 animate-pulse" />
      </Screen>
    );
  }

  const completedCount = statuses.filter((s) => s.status === "completed").length;

  return (
    <>
    <Screen
      title={t("quest.title")}
      subtitle={`${game.title} · ${completedCount}/${statuses.length} ${t("quest.completedPlaces")}`}
      headerRight={
        complete ? <span className="chip bg-emerald-100 text-emerald-700">{t("quest.allDone")}</span> : null
      }
    >
      <div className="card story-card quest-progress-card p-5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold">
            {complete ? t("quest.routeComplete") : current ? `${t("quest.currentTarget")}${current.title}` : t("quest.ready")}
          </p>
          <span className="tabular text-[13px] font-bold">{Math.round(ratio * 100)}%</span>
        </div>
        <ProgressBar ratio={ratio} className="mt-2.5" />
        {!complete ? (
          <Link href="/map" className="btn btn-primary btn-block mt-3.5">
            {t("quest.openMap")}
          </Link>
        ) : (
          <Link href="/bag" className="btn btn-primary btn-block mt-3.5">
            {t("quest.viewFindings")}
          </Link>
        )}
      </div>

      <ul className="mt-4 space-y-3">
        {statuses.map((row, index) => {
          const d = distances[row.scene.id];
          const isDone = row.status === "completed";
          const isLocked = row.status === "locked";
          const canEnter = !isLocked && (d?.inRange ?? false);
          const radius = resolveRadius(row.scene.location);

          return (
            <li key={row.scene.id}>
              <div
                className={`card quest-location-card p-4 transition-transform ${isLocked ? "opacity-60" : ""} ${
                  row.isActive ? "border-[var(--accent)]" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
                      isDone
                        ? "bg-emerald-500 text-white"
                        : row.isActive
                          ? "bg-[var(--accent)] text-[#3a2400]"
                          : "bg-[var(--line)] text-[var(--muted)]"
                    }`}
                  >
                    {isDone ? "✓" : isLocked ? "🔒" : index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[15px] font-semibold leading-snug">{row.scene.title}</p>
                      <StatusChip status={row.status} className="shrink-0" />
                    </div>

                    <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                      {row.scene.location.name ?? t("quest.place")}
                      {row.scene.reward ? ` · ${t("quest.reward")}${row.scene.reward.title}` : ""}
                    </p>

                    {!isLocked && d ? (
                      <p className="mt-2 text-[12.5px]">
                        {d.inRange ? (
                          <span className="font-semibold text-emerald-600">✓ {t("quest.insideArea")}</span>
                        ) : (
                          <>
                            <span className="text-[var(--muted)]">{t("quest.distance")}</span>
                            <span className="tabular font-semibold">
                              {formatDistance(d.distance)}
                            </span>
                            <span className="text-[11px] text-[var(--muted)]">
                              {" "}
                              / {t("quest.triggerRadius")} {radius} m
                            </span>
                          </>
                        )}
                      </p>
                    ) : isLocked ? (
                      <p className="mt-2 text-[12px] text-[var(--muted)]">
                        {t("quest.unlockAfter").replace("{title}", statuses[index - 1]?.scene.title ?? t("quest.previousLocation"))}
                      </p>
                    ) : null}

                    {row.scene.briefing && !isLocked && !isDone ? (
                      <p className="mt-2 border-l-2 border-[var(--line)] pl-2.5 text-[12px] italic leading-relaxed text-[var(--muted)]">
                        {row.scene.briefing}
                      </p>
                    ) : null}

                    {!isLocked ? (
                      <div className="quest-location-actions mt-3 flex gap-2">
                        {isDone ? (
                          <>
                            <Link
                              href={`/scene/${row.scene.id}`}
                              className="btn btn-secondary h-9 min-h-0 flex-1 px-3 text-[13px]"
                            >
                              {t("quest.revisitScene")}
                            </Link>
                            <Link
                              href={`/reward/${row.scene.id}`}
                              className="btn btn-ghost h-9 min-h-0 px-3 text-[13px]"
                            >
                              {t("quest.rewardButton")}
                            </Link>
                          </>
                        ) : canEnter ? (
                          <>
                            <Link
                              href={`/scene/${row.scene.id}`}
                              className="btn btn-primary h-9 min-h-0 flex-1 px-3 text-[13px]"
                            >
                              {t("quest.unlockScene")}
                            </Link>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary h-9 min-h-0 flex-1 px-3 text-[13px]"
                            onClick={() => router.push("/map")}
                          >
                            {t("quest.viewRoute")}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!statuses.length ? (
        <EmptyState title={t("quest.noScenes")} hint={t("quest.checkPack")} />
      ) : null}

      {complete ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-[15px] font-semibold text-emerald-800">🎉 {t("quest.allComplete")}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-emerald-700">
            {t("quest.savedProgress").replace("{count}", String(statuses.length))}
          </p>
        </div>
      ) : null}
    </Screen>
      <TabBar />
    </>
  );
}
