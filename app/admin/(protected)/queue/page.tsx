import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server-session";
import { reviewQueue } from "@/lib/registry/service";
import { WORK_STATE_LABEL, WORK_STATE_TONE, formatTime } from "@/lib/registry/labels";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  await requirePageSession("reviewer");
  const queue = await reviewQueue();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">审核队列</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          按提交时间升序。超过 72 小时会标红——审核人力是这条链路真正的瓶颈。
        </p>
      </div>

      {queue.length === 0 ? (
        <p className="rounded-xl bg-[var(--card)] p-6 text-sm text-[var(--muted)] shadow-card">
          队列为空。
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-[var(--card)] shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">作品</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">等待</th>
                <th className="px-4 py-2.5 font-medium">提交时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {queue.map((entry) => {
                const late = entry.waitingHours >= 72;
                return (
                  <tr key={entry.work.gameId} className={late ? "bg-red-50/60" : undefined}>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/works/${entry.work.gameId}`}
                        className="font-medium hover:underline"
                      >
                        {entry.work.title}
                      </Link>
                      <div className="text-[11px] text-[var(--muted)]">
                        {entry.work.gameId} · {entry.work.language}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${WORK_STATE_TONE[entry.work.state]}`}
                      >
                        {WORK_STATE_LABEL[entry.work.state]}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 tabular-nums ${late ? "font-semibold text-red-700" : ""}`}>
                      {entry.waitingHours.toFixed(1)} 小时
                    </td>
                    <td className="px-4 py-2.5 text-[var(--muted)]">
                      {formatTime(entry.waitingSince)}
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
