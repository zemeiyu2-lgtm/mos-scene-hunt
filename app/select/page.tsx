"use client";

/**
 * Hunt Select.
 *
 * V0.1 ships a single content pack, so this screen's real job is the pre-flight
 * briefing: what the hunt is, how long it takes, and what permission it needs.
 * It is also the gate that requests GPS - deliberately after the player has read
 * why.
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useHunt } from "@/components/hunt-provider";
import { useGps } from "@/components/gps-provider";
import { findManifestEntry } from "@/lib/content";
import { readSharedGameOutcome } from "@/lib/content/share";
import { enableDemo, isDemoSupported } from "@/lib/demo/autopilot";
import { clearGameStateForMode } from "@/lib/storage";
import { disablePreview } from "@/lib/runtime/mode";
import {
  getSharedGameLibraryState,
  saveSharedGameToLibrary,
  type SharedGameLibraryState,
} from "@/lib/content/shared-save";
import { ErrorState, Screen } from "@/components/ui";
import { TabBar } from "@/components/tab-bar";
import { detectCurrentPlatform, permissionRecoveryGuide } from "@/lib/location/guidance";

export default function SelectPage() {
  const router = useRouter();
  const {
    game,
    loadError,
    reloadContent,
    state,
    statuses,
    startHunt,
    contentSource,
    isSharedFromLink,
    runtimeMode,
  } = useHunt();
  const { start, status, permission } = useGps();
  const deniedGuide = useMemo(
    () => permissionRecoveryGuide(detectCurrentPlatform()),
    [],
  );

  // 分享链接诊断：URL 带 #hunt= 载荷却没能还原出游戏时，必须告诉接收者原因。
  // 旧版这里静默回退到示范游戏，接收者会以为作者分享了别的游戏。
  const [shareBroken, setShareBroken] = useState<string | null>(null);

  // Body marker so globals.css can pad the shell below the fixed preview bar.
  useEffect(() => {
    if (runtimeMode === "preview") document.body.dataset.previewBar = "1";
    else delete document.body.dataset.previewBar;
    return () => {
      delete document.body.dataset.previewBar;
    };
  }, [runtimeMode]);

  useEffect(() => {
    let cancelled = false;
    void readSharedGameOutcome().then((outcome) => {
      if (!cancelled && outcome.status === "broken") setShareBroken(outcome.reason);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 分享游戏的入库状态。初始值一律从本机存储重推（getSharedGameLibraryState），
   * 而不是信任内存标记——刷新页面后也能正确显示「已保存」。
   * 保存本身永远不会自动发生：只有玩家点击按钮才调用 saveSharedGameToLibrary。
   */
  const [saveState, setSaveState] = useState<SharedGameLibraryState>("not-saved");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sharedGameId = isSharedFromLink ? game?.id ?? null : null;
  useEffect(() => {
    if (!game || !sharedGameId) {
      setSaveState("not-saved");
      return;
    }
    setSaveState(getSharedGameLibraryState(game));
  }, [game, sharedGameId]);

  const saveSharedGame = () => {
    if (!game || !sharedGameId || saveBusy) return;
    setSaveBusy(true);
    setSaveError(null);
    // 让「正在保存…」先渲染一帧，再执行同步写入。
    window.setTimeout(() => {
      const outcome = saveSharedGameToLibrary(game);
      if (outcome.status === "saved" || outcome.status === "already-saved") {
        setSaveState("saved");
      } else if (outcome.status === "conflict") {
        setSaveState("conflict");
      } else {
        setSaveState("not-saved");
        setSaveError(outcome.message);
      }
      setSaveBusy(false);
    }, 30);
  };

  const begin = () => {
    // Kick off GPS and the hunt together: the permission prompt appears while
    // the map is already loading, so the player is not staring at a blank screen.
    start();
    startHunt();
    router.push("/map");
  };

  const completedCount = statuses.filter((s) => s.status === "completed").length;

  // 自动演示入口：仅在支持演示的环境（开发版 / NEXT_PUBLIC_ENABLE_AUTO_DEMO=1
  // 的部署）出现，玩家正式环境完全不渲染，避免误导。演示全程使用独立的
  // demo 存档命名空间，开始即整页导航重挂载 provider——从结构上保证演示
  // 永远不会写入真人存档（决策 D-001/D-004）。
  const demoAvailable = useMemo(() => isDemoSupported(), []);
  const beginDemo = () => {
    // Fresh demo session: drop any stale demo state for this pack, then let
    // the reload re-mount the provider in demo mode.
    if (game?.id) clearGameStateForMode(game.id, "demo");
    enableDemo();
    window.location.assign("/map");
  };

  const hasProgress = Boolean(state && state.inventory.length > 0);

  if (loadError) {
    return (
      <Screen title="选择寻宝" subtitle="加载失败">
        <ErrorState
          title="无法加载游戏内容"
          detail={loadError}
          onRetry={() => reloadContent(true)}
        />
      </Screen>
    );
  }

  if (!game) {
    return (
      <Screen title="选择寻宝">
        <div className="card h-40 animate-pulse" />
      </Screen>
    );
  }

  /**
   * The manifest is presentation-only: it contributes a difficulty hint and,
   * for bundled packs, nothing else. Everything factual on this screen -
   * title, description, scene list, trigger distance - is read off the loaded
   * `game`, which is the authored pack whenever one is active.
   */
  const manifest = findManifestEntry(game.id);
  const isAuthored = contentSource === "local";
  const triggerRange = formatTriggerRange(game.scenes.map((s) => s.location.radius));

  return (
    <>
    <Screen title="选择寻宝" subtitle="确认信息后开始">
      {shareBroken ? (
        <div className="card mb-4 border border-amber-200 bg-amber-50 p-4 text-[12.5px] leading-relaxed text-amber-900">
          <p className="font-semibold">分享链接未能打开</p>
          <p className="mt-1">{shareBroken}</p>
          <p className="mt-1 text-amber-800">
            下面显示的不是朋友分享的游戏。请让朋友重新发送完整链接，或用手机相机扫描对方屏幕上的二维码。
          </p>
        </div>
      ) : null}
      <section className="card story-card overflow-hidden">
        <div className="hero-explore px-5 py-6">
          <p className="game-kicker">
            {isAuthored
              ? "本机创作"
              : isSharedFromLink
                ? "朋友分享"
                : manifest?.difficulty === "easy"
                  ? "入门"
                  : "进阶"}{" "}
            · {game.language}
          </p>
          <h2 className="mt-2 text-[24px] font-bold leading-tight">{game.title}</h2>
          <div className="game-route mt-4"><span>探索</span><i>→</i><span>选择</span><i>→</i><span>行动</span><i>→</i><span>反思</span></div>
        </div>

        <div className="p-5">
          {game.description ? (
            <p className="text-[13.5px] leading-relaxed text-[var(--muted)]">{game.description}</p>
          ) : null}

          {game.id === "bsop-eight-secrets" ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
              <p className="text-sm font-bold">户外校园寻宝 · 8 个站点</p>
              <p className="mt-1 text-xs leading-relaxed">找到地点，回答一道圣经记忆题，收集钥匙。轻松玩，不用写长答案。</p>
            </div>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: "地点", v: `${game.scenes.length} 个` },
              { k: "区域", v: formatArea(game.huntArea?.radiusMeters) },
              { k: "触发", v: triggerRange },
              { k: "预计", v: `${game.estimatedMinutes ?? 20} 分钟` },
            ].map((item) => (
              <div key={item.k} className="rounded-xl bg-[var(--surface)] px-3 py-2">
                <dt className="text-[11px] text-[var(--muted)]">{item.k}</dt>
                <dd className="tabular mt-0.5 text-[13px] font-semibold">{item.v}</dd>
              </div>
            ))}
          </dl>

          {game.huntArea ? (
            <div className="mt-4 rounded-xl bg-amber-50 px-3.5 py-3 text-[12px] leading-relaxed text-amber-900">
              <p className="font-semibold">
                探索区域 · {game.huntArea.name ?? formatArea(game.huntArea.radiusMeters)}
                {game.huntArea.shape === "polygon"
                  ? `（自定义多边形 · ${game.huntArea.points?.length ?? 0} 个顶点）`
                  : ""}
              </p>
              <p className="mt-0.5">
                整个寻宝在约 {formatArea(game.huntArea.radiusMeters)} 范围内展开；到达每个具体地点后，才会在
                约 {triggerRange} 的触发圈内解锁任务。
              </p>
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            {game.scenes.map((scene, i) => (
              <div key={scene.id} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--line)] text-[11px] font-bold text-[var(--muted)]">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium leading-snug">{scene.title}</p>
                  <p className="text-[11.5px] text-[var(--muted)]">
                    {scene.challenge ? challengeLabel(scene.challenge.type) : "无任务"}
                    {scene.reward ? ` · 奖励：${scene.reward.title}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {isSharedFromLink && game ? (
        <div className="card mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">朋友分享的游戏 · 临时试玩中</p>
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">
                可以先直接游玩；保存后才会进入本机游戏库，之后可从「创作库」随时打开。
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              disabled={saveBusy || saveState === "saved" || saveState === "conflict"}
              onClick={saveSharedGame}
            >
              {saveState === "saved"
                ? "已保存"
                : saveBusy
                  ? "正在保存…"
                  : saveState === "conflict"
                    ? "未保存"
                    : saveError
                      ? "重试保存"
                      : "保存到我的游戏"}
            </button>
          </div>
          {saveState === "saved" ? (
            <p className="mt-2 rounded-xl bg-green-50 px-3 py-2 text-[12px] leading-snug text-green-800">
              已保存到本机游戏库，可在「创作库」中随时找到并打开。
            </p>
          ) : null}
          {saveState === "conflict" ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
              本机已有一个同名但内容不同的游戏。为避免覆盖你已有的游戏和进度，这次没有保存。
            </p>
          ) : null}
          {saveError ? (
            <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700">
              保存失败：{saveError}
            </p>
          ) : null}
        </div>
      ) : null}

      {hasProgress ? (
        <div className="card mt-4 p-4">
          <p className="text-[13px]">
            你已有进行中的进度：
            <span className="font-semibold">
              {" "}
              {completedCount} / {statuses.length} 个地点已完成
            </span>
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            继续寻宝不会清空已有进度。
          </p>
        </div>
      ) : null}

      <div className="card mt-4 p-4">
        <p className="text-[13px] font-semibold">开始前只需记住</p>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <li>· 本游戏仅适合户外游玩；室内定位可能不稳定。</li>
          <li>· 允许浏览器使用位置权限，才能触发站点。</li>
          <li>· 无需注册或登录，进度保存在本机。</li>
        </ul>
        {permission === "denied" ? (
          // B-03: the old copy sent every player to the address bar, which does
          // not exist on iOS. The steps now match the platform in use.
          <div className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-red-700">
            <p className="text-[13px] font-semibold leading-snug">{deniedGuide.title}</p>
            <ol className="mt-1.5 space-y-1 pl-4 text-[13px] leading-snug" style={{ listStyle: "decimal" }}>
              {deniedGuide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {deniedGuide.note ? (
              <p className="mt-1.5 text-[12.5px] leading-snug">{deniedGuide.note}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2">
        <button type="button" className="btn btn-primary btn-block" onClick={begin}>
          {hasProgress ? "继续寻宝" : "开始寻宝"}
        </button>
        {demoAvailable ? (
          <button type="button" className="btn btn-secondary btn-block" onClick={beginDemo}>
            ▶ 自动演示（模拟定位走完全程）
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => router.back()}
        >
          返回
        </button>
      </div>

      {status === "unsupported" ? (
        <p className="mt-3 text-center text-[12px] text-red-700">
          当前浏览器不支持定位功能，游戏无法运行。
        </p>
      ) : null}
    </Screen>
      {runtimeMode === "preview" ? (
        <div className="fixed inset-x-0 top-0 z-[900] border-b border-violet-200 bg-violet-600/95 text-white shadow-lg">
          <div className="mx-auto flex h-11 max-w-[520px] items-center gap-2 px-3">
            <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">
              预览模式
            </span>
            <p className="min-w-0 flex-1 truncate text-[11px] text-white/85">
              试玩不计入真人进度，也不会改动已保存的游戏包
            </p>
            <button
              type="button"
              className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
              onClick={() => {
                disablePreview();
                if (game?.id) clearGameStateForMode(game.id, "preview");
                window.location.assign("/design");
              }}
            >
              结束预览
            </button>
          </div>
        </div>
      ) : null}
      <TabBar />
    </>
  );
}

function formatArea(radiusMeters?: number): string {
  if (!Number.isFinite(radiusMeters)) return "未设定";
  const km = (radiusMeters as number) / 1000;
  return km >= 1 ? `约 ${km.toFixed(km < 10 ? 1 : 0)} km` : `约 ${Math.round(radiusMeters as number)} m`;
}

/**
 * The actual trigger radii in this pack, e.g. "15–30 m" or "15 m".
 *
 * Read from the scenes rather than hard-coded: an authored pack sets its own
 * radii, and a briefing that claims "30–50 m" for a pack whose rings are 15 m
 * sends the player looking in the wrong place.
 */
function formatTriggerRange(radii: Array<number | undefined>): string {
  const values = radii
    .map((r) => (typeof r === "number" && Number.isFinite(r) ? Math.round(r) : null))
    .filter((r): r is number => r !== null);
  if (values.length === 0) return "未设定";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `${min} m` : `${min}–${max} m`;
}

function challengeLabel(type: string): string {
  switch (type) {
    case "choice":
      return "选择题";
    case "keyword":
      return "关键词题";
    case "text":
      return "简答题";
    default:
      return "任务";
  }
}
