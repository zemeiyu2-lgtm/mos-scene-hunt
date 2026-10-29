/**
 * Timed challenge (V1.0) - pure timing helpers.
 *
 * Design constraints that shaped this module:
 *
 *  1. The clock is DATA, not a component-local timer. The start stamp lives in
 *     `SceneProgress.attemptStartedAt` and is persisted with the rest of the
 *     save, so a re-render, a route change or a page reload can never restart
 *     (or silently extend) an attempt. The UI only renders `now` against the
 *     stored stamp.
 *  2. Every decision is a pure function of (challenge, progress, now), so the
 *     engine and the screen can never disagree - and tests can drive time
 *     explicitly instead of sleeping.
 *  3. A challenge without `timeLimitSeconds` is untimed: `phase()` reports
 *     "untimed" and the engine skips the whole timed branch, so old packs keep
 *     the V0.1 behaviour byte for byte.
 *
 * Nothing here imports `state.ts` (which imports this module) - the progress
 * shape is declared structurally instead.
 */

import type { Challenge } from "./types";

/** The slice of `SceneProgress` the timed rules need. */
export interface AttemptTiming {
  attempts: number;
  attemptStartedAt?: number;
  timedOutAt?: number;
}

export type TimedPhase = "untimed" | "idle" | "running" | "expired";

/** Milliseconds for a declared limit, or null when the challenge is untimed. */
export function timeLimitMs(challenge: Challenge | null | undefined): number | null {
  const seconds = challenge?.timeLimitSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

export function hasTimeLimit(challenge: Challenge | null | undefined): boolean {
  return timeLimitMs(challenge) !== null;
}

/**
 * Where this attempt stands right now.
 *
 * `idle` means the question is timed but its clock has not started yet (the
 * screen stamps it on mount); `expired` is sticky through `timedOutAt` so the
 * state survives a reload - otherwise reloading a timed-out question would
 * hand the player a fresh window.
 */
export function timedPhase(
  challenge: Challenge | null | undefined,
  progress: AttemptTiming | null | undefined,
  now: number,
): TimedPhase {
  const limit = timeLimitMs(challenge);
  if (limit === null) return "untimed";
  if (!progress) return "idle";
  if (progress.timedOutAt !== undefined) return "expired";
  const startedAt = progress.attemptStartedAt;
  if (startedAt === undefined) return "idle";
  return now - startedAt >= limit ? "expired" : "running";
}

/** Remaining milliseconds, or null when there is no running clock. */
export function remainingMs(
  challenge: Challenge | null | undefined,
  progress: AttemptTiming | null | undefined,
  now: number,
): number | null {
  const limit = timeLimitMs(challenge);
  if (limit === null || !progress || progress.attemptStartedAt === undefined) return null;
  return Math.max(0, progress.attemptStartedAt + limit - now);
}

/**
 * 1-based number of the attempt the player is on.
 *
 * `attempts` keeps its V0.1 meaning (failed attempts, drives hint reveal), so
 * the attempt in progress is always `attempts + 1`. A timeout is recorded as a
 * failed attempt the moment it is detected - exactly once - which is why
 * clicking 重试 shows the next number without ever double counting.
 */
export function attemptNumber(progress: AttemptTiming | null | undefined): number {
  return (progress?.attempts ?? 0) + 1;
}

/** m:ss for the countdown, e.g. 90_000 -> "1:30". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Human label for the configured limit, e.g. "90 秒" / "2 分钟". */
export function formatLimit(challenge: Challenge | null | undefined): string {
  const seconds = challenge?.timeLimitSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/* ------------------------------------------------------------------ */
/* Designer-side parsing                                              */
/* ------------------------------------------------------------------ */

export interface ParsedLimit {
  /** null means "no limit" (empty input). */
  seconds: number | null;
  error: string | null;
}

/**
 * Parse the designer's 限时 input.
 *
 * Empty is a valid choice ("untimed"). Anything else must be a positive whole
 * number of seconds, because a fractional limit can never be typed back into
 * the field and would make the round trip lossy.
 */
export function parseTimeLimitInput(raw: string): ParsedLimit {
  const text = raw.trim();
  if (!text) return { seconds: null, error: null };
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return { seconds: null, error: "请填写数字秒数" };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return { seconds: null, error: "限时必须大于 0 秒" };
  }
  if (!Number.isInteger(value)) {
    return { seconds: null, error: "请填写整数秒" };
  }
  return { seconds: value, error: null };
}

/** Set or clear `timeLimitSeconds`, leaving every sibling field untouched. */
export function withTimeLimitSeconds(challenge: Challenge, seconds: number | null): Challenge {
  const next: Challenge = { ...challenge };
  if (seconds === null) {
    delete next.timeLimitSeconds;
    return next;
  }
  next.timeLimitSeconds = seconds;
  return next;
}

/** What the designer input should display for this challenge. */
export function timeLimitInputValue(challenge: Challenge | null | undefined): string {
  const seconds = challenge?.timeLimitSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) ? String(seconds) : "";
}
