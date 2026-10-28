import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server-session";
import { getRegistry } from "@/lib/registry/store";
import { adminSummary, reviewQueue, worksForOwner } from "@/lib/registry/service";
import {
  AUDIT_ACTION_LABEL,
  WORK_STATE_LABEL,
  WORK_STATE_TONE,
  formatTime,
} from "@/lib/registry/labels";
import { ROLE_RANK } from "@/lib/registry/types";

export const dynamic = "force-dynamic";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-[var(--card)] p-4 shadow-card">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { user } = await requirePageSession();
  const params = await searchParams;
  const isStaff = ROLE_RANK[user.role] >= ROLE_RANK.reviewer;

  const summary = isStaff ? await adminSummary() : null;
  const queue = isStaff ? (await reviewQueue()).slice(0, 5) : [];
  const mine = isStaff ? [] : await worksForOwner(user.id);
  const audit = isStaff && user.role === "admin" ? await (await getRegistry()).listAudit(8) : [];

  return (
    <div className="space-y-6">
      {params.denied ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          当前账号没有访问该页面的权限。
        </p>
      ) : null}

      <div>
        <h1 className="text-lg font-semibold">概览</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {isStaff
            ? "审核与发布状态一览。发布是独立动作：审核通过不等于已经上线。"
            : "你提交的作品与审核进度。审核通过后由管理员发布，玩家才会看到。"}
        </p>
      </div>

      {isStaff && summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="待审数量" value={String(summary.pendingReviews)} hint="提交或审核中" />
            <Metric
              label="最久等待"
              value={
                summary.pendingReviews === 0 ? "—" : `${summary.oldestWaitingHours.toFixed(1)} 小时`
              }
              hint={summary.oldestWaitingHours >= 72 ? "已超过 72 小时，建议优先处理" : "按提交时间"}
            />
            <Metric label="公开作品" value={String(summary.published)} hint="已发布或已下架" />
            <Metric label="作品总数" value={String(summary.totalWorks)} hint={`已撤下 ${summary.withdrawn}`} />
          </div>

          <section className="rounded-xl bg-[var(--card)] p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">待审队列（最早提交优先）</h2>
              <Link href="/admin/queue" className="text-xs text-[var(--accent-deep)]">
                查看全部
              </Link>
            </div>
            {queue.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">队列为空。</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {queue.map((entry) => (
                  <li key={entry.work.gameId} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/works/${entry.work.gameId}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {entry.work.title}
                      </Link>
                      <div className="text-[11px] text-[var(--muted)]">
                        {entry.work.gameId} · 等待 {entry.waitingHours.toFixed(1)} 小时
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${WORK_STATE_TONE[entry.work.state]}`}
                    >
                      {WORK_STATE_LABEL[entry.work.state]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-xl bg-[var(--card)] p-4 shadow-card">
          <h2 className="text-sm font-semibold">我的作品</h2>
          {mine.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              还没有提交过作品。在 <Link href="/design" className="text-[var(--accent-deep)]">创作中心</Link>{" "}
              设计完成后，用「提交审核」上传。
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {mine.map((work) => (
                <li key={work.gameId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/works/${work.gameId}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {work.title}
                    </Link>
                    <div className="text-[11px] text-[var(--muted)]">
                      {work.gameId} · 更新于 {formatTime(work.updatedAt)}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${WORK_STATE_TONE[work.state]}`}
                  >
                    {WORK_STATE_LABEL[work.state]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {user.role === "admin" ? (
        <section className="rounded-xl bg-[var(--card)] p-4 shadow-card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">最近操作</h2>
            <Link href="/admin/audit" className="text-xs text-[var(--accent-deep)]">
              审计日志
            </Link>
          </div>
          {audit.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">暂无记录。</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs text-[var(--muted)]">
              {audit.map((record) => (
                <li key={record.id} className="flex justify-between gap-3">
                  <span className="truncate">
                    {AUDIT_ACTION_LABEL[record.action] ?? record.action} · {record.targetType}{" "}
                    {record.targetId}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatTime(record.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {summary ? (
        <p className="text-[11px] text-[var(--muted)]">
          存储：{summary.storeKind === "blob" ? "Vercel Blob（持久）" : "本地文件（仅本机实例）"}。
          限流为单实例内存计数，不是分布式配额。
        </p>
      ) : null}
    </div>
  );
}
