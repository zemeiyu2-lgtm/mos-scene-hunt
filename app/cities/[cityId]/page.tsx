"use client";

/**
 * 城市内容 — one city and its publicly readable packs.
 *
 * Level 3 of the discovery path. ONE request returns both the city and the
 * packs (`/api/cities/<id>`), because the server already knows which packs a
 * stranger may open — a second round trip would only re-filter the same data.
 *
 * 404 is a real answer here, not an error: a city with no published pack has no
 * public page (R2). The UI turns it into an empty state with a way out instead
 * of a scary red box.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, Screen } from "@/components/ui";
import { loadCityDetail, type CityDetail, type CityError } from "@/lib/cities/client";
import { importGamePackageChecked, markCurrentAuthoredGame } from "@/lib/content";
import { packUrl, type CloudGameEntry } from "@/lib/cloud";

export default function CityDetailPage() {
  const params = useParams<{ cityId: string }>();
  const router = useRouter();
  const cityId = typeof params?.cityId === "string" ? params.cityId : "";

  const [detail, setDetail] = useState<CityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<CityError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(() => {
    if (!cityId) {
      setLoading(false);
      setFailed({ kind: "not_found", status: 404, code: "city_not_found", message: "城市不存在。" });
      return;
    }
    setLoading(true);
    setFailed(null);
    // ONE request: the server returns the city plus the packs a stranger may
    // open, already filtered. A 404 tells us which kind of "nothing" it is.
    void loadCityDetail(cityId).then((result) => {
      if (result.ok) setDetail(result.data);
      else setFailed(result.error);
      setLoading(false);
    });
  }, [cityId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Download (or reuse) the pack, then hand over to the existing play flow.
   *
   * The registry-backed read endpoint is used directly: the id came from the
   * city API, and `packUrl` re-validates it before building the path. No
   * catalogue download is needed just to open one pack.
   */
  const startExplore = async (packageGameId: string, title: string) => {
    if (busyId) return;
    setBusyId(packageGameId);
    setMessage("");
    try {
      const entry: CloudGameEntry = {
        id: packageGameId,
        title,
        author: "",
        description: "",
        language: "zh-Hans",
        sceneCount: 0,
        status: "published",
        packFile: "",
        source: "registry",
      };
      const response = await fetch(packUrl(entry), { cache: "no-cache" });
      if (!response.ok) throw new Error(`游戏包下载失败（HTTP ${response.status}）`);
      const outcome = importGamePackageChecked(await response.text());
      if (outcome.status === "error") {
        setMessage(outcome.message);
        return;
      }
      if (outcome.status === "conflict") {
        setMessage("本机已有同名但内容不同的游戏。为避免覆盖你的进度，未自动替换；请在创作中心处理后再试。");
        return;
      }
      const game = outcome.game;
      markCurrentAuthoredGame(game.id);
      router.push(`/select?game=${encodeURIComponent(game.id)}&from=${encodeURIComponent(`/cities/${cityId}`)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "游戏包下载失败，请重试。");
    } finally {
      setBusyId(null);
    }
  };

  const backLink = (
    <Link href="/cities" className="btn btn-ghost min-h-9 px-2 text-sm">
      返回
    </Link>
  );

  if (loading) {
    return (
      <Screen title="城市内容" headerRight={backLink}>
        <LoadingState label="正在读取城市内容…" />
      </Screen>
    );
  }

  if (failed) {
    /*
     * Three different nothings, three different answers:
     *  - city_not_public : the profile exists but has no published pack (R2);
     *  - city_not_found  : no such city (a stale link);
     *  - anything else   : a real failure, retryable.
     */
    const noPublicContent = failed.code === "city_not_public";
    const missing = failed.code === "city_not_found";
    const recoveryActions = (
      <>
        <Link href="/cities" className="btn btn-secondary min-h-11 px-4 text-center text-sm">
          浏览其他城市
        </Link>
        <Link href="/games" className="btn btn-ghost min-h-11 px-4 text-center text-sm">
          返回游戏中心
        </Link>
      </>
    );
    return (
      <Screen title="城市内容" headerRight={backLink}>
        {noPublicContent || missing ? (
          <EmptyState
            title={missing ? "没有找到这座城市" : "这座城市还没有公开的探索包"}
            hint={
              missing
                ? "链接可能已失效，或者城市名称已变更。"
                : "城市只有在至少一个探索包发布后才会出现在公开目录里。"
            }
            actions={recoveryActions}
          />
        ) : (
          <ErrorState
            title="暂时无法读取这座城市"
            detail={
              failed.kind === "network"
                ? "网络连接失败，请检查网络后重试。"
                : failed.kind === "malformed"
                  ? "服务返回的数据格式不正确，请稍后重试。"
                  : failed.message
            }
            onRetry={refresh}
          />
        )}
      </Screen>
    );
  }

  if (!detail) return null;

  const { city, packages } = detail;

  return (
    <Screen
      title={city.cityName}
      subtitle={[city.adminAreaName, city.countryName, `${packages.length} 个公开探索包`]
        .filter(Boolean)
        .join(" · ")}
      headerRight={backLink}
    >
      {message ? (
        <div role="status" className="card mb-3 p-3 text-sm leading-relaxed">
          {message}
        </div>
      ) : null}

      {packages.length === 0 ? (
        // Defensive only: the server answers 404 `city_not_public` when a city
        // holds no public pack, so this branch should be unreachable. Showing a
        // way out is still cheaper than showing nothing.
        <EmptyState
          title="这座城市还没有公开的探索包"
          hint="城市只有在至少一个探索包发布后才会出现在公开目录里。"
          actions={
            <Link href="/cities" className="btn btn-secondary min-h-11 px-4 text-center text-sm">
              浏览其他城市
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {packages.map((pack) => (
            <li key={pack.gameId}>
              <article className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-bold">{pack.title}</h2>
                    <p className="mt-1 text-[12px] text-[var(--muted)]">
                      {pack.sceneCount} 个地点
                      {pack.updatedAt ? ` · 更新于 ${pack.updatedAt.slice(0, 10)}` : ""}
                    </p>
                  </div>
                  <span className="chip shrink-0">{city.countryCode}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary mt-3 w-full"
                  onClick={() => void startExplore(pack.gameId, pack.title)}
                  disabled={busyId !== null}
                >
                  {busyId === pack.gameId ? "正在准备…" : "开始探索"}
                </button>
              </article>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-center text-[12px] text-[var(--muted)]">
        探索包第一次打开时会下载到本机，之后可以直接从游戏中心进入。
      </p>
    </Screen>
  );
}
