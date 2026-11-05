"use client";

/**
 * 城市探索 — the city catalogue.
 *
 * Level 2 of the discovery path: Game Center → **cities** → city content.
 * Reuses the existing Screen/Card/EmptyState/ErrorState primitives and the
 * outdoor type scale; no new tokens, no images, no map components.
 *
 * Two decisions worth stating:
 *
 *  - the search is LOCAL. The whole catalogue is already in memory (it is one
 *    request, and the public set is a handful of cities), so typing must not
 *    fire a request per keystroke: filtering happens on the array we have, and
 *    the server-side `q` parameter stays available for when the catalogue
 *    outgrows one page.
 *  - the list holds no interactive controls except the search field: the card
 *    itself is the target, so a phone user never has to aim at a small button.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState, Screen } from "@/components/ui";
import { loadCityList, type CityError, type PublicCitySummary } from "@/lib/cities/client";

export default function CitiesPage() {
  const [cities, setCities] = useState<PublicCitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<CityError | null>(null);
  const [query, setQuery] = useState("");

  const refresh = () => {
    setLoading(true);
    setFailed(null);
    // The data layer distinguishes "no cities" from "could not read the list";
    // only the second one becomes an error state here.
    void loadCityList().then((result) => {
      if (result.ok) setCities(result.data);
      else setFailed(result.error);
      setLoading(false);
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cities;
    return cities.filter((city) =>
      [city.cityName, city.countryName, city.adminAreaName ?? "", ...Object.values(city.localizedNames)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [cities, query]);

  const backLink = (
    <Link href="/games" className="btn btn-ghost min-h-9 px-2 text-sm">
      返回
    </Link>
  );

  const searching = query.trim().length > 0;

  return (
    <Screen
      title="城市探索"
      subtitle="按城市浏览公开探索包"
      headerRight={backLink}
    >
      <div className="card p-3">
        <label className="sr-only" htmlFor="city-search">
          搜索城市
        </label>
        <div className="flex items-center gap-2">
          <input
            id="city-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索城市，例如 Manila"
            className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-[15px] outline-none focus:border-[var(--accent-deep)]"
          />
          {query ? (
            <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm" onClick={() => setQuery("")}>
              清除
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <LoadingState label="正在读取城市…" />
        ) : failed ? (
          <ErrorState
            title="城市列表暂时无法读取"
            detail={
              failed.kind === "malformed"
                ? "服务返回的数据格式不正确，请稍后重试或联系管理员。"
                : failed.kind === "network"
                  ? "网络连接失败，请检查网络后重试；游戏中心的其他功能不受影响。"
                  : "网络或服务暂时不可用，你可以稍后重试，游戏中心的其他功能不受影响。"
            }
            onRetry={refresh}
          />
        ) : filtered.length === 0 ? (
          searching ? (
            <EmptyState
              title={`没有找到「${query.trim()}」这座城市`}
              hint="换个写法试试，或者清除搜索浏览全部城市。"
              actions={
                <>
                  <button type="button" className="btn btn-secondary min-h-11 px-4 text-sm" onClick={() => setQuery("")}>
                    清除搜索
                  </button>
                  <Link href="/games" className="btn btn-ghost min-h-11 px-4 text-center text-sm">
                    返回游戏中心
                  </Link>
                </>
              }
            />
          ) : (
            <EmptyState
              title="目前还没有公开的城市探索内容"
              hint="城市会在第一个探索包发布后自动出现。"
              actions={
                <>
                  <Link href="/games" className="btn btn-secondary min-h-11 px-4 text-center text-sm">
                    返回游戏中心
                  </Link>
                  <Link href="/create" className="btn btn-ghost min-h-11 px-4 text-center text-sm">
                    去创作中心
                  </Link>
                </>
              }
            />
          )
        ) : (
          <>
            <p className="mb-2 text-[12px] text-[var(--muted)]" role="status">
              {searching
                ? `找到 ${filtered.length} 座城市（共 ${cities.length} 座）`
                : `${cities.length} 座城市有公开探索内容`}
            </p>
            <ul className="grid gap-2">
              {filtered.map((city) => (
                <li key={city.cityId}>
                  <Link
                    href={`/cities/${encodeURIComponent(city.cityId)}`}
                    className="card flex items-center justify-between gap-3 p-4 transition-colors hover:border-[var(--accent)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-bold">{city.cityName}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">
                        {city.adminAreaName ? `${city.adminAreaName} · ` : ""}
                        {city.countryName} · {city.gameCount} 个公开探索包
                      </span>
                    </span>
                    <span className="chip shrink-0">{city.countryCode}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="mt-4 text-center text-[12px] text-[var(--muted)]">
        城市列表只显示至少有一个公开探索包的城市。
      </p>
    </Screen>
  );
}
