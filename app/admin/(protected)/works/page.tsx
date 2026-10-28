import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server-session";
import { getRegistry } from "@/lib/registry/store";
import { worksForOwner } from "@/lib/registry/service";
import { WORK_STATE_LABEL, WORK_STATE_TONE, formatTime } from "@/lib/registry/labels";
import { ROLE_RANK } from "@/lib/registry/types";

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
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">作品</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">版本</th>
                <th className="px-4 py-2.5 font-medium">当前公开版本</th>
                <th className="px-4 py-2.5 font-medium">更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {works.map((work) => (
                <tr key={work.gameId}>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/works/${work.gameId}`}
                      className="font-medium hover:underline"
                    >
                      {work.title}
                    </Link>
                    <div className="text-[11px] text-[var(--muted)]">{work.gameId}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/works?state=${work.state}`}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${WORK_STATE_TONE[work.state]}`}
                      >
                        {WORK_STATE_LABEL[work.state]}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-[var(--muted)]">
                    {work.versions.length}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--muted)]">
                    {work.publishedVersionId ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--muted)]">{formatTime(work.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
