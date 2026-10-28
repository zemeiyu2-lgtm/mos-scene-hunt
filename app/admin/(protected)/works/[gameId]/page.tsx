import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/server-session";
import { getRegistry } from "@/lib/registry/store";
import {
  DECISION_LABEL,
  WORK_STATE_LABEL,
  WORK_STATE_TONE,
  VERSION_STATUS_LABEL,
  formatBytes,
  formatTime,
  REVIEW_REASON_CODES,
} from "@/lib/registry/labels";
import { ROLE_RANK } from "@/lib/registry/types";
import { WorkActions } from "./work-actions";

export const dynamic = "force-dynamic";

const REASON_LABEL = new Map(REVIEW_REASON_CODES.map((r) => [r.code, r.label]));

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { user } = await requirePageSession();
  const { gameId } = await params;
  const work = await getRegistry().getWork(decodeURIComponent(gameId));

  if (!work) notFound();

  const isOwner = work.ownerUserId === user.id;
  const isStaff = ROLE_RANK[user.role] >= ROLE_RANK.reviewer;
  if (!isOwner && !isStaff) notFound();

  const reviewing = [...work.submissions]
    .reverse()
    .find((s) => s.status === "in_review" || s.status === "pending");

  // Review actions follow the SUBMISSION state, not the work's main state: a
  // published work can still have an update waiting in the queue.
  const hasPendingSubmission = work.submissions.some((s) => s.status === "pending");
  const hasInReviewSubmission = work.submissions.some((s) => s.status === "in_review");
  const hasApprovedUnpublished = work.versions.some(
    (v) => v.status === "approved" && v.versionId !== work.publishedVersionId,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{work.title}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${WORK_STATE_TONE[work.state]}`}>
              {WORK_STATE_LABEL[work.state]}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">{work.gameId}</p>
        </div>
        <Link href="/admin/works" className="text-xs text-[var(--accent-deep)]">
          返回列表
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="rounded-xl bg-[var(--card)] p-3 shadow-card">
          <div className="text-[11px] text-[var(--muted)]">当前公开版本</div>
          <div className="mt-1 font-mono text-xs">{work.publishedVersionId ?? "—"}</div>
        </div>
        <div className="rounded-xl bg-[var(--card)] p-3 shadow-card">
          <div className="text-[11px] text-[var(--muted)]">最新提交版本</div>
          <div className="mt-1 font-mono text-xs">{work.latestVersionId ?? "—"}</div>
        </div>
        <div className="rounded-xl bg-[var(--card)] p-3 shadow-card">
          <div className="text-[11px] text-[var(--muted)]">版本数</div>
          <div className="mt-1 tabular-nums">{work.versions.length}</div>
        </div>
        <div className="rounded-xl bg-[var(--card)] p-3 shadow-card">
          <div className="text-[11px] text-[var(--muted)]">最近更新</div>
          <div className="mt-1 text-xs">{formatTime(work.updatedAt)}</div>
        </div>
      </div>

      {work.state === "published" && work.publishedVersionId ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          公开链接：
          <Link
            className="ml-1 underline"
            href={`/select#cloud=${work.gameId}.${work.publishedVersionId}`}
          >
            /select#cloud={work.gameId}.{work.publishedVersionId}
          </Link>
        </p>
      ) : null}

      <WorkActions
        gameId={work.gameId}
        state={work.state}
        role={user.role}
        reviewingVersionId={reviewing?.versionId ?? null}
        hasPendingSubmission={hasPendingSubmission}
        hasInReviewSubmission={hasInReviewSubmission}
        hasApprovedUnpublished={hasApprovedUnpublished}
      />

      <section className="overflow-x-auto rounded-xl bg-[var(--card)] shadow-card">
        <h2 className="px-4 pt-4 text-sm font-semibold">版本</h2>
        <table className="mt-2 w-full min-w-[720px] text-sm">
          <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="px-4 py-2 font-medium">版本号</th>
              <th className="px-4 py-2 font-medium">标题</th>
              <th className="px-4 py-2 font-medium">场景</th>
              <th className="px-4 py-2 font-medium">大小</th>
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">提交时间</th>
              <th className="px-4 py-2 font-medium">预览</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {[...work.versions].reverse().map((version) => (
              <tr key={version.versionId}>
                <td className="px-4 py-2 font-mono text-[11px]">
                  {version.versionId}
                  {version.versionId === work.publishedVersionId ? (
                    <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">
                      公开中
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2">{version.title}</td>
                <td className="px-4 py-2 tabular-nums text-[var(--muted)]">{version.sceneCount}</td>
                <td className="px-4 py-2 tabular-nums text-[var(--muted)]">
                  {formatBytes(version.sizeBytes)}
                </td>
                <td className="px-4 py-2 text-xs">{VERSION_STATUS_LABEL[version.status]}</td>
                <td className="px-4 py-2 text-xs text-[var(--muted)]">
                  {formatTime(version.createdAt)}
                </td>
                <td className="px-4 py-2">
                  {isOwner || isStaff ? (
                    <a
                      className="text-xs text-[var(--accent-deep)] underline"
                      href={`/api/admin/preview/${work.gameId}/${version.versionId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看包
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl bg-[var(--card)] p-4 shadow-card">
        <h2 className="text-sm font-semibold">提交与审核历史</h2>
        {work.submissions.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">尚无提交记录。</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {[...work.submissions].reverse().map((submission) => (
              <li key={submission.id} className="border-l-2 border-[var(--line)] pl-3">
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-mono">{submission.versionId}</span>
                  <span className="text-[var(--muted)]">{formatTime(submission.submittedAt)}</span>
                  <span className="rounded bg-[var(--surface)] px-1.5 py-0.5">{submission.status}</span>
                </div>
                {submission.noteFromAuthor ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    作者说明：{submission.noteFromAuthor}
                  </p>
                ) : null}
                {submission.review ? (
                  <div className="mt-1.5 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                    <div className="font-medium">
                      审核结论：{DECISION_LABEL[submission.review.decision] ?? submission.review.decision}
                      <span className="ml-2 font-normal text-[var(--muted)]">
                        {formatTime(submission.review.decidedAt)}
                      </span>
                    </div>
                    {submission.review.reasonCodes.length > 0 ? (
                      <div className="mt-1 text-[var(--muted)]">
                        原因：
                        {submission.review.reasonCodes
                          .map((code) => REASON_LABEL.get(code) ?? code)
                          .join("、")}
                      </div>
                    ) : null}
                    {submission.review.reasonText ? (
                      <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">
                        {submission.review.reasonText}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
