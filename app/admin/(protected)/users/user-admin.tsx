"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ROLE_LABEL } from "@/lib/registry/labels";
import type { PublicUser, Role } from "@/lib/registry/types";

const ROLES: Role[] = ["creator", "reviewer", "admin"];

function useRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, refresh: () => start(() => router.refresh()) };
}

export function CreateUserForm() {
  const { pending, refresh } = useRefresh();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("creator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName, password, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? `创建失败（HTTP ${res.status}）`);
        return;
      }
      setCreated(email);
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("creator");
      refresh();
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-[var(--card)] p-4 shadow-card">
      <h2 className="text-sm font-semibold">新建账号（邀请制，无公开注册）</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs">
          邮箱
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs">
          显示名
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs">
          初始密码（至少 12 位）
          <input
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs">
          角色
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {created ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          已创建 {created}。请通过安全渠道把初始密码交给本人。
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || pending}
        className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? "创建中…" : "创建账号"}
      </button>
    </form>
  );
}

export function UserRow({ user, isSelf }: { user: PublicUser; isSelf: boolean }) {
  const { pending, refresh } = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { role?: Role; status?: "active" | "suspended" }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? `更新失败（HTTP ${res.status}）`);
        return;
      }
      refresh();
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="px-4 py-2.5">
        <div className="font-medium">{user.displayName}</div>
        <div className="text-[11px] text-[var(--muted)]">{user.email}</div>
        {error ? <div className="text-[11px] text-red-700">{error}</div> : null}
      </td>
      <td className="px-4 py-2.5">
        <select
          value={user.role}
          disabled={isSelf || busy || pending}
          onChange={(e) => patch({ role: e.target.value as Role })}
          className="rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-xs disabled:opacity-50"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            user.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
          }`}
        >
          {user.status === "active" ? "正常" : "已停用"}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <button
          type="button"
          disabled={isSelf || busy || pending}
          onClick={() => patch({ status: user.status === "active" ? "suspended" : "active" })}
          className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs disabled:opacity-50"
        >
          {user.status === "active" ? "停用" : "启用"}
        </button>
        {isSelf ? <span className="ml-2 text-[11px] text-[var(--muted)]">（本人）</span> : null}
      </td>
    </tr>
  );
}
