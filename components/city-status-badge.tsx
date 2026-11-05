/**
 * 城市归属五态徽标 — ONE vocabulary for the creator card and the admin table.
 *
 * Deliberately dumb: it renders what `CityAssociation` says and nothing else.
 * No fetching, no inference, no "if cityId is empty then skipped". Every
 * judgement lives in `mapAssociation`, so the two screens can never drift.
 *
 * No new tokens or fonts: chips reuse the existing semantic pairs (ok / warn /
 * err / slate / surface) and the tier-0 12px label size.
 */

import { CITY_PROFILE_MISSING, INVALID_CITY_ID, type CityAssociation } from "@/lib/cities/client";

export const CITY_STATE_LABEL: Record<CityAssociation["kind"], string> = {
  associated: "已关联",
  pending_waiting: "待关联",
  pending_failed: "关联失败",
  skipped: "暂不关联",
  unset: "未选择",
};

/** Colour pairing per state. Icon + text too, so colour is never the only cue. */
const TONE: Record<CityAssociation["kind"], string> = {
  associated: "bg-[var(--ok-bg-strong)] text-[var(--ok-strong)]",
  pending_waiting: "bg-[var(--warn-bg-strong)] text-[var(--warn-text)]",
  pending_failed: "bg-[var(--err-bg-strong)] text-[var(--err-text)]",
  skipped: "bg-slate-100 text-slate-600",
  unset: "bg-[var(--surface)] text-[var(--muted)]",
};

export function cityStateTone(state: CityAssociation): string {
  return TONE[state.kind];
}

/**
 * The short label. A city name is only shown for a VALID association, so a
 * corrupt id can never be rendered as if it were a city.
 */
export function cityStateLabel(state: CityAssociation): string {
  switch (state.kind) {
    case "associated":
      return `✓ ${state.cityName ?? state.cityId}`;
    case "pending_waiting":
      return "待关联";
    case "pending_failed":
      if (state.lastError === INVALID_CITY_ID) return "⚠ 关联记录异常";
      if (state.lastError === CITY_PROFILE_MISSING) return "⚠ 城市档案缺失";
      return "⚠ 关联失败";
    case "skipped":
      return "暂不关联";
    case "unset":
      return "—";
  }
}

export function CityStatusBadge({
  state,
  className = "",
}: {
  state: CityAssociation;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${TONE[state.kind]} ${className}`}
    >
      {cityStateLabel(state)}
    </span>
  );
}
