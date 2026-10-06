"use client";

/**
 * Shared presentational primitives.
 *
 * Kept dumb on purpose: no data fetching, no game rules. Everything here takes
 * props so the screens stay readable and the pieces stay reusable.
 */

import type { ReactNode } from "react";
import type { SceneStatus } from "@/lib/game/state";
import { formatDistance } from "@/lib/location";
import { SoundToggle } from "@/components/sound";

/* ------------------------------------------------------------------ */
/* Status presentation                                                */
/* ------------------------------------------------------------------ */

export const STATUS_LABEL: Record<SceneStatus, string> = {
  locked: "未解锁",
  available: "待前往",
  arrived: "已到达",
  challenging: "答题中",
  completed: "已完成",
};

export const STATUS_CHIP_CLASS: Record<SceneStatus, string> = {
  locked: "bg-slate-100 text-slate-500",
  available: "bg-amber-100 text-amber-800",
  arrived: "bg-blue-100 text-blue-700",
  challenging: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

export function StatusChip({ status, className = "" }: { status: SceneStatus; className?: string }) {
  return (
    <span className={`chip ${STATUS_CHIP_CLASS[status]} ${className}`}>
      {status === "completed" ? "✓ " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Distance readout                                                   */
/* ------------------------------------------------------------------ */

/**
 * The player's distance to a target.
 *
 * Shows the raw distance while approaching and switches to an explicit
 * "inside the area" confirmation once triggered - so the player is never asked
 * to interpret a number, and never expected to hit exactly 0 m (spec section 8).
 */
export function DistanceReadout({
  metres,
  radius,
  inRange,
  bearing,
}: {
  metres: number | null;
  radius: number;
  inRange: boolean;
  /** Optional compass label, e.g. "NE". */
  bearing?: string | null;
}) {
  if (metres === null) {
    return (
      <div className="text-sm text-[var(--muted)]">
        正在获取定位…
      </div>
    );
  }

  if (inRange) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold text-emerald-600">✓ 已进入任务区域</span>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm text-[var(--muted)]">距离目标：</span>
      <span className="tabular text-xl font-bold text-[var(--text)]">
        {formatDistance(metres)}
      </span>
      {bearing ? <span className="text-sm text-[var(--muted)]">· {bearing} 方向</span> : null}
      <span className="text-xs text-[var(--muted)]">（触发半径 {radius} m）</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Structure                                                          */
/* ------------------------------------------------------------------ */

export function Screen({
  title,
  subtitle,
  children,
  footer,
  headerRight,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerRight?: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="safe-top border-b border-[var(--line)] bg-[var(--card)]">
        <div className="page flex items-start justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-bold leading-tight">{title}</h1>
            {subtitle ? (
              <p className="mt-0.5 text-[13px] leading-snug text-[var(--muted)]">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5"><SoundToggle />{headerRight}</div>
        </div>
      </header>
      <div className="scroll-area">
        <div className="page py-4">{children}</div>
      </div>
      {footer ? (
        <div className="border-t border-[var(--line)] bg-[var(--card)]">
          <div className="page py-3">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}

export function ProgressBar({ ratio, className = "" }: { ratio: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-[var(--line)] ${className}`}>
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={`card p-4 ${className}`}>{children}</Tag>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] px-6 py-10 text-center">
      <p className="text-[15px] font-semibold">{title}</p>
      {hint ? <p className="mt-1 text-[13px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
      <p className="text-[15px] font-semibold text-red-800">{title}</p>
      {detail ? <p className="mt-1 text-[13px] leading-relaxed text-red-700">{detail}</p> : null}
      {onRetry ? (
        <button type="button" className="btn btn-secondary mt-3" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="grid place-items-center py-16">
      <div
        className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--line)] border-t-[var(--accent)]"
        role="status"
        aria-label={label}
      />
      <p className="mt-3 text-[13px] text-[var(--muted)]">{label}</p>
    </div>
  );
}

/** Key/value row used in the diagnostics and settings panels. */
export function KV({ k, v, mono = false }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[12px] text-[var(--muted)]">{k}</span>
      <span className={`text-right text-[12px] ${mono ? "tabular font-mono" : ""}`}>{v}</span>
    </div>
  );
}
