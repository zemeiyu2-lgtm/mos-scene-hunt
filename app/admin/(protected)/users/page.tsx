import { requirePageSession } from "@/lib/auth/server-session";
import { getRegistry } from "@/lib/registry/store";
import { formatTime } from "@/lib/registry/labels";
import { toPublicUser } from "@/lib/registry/types";
import { CreateUserForm, UserRow } from "./user-admin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const { user } = await requirePageSession("admin");
  const users = await getRegistry().listUsers();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">用户与角色</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          账号只能由管理员创建。改动角色会立即让其现有会话失效——降权不需要等对方重新登录后再生效。
        </p>
      </div>

      <CreateUserForm />

      <div className="overflow-x-auto rounded-xl bg-[var(--card)] shadow-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">用户</th>
              <th className="px-4 py-2.5 font-medium">角色</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {users.map((record) => (
              <UserRow
                key={record.id}
                user={toPublicUser(record)}
                isSelf={record.id === user.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[var(--muted)]">
        最后更新：{formatTime(new Date().toISOString())}
      </p>
    </div>
  );
}
