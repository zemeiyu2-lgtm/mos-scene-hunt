"use client";

/**
 * 城市归属 — the creator-side card (V2.0 §2 five-state model).
 *
 * State truth comes from the SERVER (`WorkRecord.cityIntent` + `cityId`); the
 * local buffer below only covers the one gap the server cannot fill — a pack
 * that has never been submitted has no `WorkRecord` yet, so there is nothing to
 * attach the decision to. The moment the submit succeeds the buffer is pushed
 * to the server, and from then on the server wins.
 *
 * Deliberate product rules:
 *  - "not decided" and "skipped" are different states, and neither is an error;
 *  - a failed association is NEVER rendered as skipped;
 *  - skip is a real, visible choice, so nobody thinks a city is required;
 *  - only `pending` blocks publishing (the block itself is server-side; this
 *    card only explains it).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  attachCity,
  INVALID_CITY_ID,
  loadCityList,
  loadWorkCity,
  mapCityAssociation,
  saveCityIntent,
  type PublicCitySummary,
  type WorkCityPayload,
} from "@/lib/cities/client";

const BUFFER_KEY = "mos-scene-hunt:city-intent/v1";

interface Buffer {
  gameId: string | null;
  mode: "pending" | "skipped";
  cityId?: string;
  cityName?: string;
  countryCode?: string;
}

function readBuffer(): Buffer | null {
  try {
    const raw = window.localStorage.getItem(BUFFER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Buffer;
    if (parsed?.mode !== "pending" && parsed?.mode !== "skipped") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBuffer(value: Buffer | null): void {
  try {
    if (!value) window.localStorage.removeItem(BUFFER_KEY);
    else window.localStorage.setItem(BUFFER_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the card still works for a work that already exists
    // server-side, it just cannot remember a pre-submit choice.
  }
}

export function CityAssociation({
  gameId,
  submittedGameId,
}: {
  /** The pack being edited (its id equals the future work id). */
  gameId: string | null;
  /** Set by the designer right after a successful submit. */
  submittedGameId: string | null;
}) {
  const [server, setServer] = useState<WorkCityPayload | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [buffer, setBuffer] = useState<Buffer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cities, setCities] = useState<PublicCitySummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const linkedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!gameId) {
      setExists(false);
      return;
    }
    const result = await loadWorkCity(gameId);
    if (result.ok) {
      setSignedOut(false);
      setExists(true);
      setServer(result.data);
      return;
    }
    // Each failure keeps its own meaning: no work yet (404) is not the same as
    // "not signed in", and a network error must not erase what we knew before.
    if (result.error.kind === "unauthorized") {
      setSignedOut(true);
      setExists(null);
      return;
    }
    if (result.error.kind === "not_found") {
      setExists(false);
      setServer(null);
      return;
    }
    if (result.error.kind === "forbidden") {
      setSignedOut(true);
      setExists(null);
      return;
    }
    // network / http / malformed: keep the previous knowledge untouched.
  }, [gameId]);

  useEffect(() => {
    setBuffer(readBuffer());
    void refresh();
  }, [refresh]);

  const openPicker = async () => {
    setPickerOpen(true);
    setNotice(null);
    if (cities.length) return;
    // Picker scope: published cities PLUS the cities this author's own works are
    // attached to. Never other authors' draft cities — the server enforces it,
    // and the data layer keys its cache by view so a public list cannot leak in.
    const result = await loadCityList({ view: "picker" });
    if (result.ok) {
      setCities(result.data);
      return;
    }
    if (result.error.kind === "unauthorized") {
      setSignedOut(true);
      return;
    }
    setNotice(
      result.error.kind === "network"
        ? "网络连接失败，城市列表暂时无法读取，请稍后重试。"
        : "城市列表暂时无法读取，请稍后重试。",
    );
  };

  const attach = async (cityId: string): Promise<boolean> => {
    if (!gameId) return false;
    const result = await attachCity(gameId, cityId);
    if (result.ok) {
      linkedRef.current = true;
      writeBuffer(null);
      setBuffer(null);
      await refresh();
      setNotice(null);
      return true;
    }
    // A failure stays a failure: the caller records the pending decision and
    // offers a retry. It is never rewritten into "skipped".
    return false;
  };

  /**
   * Persist "chose a city, association not done yet" on the SERVER, so the state
   * survives a closed tab and a different device. `attempts > 0` is what makes
   * the UI say "failed / unknown" instead of "processing".
   */
  const recordFailure = async (cityId: string, cityName?: string, countryCode?: string) => {
    if (!gameId) return;
    await saveCityIntent(gameId, {
      action: "select",
      cityId,
      cityName,
      countryCode,
      attempts: 1,
      lastError: "attach_failed",
    });
    await refresh();
  };

  const choose = async (city: PublicCitySummary) => {
    if (busy) return;
    setBusy(true);
    setPickerOpen(false);
    try {
      const choice: Buffer = {
        gameId,
        mode: "pending",
        cityId: city.cityId,
        cityName: city.cityName,
        countryCode: city.countryCode,
      };
      setBuffer(choice);
      writeBuffer(choice);

      // No WorkRecord yet (never submitted): the decision waits locally until
      // the submit succeeds, then `submittedGameId` triggers the push.
      if (!exists) {
        setNotice("已选择城市。提交后会自动建立关联；关联完成前不会进入公开目录。");
        return;
      }

      // Persist the decision FIRST, so a failure below is recoverable rather
      // than looking like "never chose a city".
      await saveCityIntent(gameId!, {
        action: "select",
        cityId: city.cityId,
        cityName: city.cityName,
        countryCode: city.countryCode,
      });

      const ok = await attach(city.cityId);
      if (ok) {
        setNotice(`已关联到 ${city.cityName}。`);
      } else {
        await recordFailure(city.cityId, city.cityName, city.countryCode);
        setNotice("城市已选择，但关联尚未完成。请重试；完成后才能发布。");
      }
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const choice: Buffer = { gameId, mode: "skipped" };
      setBuffer(choice);
      writeBuffer(choice);
      setPickerOpen(false);
      if (exists && gameId) {
        const result = await saveCityIntent(gameId, { action: "skip" });
        if (!result.ok) setNotice("已在本机记录「暂不关联」，服务器稍后会同步。");
        else await refresh();
      } else {
        setNotice("已记录「暂不关联城市」，可以正常提交和发布。");
      }
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    const target =
      association.kind === "pending_waiting" || association.kind === "pending_failed"
        ? { cityId: association.cityId, cityName: association.cityName }
        : { cityId: buffer?.cityId ?? null, cityName: buffer?.cityName ?? null };
    if (!target.cityId || busy) return;
    setBusy(true);
    try {
      const ok = await attach(target.cityId);
      if (!ok) {
        await recordFailure(target.cityId, target.cityName ?? undefined);
        setNotice("仍然没有关联成功。可以稍后再试，或先标记为「暂不关联城市」。");
      }
    } finally {
      setBusy(false);
    }
  };

  /* After a successful submit: flush the buffered decision to the server. */
  useEffect(() => {
    if (!submittedGameId) return;
    const pending = readBuffer();
    if (!pending || pending.mode !== "pending" || !pending.cityId) return;
    let alive = true;
    (async () => {
      const ok = await attach(pending.cityId!);
      if (!alive) return;
      if (!ok) {
        await recordFailure(pending.cityId!, pending.cityName, pending.countryCode);
        setNotice("作品已提交，但城市关联还没完成。关联完成前不会公开发布，请重试。");
      } else {
        setNotice("作品已提交，城市关联完成。审核通过并发布后才会进入城市目录。");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedGameId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cities;
    return cities.filter((city) =>
      [city.cityName, city.countryName, city.adminAreaName ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [cities, query]);

  /*
   * All five states come from ONE mapping function, so "unset", "waiting",
   * "failed" and "skipped" can never drift apart between screens. Nothing here
   * reads `cityId === null` as a decision.
   */
  const association = mapCityAssociation(server);
  const linkedCityId = association.kind === "associated" ? association.cityId : null;
  const failed = association.kind === "pending_failed";
  const waiting = association.kind === "pending_waiting";
  const skipped = association.kind === "skipped";
  /**
   * A stored `cityId` that is not a legal city id. Retrying it would fail the
   * same way, so the card offers "重新选择城市" instead of "重试关联" — and it
   * never renders the value as a city name.
   */
  const damaged = association.kind === "pending_failed" && association.lastError === INVALID_CITY_ID;
  const pendingLabel =
    association.kind === "pending_waiting" || association.kind === "pending_failed"
      ? (association.cityName ?? association.cityId ?? "已选择的城市")
      : null;
  // No server record yet (never submitted, or the intent write itself failed):
  // the local buffer is the only thing standing in for the decision.
  const bufferedPending = association.kind === "unset" && buffer?.mode === "pending" ? buffer : null;

  return (
    <section className="mt-5" aria-labelledby="city-association-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id="city-association-title" className="text-[15px] font-bold">
          城市归属
        </h3>
        <span className="text-[12px] text-[var(--muted)]">可选</span>
      </div>

      <div className="card p-4">
        {linkedCityId ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="chip bg-[var(--ok-bg-strong)] text-[var(--ok-strong)]">
                ✓ 已关联：{server?.city?.cityName ?? linkedCityId}
              </span>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
                公开可见后，城市归属只能由管理员修改。
              </p>
            </div>
          </div>
        ) : failed ? (
          <div className="rounded-xl border border-[var(--err-border)] bg-[var(--err-bg)] p-3">
            <p className="text-[13px] font-semibold text-[var(--err-text)]">
              {damaged ? "⚠ 城市归属记录异常，请重新选择" : "⚠ 关联尚未完成，请检查或重试"}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--err-text)]">
              {damaged
                ? "这件作品记录的城市标识无法识别，可能是历史数据或写入异常。重新选择一次城市即可修复；在此之前作品不能公开发布。"
                : `已选择 ${pendingLabel}，但还没有建立关联。关联完成前作品不能公开发布。`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {damaged ? (
                <button type="button" className="btn btn-secondary min-h-10 px-3 text-sm" onClick={() => void openPicker()} disabled={busy}>
                  重新选择城市
                </button>
              ) : (
                <button type="button" className="btn btn-secondary min-h-10 px-3 text-sm" onClick={() => void retry()} disabled={busy}>
                  {busy ? "正在重试…" : "重试关联"}
                </button>
              )}
              <button type="button" className="btn btn-ghost min-h-10 px-3 text-sm" onClick={() => void skip()} disabled={busy}>
                改为暂不关联
              </button>
            </div>
          </div>
        ) : waiting ? (
          <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-3">
            <p className="text-[13px] font-semibold text-[var(--warn-text)]">
              城市关联处理中：{pendingLabel}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--warn-text)]">
              关联完成前作品不能公开发布，稍候会自动完成。
            </p>
            <button type="button" className="btn btn-secondary mt-3 min-h-10 px-3 text-sm" onClick={() => void retry()} disabled={busy}>
              立即重试
            </button>
          </div>
        ) : skipped ? (
          <div>
            <span className="chip bg-slate-100 text-slate-600">暂不关联城市</span>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
              不影响提交和发布。之后想加入城市，可以再回来选择。
            </p>
            <button type="button" className="btn btn-secondary mt-3 min-h-10 px-3 text-sm" onClick={() => void openPicker()} disabled={busy}>
              选择城市
            </button>
          </div>
        ) : bufferedPending ? (
          <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-3">
            <p className="text-[13px] font-semibold text-[var(--warn-text)]">
              已选择：{bufferedPending.cityName}（提交后自动关联）
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--warn-text)]">
              尚未提交到服务器，因此还没有关联。提交成功后会自动建立。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost min-h-10 px-3 text-sm" onClick={() => void skip()} disabled={busy}>
                改为暂不关联
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[13px] leading-relaxed">
              尚未选择城市。选择后，作品发布时会出现在这座城市里，读者可以从城市找到它。
            </p>
            <p className="mt-1 text-[12px] text-[var(--muted)]">不选择也可以照常提交和发布。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary min-h-10 px-3 text-sm" onClick={() => void openPicker()} disabled={busy}>
                选择城市
              </button>
              <button type="button" className="btn btn-ghost min-h-10 px-3 text-sm" onClick={() => void skip()} disabled={busy}>
                暂不关联
              </button>
            </div>
          </div>
        )}

        {signedOut ? (
          <p className="mt-3 text-[12px] text-[var(--muted)]">
            城市关联需要登录后台账号：
            <Link href="/admin/login" className="underline">
              去登录
            </Link>
            。未登录时仍可保存到本机和生成分享链接。
          </p>
        ) : null}

        {notice ? (
          <p role="status" className="mt-3 rounded-lg bg-[var(--surface)] p-2 text-[12px] leading-relaxed text-[var(--muted)]">
            {notice}
          </p>
        ) : null}

        {pickerOpen ? (
          <div className="mt-3 rounded-xl border border-[var(--line)] p-3">
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索城市"
                className="min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[14px] outline-none focus:border-[var(--accent-deep)]"
              />
              <button type="button" className="btn btn-ghost min-h-10 px-2 text-sm" onClick={() => setPickerOpen(false)}>
                取消
              </button>
            </div>
            <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto">
              {filtered.map((city) => (
                <li key={city.cityId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--surface)]"
                    onClick={() => void choose(city)}
                    disabled={busy}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{city.cityName}</span>
                      <span className="block truncate text-[12px] text-[var(--muted)]">
                        {city.countryName} · {city.gameCount} 个公开探索包
                      </span>
                    </span>
                    <span className="chip shrink-0">{city.countryCode}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 ? (
                <li className="px-2 py-3 text-center text-[12px] text-[var(--muted)]">
                  没有可选择的城市。城市档案只能由已有探索包的作者建立，请先发布一个探索包，或稍后再试。
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
