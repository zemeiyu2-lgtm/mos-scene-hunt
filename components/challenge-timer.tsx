"use client";

/**
 * Countdown pieces for a timed challenge.
 *
 * The clock itself is data (`attemptStartedAt` in the save) - this file only
 * renders it and reports the moment it reaches zero. That split is what makes
 * the rules testable and what keeps a re-render, a route change or a reload from
 * restarting an attempt.
 */

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/game/timed-challenge";

export interface AttemptClockOptions {
  /** Stored start of the current attempt, or null when none is running. */
  startedAt: number | null;
  /** Limit in ms, or null for an untimed question. */
  limitMs: number | null;
  /** False stops the ticking (solved, expired, untimed). */
  active: boolean;
  /** Called at most once per attempt, when the countdown reaches zero. */
  onExpire: () => void;
}

export interface AttemptClockState {
  remainingMs: number | null;
  expired: boolean;
  /** False until the first client-side tick, so SSR markup never disagrees. */
  ready: boolean;
}

const TICK_MS = 250;

export function useAttemptClock({
  startedAt,
  limitMs,
  active,
  onExpire,
}: AttemptClockOptions): AttemptClockState {
  // `null` until mounted: the server cannot know the player's clock, and
  // rendering a guess would be a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);
  /** Which attempt's expiry was already reported - the exactly-once latch. */
  const firedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!active || limitMs === null || startedAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [active, limitMs, startedAt]);

  const running = active && limitMs !== null && startedAt !== null && now !== null;
  const remainingMs = running
    ? // Clamped to the limit so a retry never briefly shows more than the full
      // window while the first tick is still catching up.
      Math.min(limitMs!, Math.max(0, startedAt! + limitMs! - now!))
    : null;
  const expired = running && remainingMs === 0;

  useEffect(() => {
    if (!expired || startedAt === null) return;
    if (firedFor.current === startedAt) return;
    firedFor.current = startedAt;
    onExpire();
  }, [expired, startedAt, onExpire]);

  return { remainingMs, expired, ready: now !== null };
}

export function ChallengeTimerBar({
  remainingMs,
  attempt,
  limitLabel,
  ready,
}: {
  remainingMs: number | null;
  attempt: number;
  limitLabel: string;
  ready: boolean;
}) {
  const urgent = remainingMs !== null && remainingMs <= 10_000;
  return (
    <div
      data-role="challenge-timer"
      className={`mb-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
        urgent
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-[var(--line)] bg-[var(--surface)] text-[var(--fg)]"
      }`}
    >
      <span className="text-[12px] font-semibold">
        限时作答 · 第 {attempt} 次尝试
      </span>
      <span className="flex items-baseline gap-1">
        <span className="text-[11px] text-[var(--muted)]">剩余</span>
        <span
          data-role="challenge-remaining"
          className="text-[17px] font-bold tabular-nums"
          aria-live="off"
        >
          {ready && remainingMs !== null ? formatClock(remainingMs) : "--:--"}
        </span>
        <span className="text-[10.5px] text-[var(--muted)]">/ {limitLabel}</span>
      </span>
    </div>
  );
}

export function ChallengeExpiredPanel({
  attempt,
  limitLabel,
  onRetry,
}: {
  attempt: number;
  limitLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      data-role="challenge-expired"
      className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3"
    >
      <p className="text-[13.5px] font-bold text-red-800">时间到 · 本次尝试未完成</p>
      <p className="mt-0.5 text-[12px] leading-snug text-red-700">
        第 {attempt} 次尝试已超时（限时 {limitLabel}），这一次的答案不再计入。
        重试会重新获得完整的 {limitLabel}，之前答对的题目进度、奖励都不会受影响。
      </p>
      <button
        type="button"
        data-role="challenge-retry"
        className="btn btn-primary mt-2 h-9 min-h-0 px-3 text-xs"
        onClick={onRetry}
      >
        重试（第 {attempt + 1} 次尝试）
      </button>
    </div>
  );
}
