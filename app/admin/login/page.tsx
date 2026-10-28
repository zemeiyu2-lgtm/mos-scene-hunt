import { redirect } from "next/navigation";
import { ensureBootstrapAdmin } from "@/lib/auth/bootstrap";
import { pageSession } from "@/lib/auth/server-session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "登录 · MOS Scene Hunt 后台" };

export default async function LoginPage() {
  // One-time door: creates the first administrator from BOOTSTRAP_ADMIN_* if
  // no admin exists yet. Idempotent, and a no-op once an admin is present.
  await ensureBootstrapAdmin();

  const context = await pageSession();
  if (context) redirect("/admin");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--surface)] px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--card)] p-8 shadow-card">
        <h1 className="text-xl font-semibold text-[var(--text)]">MOS Scene Hunt 后台</h1>
        <p className="mt-1 mb-6 text-sm text-[var(--muted)]">
          仅限受邀请的创作者与管理员。玩家无需登录即可游玩。
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
