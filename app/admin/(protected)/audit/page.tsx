import { requirePageSession } from "@/lib/auth/server-session";
import { getRegistry } from "@/lib/registry/store";
import { AUDIT_ACTION_LABEL, formatTime } from "@/lib/registry/labels";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requirePageSession("admin");
  const registry = getRegistry();
  const [records, users] = await Promise.all([registry.listAudit(200), registry.listUsers()]);
  const nameById = new Map(users.map((u) => [u.id, u.displayName]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">审计日志</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          只追加，不提供删除入口。每条记录只保存状态类字段，不保存正文与个人身份信息。
        </p>
      </div>

      {records.length === 0 ? (
        <p className="rounded-xl bg-[var(--card)] p-6 text-sm text-[var(--muted)] shadow-card">
          暂无记录。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-[var(--card)] shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">时间</th>
                <th className="px-4 py-2.5 font-medium">动作</th>
                <th className="px-4 py-2.5 font-medium">操作人</th>
                <th className="px-4 py-2.5 font-medium">对象</th>
                <th className="px-4 py-2.5 font-medium">变更</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="px-4 py-2 text-xs tabular-nums text-[var(--muted)]">
                    {formatTime(record.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {AUDIT_ACTION_LABEL[record.action] ?? record.action}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {record.actorUserId
                      ? nameById.get(record.actorUserId) ?? record.actorUserId.slice(0, 8)
                      : "匿名"}
                    {record.actorRole ? (
                      <span className="ml-1 text-[var(--muted)]">({record.actorRole})</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-[var(--muted)]">
                    {record.targetType}:{record.targetId}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-[var(--muted)]">
                    {record.before ? JSON.stringify(record.before) : "—"}
                    {" → "}
                    {record.after ? JSON.stringify(record.after) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
