"use client";

/**
 * Home - the landing screen.
 *
 * Job: explain the game in one screen, show whether a save exists, and get the
 * player to a hunt. No map, no GPS prompt yet - asking for location before the
 * player knows why is the fastest way to get a permanent denial.
 */

import Link from "next/link";
import { useHunt } from "@/components/hunt-provider";
import { ProgressBar, Screen } from "@/components/ui";
import { useOnlineStatus } from "@/components/providers";
import { useUiLocale } from "@/components/ui-locale-provider";

export default function HomePage() {
  const { game, state, loading, loadError, ratio, complete, contentSource, reloadContent } = useHunt();
  const online = useOnlineStatus();
  const { t, locale, toggleLocale } = useUiLocale();

  const hasProgress = Boolean(state && state.inventory.length > 0);

  return (
    <Screen
      title="MOS Scene Hunt"
      subtitle={t("home.subtitle")}
      headerRight={
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleLocale} className="btn btn-ghost h-9 min-h-0 px-2 text-xs" aria-label={locale === "en" ? "Switch interface to Simplified Chinese" : "Switch interface to English"}>
            {locale === "en" ? "简体中文" : "English"}
          </button>
          <span className={`chip shrink-0 ${online ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
            {online ? t("common.online") : t("common.offline")}
          </span>
        </div>
      }
    >
      <section className="card home-hero-card overflow-hidden">
        <div className="hero-explore px-5 py-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-signal-soft">
            {t("home.eyebrow")}
          </p>
          <h2 className="mt-2 text-[26px] font-extrabold leading-tight">
            {t("home.title")}
          </h2>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-white/80">
            {t("home.description")}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link href="/games" className="btn min-h-11 flex-1 bg-white text-slate-900 shadow-sm">
              {t("home.chooseGame")} <span aria-hidden="true">→</span>
            </Link>
            <Link href="/tutorial" className="btn min-h-11 flex-1 border border-white/30 bg-white/10 text-white">
              <span aria-hidden="true">▶</span> {t("home.watchDemo")}
            </Link>
          </div>
        </div>

        <div className="px-5 pb-5">
          <p className="text-sm font-semibold text-[var(--text)]">{t("home.outdoorsOnly")}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">{t("home.gpsSafety")}</p>
        </div>
      </section>

      {hasProgress && game ? (
        <section className="card home-resume-card mt-4 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-[var(--muted)]">{t("home.resume")}</p>
              <p className="text-[16px] font-semibold">{game.title}</p>
            </div>
            <span className="chip bg-amber-100 text-amber-800">
              {complete ? t("home.completed") : `${Math.round(ratio * 100)}%`}
            </span>
          </div>
          <ProgressBar ratio={ratio} className="mt-3" />
          <div className="mt-4 flex gap-2">
            <Link href="/map" className="btn btn-primary flex-1">
              {t("home.continueHunt")}
            </Link>
            <Link href="/bag" className="btn btn-secondary">
              {t("home.inventory")}
            </Link>
          </div>
        </section>
      ) : null}





      <section className="card home-demo-card mt-4 overflow-hidden bsop-reference">
        <div className="bsop-reference__cover">
          {/* Official BSOP handbook thumbnail; the game itself can replace this with licensed field photography later. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://bsop.edu.ph/wp-content/uploads/2026/04/BSOP-Student-Handbook-2025-2026-thumnail.png"
            alt={t("home.example")}
            className="bsop-reference__image"
          />
          <div className="bsop-reference__overlay">
            <span className="chip bg-white/15 text-white">REFERENCE GAME · 01</span>
          </div>
        </div>
        <div className="p-4">
          <p className="text-[13px] font-semibold">{t("home.example")}</p>
          <h3 className="mt-1 text-[18px] font-bold leading-tight">{t("home.exampleTitle")}</h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
            {t("home.exampleDescription")}
          </p>
          <div className="mt-3 flex gap-2">
            <Link href="/select?game=bsop-eight-secrets" className="btn btn-primary h-10 min-h-0 flex-1 px-3 text-[13px]">
              {t("home.tryDemo")} →
            </Link>
            <Link href="/create" className="btn btn-secondary h-10 min-h-0 px-3 text-[13px]">{t("home.designImport")}</Link>
          </div>
        </div>
      </section>

      <section className="home-available-section mt-5">
        <h3 className="px-1 text-[13px] font-semibold text-[var(--muted)]">{t("home.availableGames")}</h3>
        <div className="mt-2 space-y-3">
          {loading ? (
            <div className="card animate-pulse p-4">
              <div className="h-4 w-1/2 rounded bg-[var(--line)]" />
              <div className="mt-2 h-3 w-full rounded bg-[var(--line)]" />
            </div>
          ) : loadError ? (
            <div className="card p-4">
              <p className="text-[14px] font-semibold text-red-700">{t("home.contentFailed")}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-red-600">{loadError}</p>
              <button
                type="button"
                className="btn btn-secondary mt-3"
                onClick={() => reloadContent(true)}
              >
                {t("home.reload")}
              </button>
            </div>
          ) : game ? (
            <Link href="/select" className="card block p-4 transition-transform active:scale-[0.99]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold leading-tight">{game.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--muted)]">
                    {game.description}
                  </p>
                </div>
                <span className="chip shrink-0 bg-amber-100 text-amber-800">
                  {game.scenes.length} {t("home.stations")}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip bg-[var(--surface)] text-[11px] text-[var(--muted)]">
                  {t("home.minutesPrefix")} {game.estimatedMinutes ?? 20} {t("home.minutes")}
                </span>
                <span className="chip bg-[var(--surface)] text-[11px] text-[var(--muted)]">
                  {game.language}
                </span>
                {contentSource === "cache" ? (
                  <span className="chip bg-slate-200 text-[11px] text-slate-600">{t("home.cached")}</span>
                ) : contentSource === "local" ? (
                  <span className="chip bg-purple-100 text-[11px] text-purple-700">{t("home.myCreation")}</span>
                ) : null}
              </div>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="card home-create-card mt-4 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-xl" aria-hidden="true">✦</div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">{t("home.designTitle")}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{t("home.designDescription")}</p>
            <Link href="/how-to-create" className="btn btn-secondary mt-3 min-h-10 w-full">{t("home.learnCreate")}</Link>
          </div>
        </div>
      </section>

    </Screen>
  );
}
