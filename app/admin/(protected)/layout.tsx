import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server-session";
import { ROLE_LABEL } from "@/lib/registry/labels";
import { AdminNav } from "./admin-nav";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export const metadata = { title: "后台 · MOS Scene Hunt" };

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requirePageSession();

  return (
    <div className="min-h-dvh bg-[var(--surface)] text-[var(--text)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="text-sm font-semibold">
            MOS Scene Hunt 后台
          </Link>
          <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
            <span>
              {user.displayName} · {ROLE_LABEL[user.role]}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-44 md:shrink-0">
          <AdminNav role={user.role} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
