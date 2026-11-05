import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server-session";
import { getRegistry } from "@/lib/registry/store";
import { worksForOwner } from "@/lib/registry/service";
import { WORK_STATE_LABEL, WORK_STATE_TONE, formatTime } from "@/lib/registry/labels";
import { ROLE_RANK } from "@/lib/registry/types";
import { resolveCityRef } from "@/lib/cities/resolve";
import { getCityStore } from "@/lib/cities/store";
import { cityAssociationAnomaly, mapAssociation } from "@/lib/cities/client";
import { CityStatusBadge, cityStateLabel } from "@/components/city-status-badge";
import { CityAdminActions } from "@/components/city-admin-actions";

export const dynamic = "force-dynamic";

export default async function WorksPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { user } = await requirePageSession();
  const { state: stateFilter } = await searchParams;
  const isStaff = ROLE_RANK[user.role] >= ROLE_RANK.reviewer;

  const all = isStaff ? await getRegistry().listWorks() : await worksForOwner(user.id);
  const works = stateFilter ? all.filter((w) => w.state === stateFilter) : all;

  /*
   * City column. Names are resolved per UNIQUE city id (usually a handful), not
   * per row, so the page does not issue one read per work.
   *
   * The badge comes from the SAME five-state mapping the creator card uses
   * (`mapAssociation`), fed with the work record the page already holds. That
   * is what keeps "关联失败" identical on both screens, and what makes an
   * unusable stored cityId show up as an anomaly instead of a city name.
   */
  const cityIds = [...new Set(all.map((work) => work.cityId).filter((id): id is string => Boolean(id)))];
  const cityStore = getCityStore();
  const cityNames = new Map<string, string>();
  for (const cityId of cityIds) {
    const resolved = await resolveCityRef(cityStore, cityId).catch(() => null);
    if (resolved) cityNames.set(cityId, resolved.city.cityName);
  }

  const associationOf = (work: (typeof all)[number]) =>
    mapAssociation({
      cityId: work.cityId ?? null,
      cityName: work.cityId ? (cityNames.get(work.cityId) ?? null) : null,
      intent: work.cityIntent ?? null,
    });

  /*
   * Record-level anomalies (published-but-pending residue, damaged cityId)
   * come from the SHARED `cityAssociationAnomaly` — the same sentences and the
   * same conditions a reviewer can test directly. The page never rewrites the
   * record in response; it only highlights the row and shows the text.
   */
  const anomalyOf = (work: (typeof all)[number]): string | null =>
    cityAssociationAnomaly({
      workState: work.state,
      cityId: work.cityId ?? null,
      cityName: work.cityId ? (cityNames.get(work.cityId) ?? null) : null,
      intent: work.cityIntent ?? null,
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{isStaff ? "全部作品" : "我的作品"}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            共 {all.length} 件{stateFilter ? `，筛选后 ${works.length} 件` : ""}。
          </p>
        </div>
        {stateFilter ? (
          <Link href="/admin/works" className="text-xs text-[var(--accent-deep)]">
            清除筛选
          </Link>
        ) : null}
      </div>

      {works.length === 0 ? (
        <p className="rounded-xl bg-[var(--card)] p-6 text-sm text-[var(--muted)] shadow-card">
          没有符合条件的作品。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-[var(--card)] shadow-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">作品</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">城市</th>
                <th className="px-4 py-2.5 font-medium">版本</th>
                <th className="px-4 py-2.5 font-medium">当前公开版本</th>
                <th className="px-4 py-2.5 font-medium">更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {works.map((work) => {
                const association = associationOf(work);
                const anomaly = anomalyOf(work);
                return (
                  <tr key={work.gameId} className={anomaly ? "bg-[var(--warn-bg)]" : undefined}>
                    <td className="px-4 py-2.5 align-top">
                      <Link
                        href={`/admin/works/${work.gameId}`}
                        className="font-medium hover:underline"
                      >
                        {work.title}
                      </Link>
                      <div className="text-[11px] text-[var(--muted)]">{work.gameId}</div>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <Link href={`/admin/works?state=${work.state}`}>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${WORK_STATE_TONE[work.state]}`}
                        >
                          {WORK_STATE_LABEL[work.state]}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <CityStatusBadge state={association} />
                      {anomaly ? (
                        <div className="mt-1 text-[11px] leading-relaxed text-[var(--warn-text)]">
                          {anomaly}
                        </div>
                      ) : null}
                      <CityAdminActions
                        gameId={work.gameId}
                        hasCity={Boolean(work.cityId)}
                        canManage={isStaff}
                        currentName={
                          association.kind === "associated" ? cityStateLabel(association) : null
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 align-top tabular-nums text-[var(--muted)]">
                      {work.versions.length}
                    </td>
                    <td className="px-4 py-2.5 align-top font-mono text-[11px] text-[var(--muted)]">
                      {work.publishedVersionId ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 align-top text-[var(--muted)]">
                      {formatTime(work.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
