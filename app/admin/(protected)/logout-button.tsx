"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/admin/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-60"
    >
      {busy ? "退出中…" : "退出"}
    </button>
  );
}
