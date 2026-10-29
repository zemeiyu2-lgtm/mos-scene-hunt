"use client";

import { useState } from "react";

/**
 * Self-service password change.
 *
 * Three outcomes are reported differently on purpose, because the wrong copy
 * makes the user do the wrong thing:
 *  - complete: password changed, every session revoked, audit written;
 *  - partial:  password changed and every old session is dead, but session
 *              cleanup or the audit write did not fully succeed (server logs
 *              it, the admin should know);
 *  - unknown:  the request never produced a readable answer (network error,
 *              timeout, non-JSON body). The change may or may not have
 *              happened, so the user is told to test the NEW password first —
 *              never to re-submit the old one, which would only burn through
 *              the rate limit and the lockout counter.
 *
 * No automatic redirect: the server already cleared the cookie, so navigating
 * would bounce to the login page and hide the message the user has to read.
 */

type Result =
  | { kind: "complete"; message: string }
  | { kind: "partial"; message: string }
  | { kind: "unknown"; message: string };

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    let response: Response | null = null;
    let payload: {
      message?: string;
      status?: string;
      passwordChanged?: boolean;
      sessionsRevoked?: number;
      sessionsFailed?: number;
      auditRecorded?: boolean;
    } = {};
    try {
      response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      payload = (await response.json().catch(() => ({}))) as typeof payload;
    } catch {
      // No readable answer from the server: the outcome is genuinely unknown.
      setResult({
        kind: "unknown",
        message:
          "无法确认本次修改是否成功（网络中断或响应超时）。请先直接用新密码登录：若能登录，说明修改已成功，旧会话也已全部失效；若新密码不能登录、旧密码仍可用，再重新提交一次。请勿用旧密码反复提交，否则会触发限流与锁定。",
      });
      return;
    } finally {
      setBusy(false);
    }

    if (!response.ok) {
      // The server only returns a non-2xx status before the commit point
      // (wrong password, weak password, rate limit, store read/write failure),
      // so nothing has changed and retrying with the current password is safe.
      setError(payload.message ?? "修改失败，请稍后重试。");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setResult(
      payload.status === "partial"
        ? {
            kind: "partial",
            message:
              payload.message ??
              "密码已修改，旧会话已全部失效；但会话清理或审计留痕未完全成功，已记录异常供运维核查。请用新密码重新登录，不要再用旧密码重复提交。",
          }
        : { kind: "complete", message: payload.message ?? "密码已修改，请使用新密码重新登录。" },
    );
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--text)]";

  if (result) {
    const tone =
      result.kind === "complete"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
        : result.kind === "partial"
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-slate-300 bg-slate-50 text-slate-900";
    const title =
      result.kind === "complete"
        ? "密码已修改"
        : result.kind === "partial"
          ? "密码已修改（部分收尾未完成）"
          : "修改结果未知";
    return (
      <div className="max-w-md space-y-4 rounded-xl bg-[var(--card)] p-6 shadow-card">
        <div className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>
          <p className="font-medium">{title}</p>
          <p className="mt-1 leading-relaxed">{result.message}</p>
        </div>
        <a
          href="/admin/login?relogin=1"
          className="block w-full rounded-lg bg-[var(--text)] px-4 py-2 text-center text-sm font-medium text-white"
        >
          前往登录页
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-4 rounded-xl bg-[var(--card)] p-6 shadow-card">
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--muted)]">当前密码</span>
        <input
          type="password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className={inputClass}
          autoComplete="current-password"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--muted)]">新密码（至少 12 个字符）</span>
        <input
          type="password"
          required
          minLength={12}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className={inputClass}
          autoComplete="new-password"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--muted)]">确认新密码</span>
        <input
          type="password"
          required
          minLength={12}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className={inputClass}
          autoComplete="new-password"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-[var(--text)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "提交中…" : "修改密码并退出登录"}
      </button>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        修改成功后，该账号在所有设备上的登录都会失效，需要用新密码重新登录。请先在本机确认新密码可用，再离开此页面。
      </p>
    </form>
  );
}
