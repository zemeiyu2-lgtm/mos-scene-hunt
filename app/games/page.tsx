"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Screen, LoadingState } from "@/components/ui";
import { importGamePackage } from "@/lib/content";
import { loadCloudCatalog, packUrl, publishedGames, type CloudGameEntry } from "@/lib/cloud";

export default function GamesPage() {
  const { t } = useUiLocale();
  const [games, setGames] = useState<CloudGameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const catalog = await loadCloudCatalog();
      setGames(publishedGames(catalog));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("games.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const download = async (entry: CloudGameEntry) => {
    setBusyId(entry.id);
    setMessage("");
    try {
      const response = await fetch(packUrl(entry), { cache: "no-cache" });
      if (!response.ok) throw new Error(`${t("games.downloadFailed")} (HTTP ${response.status})`);
      const result = importGamePackage(await response.text());
      const warningCount = result.issues.filter((x) => x.severity === "warning").length;
      setMessage(warningCount
        ? t("games.installedWithWarnings").replace("{title}", result.game.title).replace("{count}", String(warningCount))
        : t("games.installed").replace("{title}", result.game.title));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("games.downloadError"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen title={t("games.title")} subtitle={t("games.subtitle")}>
      <section className="card p-5">
        <p className="game-kicker">MOS SCENE HUNT · GAME CENTER</p>
        <h2 className="mt-2 text-2xl font-bold">{t("games.choose")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          {t("games.description")}
        </p>
      </section>

      {message ? <div className="card mt-4 p-4 text-sm leading-relaxed">{message}</div> : null}

      {loading ? <LoadingState label={t("games.loading")} /> : (
        <div className="mt-4 grid gap-3">
          {games.map((game) => (
            <article key={game.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold">{game.title}</h3>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{t("games.author")}: {game.author}</p>
                </div>
                <span className="chip shrink-0">{game.sceneCount} 站</span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">{game.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip bg-[var(--surface)]">{t("home.minutesPrefix")} {game.estimatedMinutes ?? "—"} {t("home.minutes")}</span>
                <span className="chip bg-[var(--surface)]">{game.difficulty === "easy" ? t("games.easy") : game.difficulty === "hard" ? t("games.hard") : t("games.standard")}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className="btn btn-primary" onClick={() => void download(game)} disabled={busyId === game.id}>
                  {busyId === game.id ? t("games.downloading") : t("games.download")}
                </button>
                <Link className="btn btn-secondary text-center" href={`/select?game=${encodeURIComponent(game.id)}`}>
                  {t("games.view")}
                </Link>
              </div>
            </article>
          ))}
          {!games.length ? <div className="card p-5 text-center text-sm text-[var(--muted)]">{t("games.empty")}</div> : null}
        </div>
      )}

      <section className="card mt-4 p-4">
        <p className="text-[13px] font-semibold">{t("games.forCreators")}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{t("games.creatorDescription")}</p>
        <Link href="/create" className="btn btn-secondary mt-3">{t("home.designImport")}</Link>
      </section>
    </Screen>
  );
}
