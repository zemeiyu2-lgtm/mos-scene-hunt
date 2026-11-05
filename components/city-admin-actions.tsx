"use client";

/**
 * 管理端「城市归属」受控修正 — the ONLY staff-facing write on the works table.
 *
 * Why it is built this way:
 *
 *  - it reuses the canonical `POST /api/works/<gameId>/city` endpoint (the same
 *    one the creator card uses), so there is no second write path and no second
 *    permission model to keep in sync;
 *  - it stays collapsed behind a small text toggle so the table keeps its row
 *    height; the actions open INSIDE the row guard, which is what makes them
 *    feel like a controlled repair tool rather than an everyday button;
 *  - every write is a two-step confirm, and the destructive one (clearing a
 *    link) is drawn with the deep warning border so it never reads as ordinary;
 *  - it never guesses: the picker is `scope=admin` (the full catalogue,
 *    including cities whose packs are all drafts), and a failed write is
 *    reported as a failed write.
 *
 * Mounted only for staff (`canManage`); the server re-checks the role on the
 * request — hiding a button is presentation, not authorisation.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { attachCity, loadCityList, type PublicCitySummary } from "@/lib/cities/client";

type Mode = "idle" | "picking" | "confirm_clear";

export function CityAdminActions({
  gameId,
  hasCity,
  canManage,
  currentName,
}: {
  gameId: string;
  /** True when the record currently holds a city link (clearable). */
  hasCity: boolean;
  canManage: boolean;
  /** Resolved name for the confirmation sentence; falls back to the id. */
  currentName?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [cities, setCities] = useState<PublicCitySummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canManage) return null;

  const openPicker = async () => {
    if (mode === "picking") {
      setMode("idle");
      return;
    }
    setMode("picking");
    setError(null);
    setDone(null);
    if (cities.length) return;
    const result = await loadCityList({ view: "admin" });
    if (result.ok) setCities(result.data);
    else setError("城市目录暂时无法读取，请稍后重试或刷新页面。");
  };

  const submit = async (cityId: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await attachCity(gameId, cityId);
    setBusy(false);
    if (!result.ok) {
      // Verbatim failure: no optimistic "done" for a write that did not land.
      setError(
        result.error.kind === "forbidden"
          ? "没有权限修改这件作品的城市归属。"
          : result.error.kind === "not_found"
            ? "作品不存在，可能已被删除。"
            : result.error.message || "城市归属没有更新成功，请重试。",
      );
      return;
    }
    setMode("idle");
    setDone(cityId === null ? "已清除城市关联" : "已更新城市关联");
    // The table is a server component: refresh re-reads the registry so the
    // badge shows the state the server actually persisted.
    router.refresh();
  };

  const filtered = cities.filter((city) =>
    query.trim()
      ? [city.cityName, city.countryName, city.adminAreaName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      : true,
  );

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-[11px] text-[var(--accent-deep)] underline underline-offset-2 disabled:opacity-50"
          onClick={() => void openPicker()}
          disabled={busy}
          aria-expanded={mode === "picking"}
        >
          {mode === "picking" ? "收起城市选择" : hasCity ? "修改关联" : "补录城市"}
        </button>
        {hasCity ? (
          <button
            type="button"
            className="text-[11px] underline underline-offset-2 disabled:opacity-50"
            style={{ color: "var(--warn-text)" }}
            onClick={() => setMode(mode === "confirm_clear" ? "idle" : "confirm_clear")}
            disabled={busy}
            aria-expanded={mode === "confirm_clear"}
          >
            清除关联
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-[11px] leading-relaxed text-[var(--err-text)]">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-1 text-[11px] text-[var(--ok-strong)]">
          {done}
        </p>
      ) : null}

      {mode === "confirm_clear" ? (
        <div className="mt-1.5 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2">
          <p className="text-[11px] leading-relaxed text-[var(--warn-text)]">
            清除后，这件作品不再属于 {currentName || "当前城市"}，已公开的作品会立即从城市目录移除。操作会写入审计记录。
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--warn-solid-deep)" }}
              onClick={() => void submit(null)}
              disabled={busy}
            >
              {busy ? "正在清除…" : "确认清除"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-[11px]"
              onClick={() => setMode("idle")}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {mode === "picking" ? (
        <div className="mt-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] p-2">
          <label className="sr-only" htmlFor={`city-admin-search-${gameId}`}>
            搜索城市
          </label>
          <input
            id={`city-admin-search-${gameId}`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索全部城市（含未公开）"
            className="min-h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[12px] outline-none focus:border-[var(--accent-deep)]"
          />
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {filtered.map((city) => (
              <li key={city.cityId}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[var(--surface)] disabled:opacity-50"
                  onClick={() => void submit(city.cityId)}
                  disabled={busy}
                >
                  <span className="min-w-0 truncate">
                    {city.cityName}
                    <span className="ml-1 text-[11px] text-[var(--muted)]">
                      {city.countryName} · {city.gameCount} 个公开包
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--muted)]">{city.countryCode}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
                没有匹配的城市档案。城市档案不能凭空创建，只能由真实探索包产生。
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
