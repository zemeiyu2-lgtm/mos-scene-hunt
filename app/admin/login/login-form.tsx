"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Login form.
 *
 * A single error string is shown for every failure: the server deliberately
 * does not distinguish "no such account" from "wrong password", and the client
 * must not invent that distinction.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? `登录失败（HTTP ${res.status}）`);
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("网络错误，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-[var(--text)]">
          邮箱
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent-deep)]"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[var(--text)]">
          密码
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent-deep)]"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-[var(--text)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
