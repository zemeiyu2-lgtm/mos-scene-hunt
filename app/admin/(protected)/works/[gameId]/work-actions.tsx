"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { REVIEW_REASON_CODES } from "@/lib/registry/labels";
import type { Role, WorkState } from "@/lib/registry/types";

type Action =
  | "claim"
  | "decision"
  | "publish"
  | "transfer"
  | "withdraw"
  | "unlist"
  | "restore"
  | "archive";

interface Props {
  gameId: string;
  state: WorkState;
  role: Role;
  /** Version currently in review, used to label the decision panel. */
  reviewingVersionId: string | null;
  /** True when some submission is waiting to be claimed. */
  hasPendingSubmission: boolean;
  /** True when some submission is claimed and awaiting a decision. */
  hasInReviewSubmission: boolean;
  /** True when an approved version is waiting to be promoted. */
  hasApprovedUnpublished: boolean;
  /** Current owner, shown so a reassignment is never blind. */
  ownerUserId: string;
  /**
   * Accounts an admin may hand the work to. Empty for non-admins — the list is
   * only fetched server-side when the viewer can actually use it.
   */
  assignableUsers: { id: string; label: string }[];
}

const RANK: Record<Role, number> = { creator: 1, reviewer: 2, admin: 3 };

/**
 * Work actions.
 *
 * The buttons shown here are a convenience, not the security boundary: every
 * endpoint re-checks the role. Hiding a button never substitutes for that, and
 * a hidden button is still reachable by calling the API directly (which the
 * integration tests do).
 */
export function WorkActions({
  gameId,
  state,
  role,
  reviewingVersionId,
  hasPendingSubmission,
  hasInReviewSubmission,
  hasApprovedUnpublished,
  ownerUserId,
  assignableUsers,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showDecision, setShowDecision] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [reasonCodes, setReasonCodes] = useState<string[]>([]);
  const [reasonText, setReasonText] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({
    played: false,
    coordinates: false,
    content: false,
  });

  const staff = RANK[role] >= RANK.reviewer;
  const admin = RANK[role] >= RANK.admin;

  async function call(action: Action, body?: unknown) {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/works/${encodeURIComponent(gameId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; work?: { state?: string } };
      if (!res.ok) {
        setError(data.message ?? `操作失败（HTTP ${res.status}）`);
        return;
      }
      setMessage("已更新。");
      setShowDecision(false);
      setShowTransfer(false);
      setTransferTo("");
      setReasonCodes([]);
      setReasonText("");
      startTransition(() => router.refresh());
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setBusy(null);
    }
  }

  async function submitDecision(decision: "approve" | "request_changes" | "reject") {
    if (decision !== "approve" && reasonCodes.length === 0) {
      setError("退回或拒绝必须至少选择一个原因。");
      return;
    }
    await call("decision", { decision, reasonCodes, reasonText, checklist });
  }

  const disabled = busy !== null || pending;

  return (
    <section className="rounded-xl bg-[var(--card)] p-4 shadow-card">
      <h2 className="text-sm font-semibold">操作</h2>

      {!staff ? (
        <p className="mt-2 text-sm text-[var(--muted)]">
          作品提交后由审核者处理。审核通过并由管理员发布后，玩家才能看到。
          退回原因会显示在下方提交历史中。
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {staff && hasPendingSubmission ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => call("claim")}
            className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === "claim" ? "领取中…" : "领取审核"}
          </button>
        ) : null}

        {staff && hasInReviewSubmission ? (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowDecision((v) => !v)}
              className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {showDecision ? "收起审核表单" : "填写审核决定"}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => submitDecision("approve")}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              直接通过
            </button>
          </>
        ) : null}

        {admin && hasApprovedUnpublished ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => call("publish")}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === "publish" ? "发布中…" : "发布到公开"}
          </button>
        ) : null}

        {admin && (state === "published" || state === "unlisted") ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => call("withdraw")}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            撤下（公开读取立即 404）
          </button>
        ) : null}

        {admin && state === "published" ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => call("unlist")}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
          >
            仅从目录下架（链接仍可玩）
          </button>
        ) : null}

        {admin && (state === "withdrawn" || state === "unlisted" || state === "archived") ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => call("restore")}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
          >
            恢复发布
          </button>
        ) : null}

        {admin && state !== "archived" && state !== "in_review" ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => call("archive")}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] disabled:opacity-50"
          >
            归档
          </button>
        ) : null}

        {admin && assignableUsers.length > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowTransfer((v) => !v)}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
          >
            {showTransfer ? "收起归属转移" : "转移作品归属"}
          </button>
        ) : null}
      </div>

      {showTransfer && admin ? (
        <div className="mt-4 space-y-3 rounded-lg border border-[var(--line)] p-3">
          <p className="text-xs text-[var(--muted)]">
            当前归属账号 <span className="font-mono">{ownerUserId}</span>。
            转移只改变「谁能提交后续版本」，不会改变作品状态，也不会改变线上正在展示的版本。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={transferTo}
              onChange={(event) => setTransferTo(event.target.value)}
              className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 py-1.5 text-xs"
            >
              <option value="">选择目标账号…</option>
              {assignableUsers
                .filter((u) => u.id !== ownerUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={disabled || transferTo === ""}
              onClick={() => call("transfer", { toUserId: transferTo })}
              className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "transfer" ? "转移中…" : "确认转移"}
            </button>
          </div>
        </div>
      ) : null}

      {showDecision && staff && hasInReviewSubmission ? (
        <div className="mt-4 space-y-3 rounded-lg border border-[var(--line)] p-3">
          <p className="text-xs text-[var(--muted)]">
            正在审核版本 <span className="font-mono">{reviewingVersionId ?? "—"}</span>
          </p>
          <fieldset>
            <legend className="text-xs font-medium">原因（退回 / 拒绝必选）</legend>
            <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {REVIEW_REASON_CODES.map((item) => (
                <label key={item.code} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={reasonCodes.includes(item.code)}
                    onChange={(e) =>
                      setReasonCodes((prev) =>
                        e.target.checked
                          ? [...prev, item.code]
                          : prev.filter((code) => code !== item.code),
                      )
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="reasonText" className="text-xs font-medium">
              给作者的说明（会原样展示）
            </label>
            <textarea
              id="reasonText"
              rows={3}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
            />
          </div>
          <fieldset>
            <legend className="text-xs font-medium">审核清单</legend>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {[
                { key: "played", label: "已试玩" },
                { key: "coordinates", label: "坐标合理" },
                { key: "content", label: "无违规内容" },
              ].map((item) => (
                <label key={item.key} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={checklist[item.key] ?? false}
                    onChange={(e) =>
                      setChecklist((prev) => ({ ...prev, [item.key]: e.target.checked }))
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => submitDecision("approve")}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              通过
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => submitDecision("request_changes")}
              className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              退回修改
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => submitDecision("reject")}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              拒绝
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</p>
      ) : null}
    </section>
  );
}
