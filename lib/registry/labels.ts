/**
 * Chinese labels and visual tones for registry enums.
 *
 * Keeping them in one module means a new state cannot be added without the UI
 * failing to compile (the Records are exhaustive over the union types).
 */

import type { Role, VersionStatus, WorkState } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  creator: "创作者",
  reviewer: "审核者",
  admin: "管理员",
};

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  draft: "草稿",
  submitted: "待审核",
  in_review: "审核中",
  changes_requested: "需修改",
  approved: "已通过·待发布",
  rejected: "已拒绝",
  published: "已发布",
  unlisted: "已下架（链接可玩）",
  withdrawn: "已撤下",
  archived: "已归档",
};

/** Tailwind classes, deliberately explicit so a new state is a compile error. */
export const WORK_STATE_TONE: Record<WorkState, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-amber-100 text-amber-800",
  in_review: "bg-sky-100 text-sky-800",
  changes_requested: "bg-orange-100 text-orange-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
  published: "bg-emerald-600 text-white",
  unlisted: "bg-slate-600 text-white",
  withdrawn: "bg-red-600 text-white",
  archived: "bg-zinc-300 text-zinc-800",
};

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  pending: "待审",
  approved: "已批准",
  rejected: "已拒绝",
  superseded: "已被新版本取代",
};

export const DECISION_LABEL: Record<string, string> = {
  approve: "通过",
  request_changes: "退回修改",
  reject: "拒绝",
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "auth.login": "登录",
  "auth.login_failed": "登录失败",
  "auth.logout": "登出",
  "user.create": "创建用户",
  "user.role_change": "变更角色",
  "user.status_change": "变更状态",
  "work.submit": "提交版本",
  "work.claim_review": "领取审核",
  "review.decide": "审核决定",
  "work.publish": "发布",
  "work.withdraw": "撤下",
  "work.unlist": "下架",
  "work.restore": "恢复",
  "work.archive": "归档",
  "work.transfer_owner": "转移归属",
  "work.import_legacy": "导入历史作品",
};

/** Structured reason codes offered by the review form. */
export const REVIEW_REASON_CODES: Array<{ code: string; label: string }> = [
  { code: "content_incomplete", label: "内容不完整" },
  { code: "location_implausible", label: "坐标不合理或无法到达" },
  { code: "safety_risk", label: "存在安全隐患" },
  { code: "copyright", label: "版权或署名问题" },
  { code: "duplicate", label: "与已有作品重复" },
  { code: "quality", label: "文案或体验质量不足" },
  { code: "other", label: "其他（见说明）" },
];

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
