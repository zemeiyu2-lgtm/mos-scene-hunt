"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Self-service password change. On success the server has revoked every
 * session (including this one) and cleared the cookie — the only correct
 * next step is a fresh login.
 */
export function PasswordChangeForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? "修改失败，请稍后重试。");
        return;
      }
      router.push("/admin/login?relogin=1");
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--text)]";

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
    </form>
  );
}
