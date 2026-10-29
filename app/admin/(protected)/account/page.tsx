import { requirePageSession } from "@/lib/auth/server-session";
import { PasswordChangeForm } from "./password-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "账号与密码 · MOS Scene Hunt 后台" };

export default async function AccountPage() {
  const context = await requirePageSession("creator");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">账号与密码</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          当前登录：{context.user.email}（{context.user.role}）。修改密码后所有会话（含本机）都会失效，需要重新登录。
        </p>
      </div>
      <PasswordChangeForm />
    </div>
  );
}
