"use client";

/**
 * MOSRove 首页 V2.0。
 *
 * 视觉与结构重做（真实摄影 + 森林绿/米白/暖金 + 双语切换），但交互契约不变：
 * - 主按钮仍按「无进度→/select、有进度→/map、答题中→/challenge、情境中→/scene、
 *   完成→/bag」路由，文案沿用「开始探索 / 继续探索 / 查看探索成果」；
 * - 游戏中心（/games）与创作中心（/design）入口保留；
 * - 游戏恢复 / 离线 / 加载失败状态全部沿用 HuntProvider 的行为。
 *
 * 页面本体见 components/home/landing.tsx；双语字典见 lib/home-copy.ts。
 */

import "./home.css";
import { HomeLocaleProvider } from "@/components/home/home-locale";
import { HomeLanding } from "@/components/home/landing";
import { useHunt } from "@/components/hunt-provider";
import { useOnlineStatus } from "@/components/providers";

export default function HomePage() {
  const { game, state, loading, loadError, ratio, complete, contentSource, reloadContent } = useHunt();
  const online = useOnlineStatus();

  // The reducer's currentSceneId is a navigation pointer, not necessarily
  // the scene whose challenge is currently open. Prefer active progress facts.
  const challengingSceneId = game?.scenes.find(
    (scene) => state?.scenes[scene.id]?.status === "challenging",
  )?.id ?? null;
  const arrivedSceneId = game?.scenes.find(
    (scene) => state?.scenes[scene.id]?.status === "arrived",
  )?.id ?? null;
  const currentSceneId =
    challengingSceneId ?? arrivedSceneId ?? state?.currentSceneId ?? null;
  const currentSceneStatus = currentSceneId ? state?.scenes[currentSceneId]?.status : null;
  const hasProgress = Boolean(
    state &&
      (state.currentSceneId !== null ||
        state.inventory.length > 0 ||
        Object.values(state.scenes).some((scene) => scene.status === "completed" || scene.status === "challenging" || scene.status === "arrived")),
  );
  const progressPercent = Math.round(ratio * 100);
  const actionHref = complete
    ? "/bag"
    : currentSceneId && currentSceneStatus === "challenging"
      ? `/challenge/${encodeURIComponent(currentSceneId)}`
      : currentSceneId && currentSceneStatus === "arrived"
        ? `/scene/${encodeURIComponent(currentSceneId)}`
        : hasProgress
          ? "/map"
          : "/select";
  // 主按钮的语义种类；具体文案（中/英）由 components/home/landing.tsx 按当前
  // 语言渲染，保证双语切换时按钮与状态同步。
  const actionKind: "start" | "map" | "task" | "scene" | "bag" = complete
    ? "bag"
    : currentSceneStatus === "challenging"
      ? "task"
      : currentSceneStatus === "arrived"
        ? "scene"
        : hasProgress
          ? "map"
          : "start";
  // Single source of truth for progress status, shown next to the CTA.
  const statusKind: "failed" | "complete" | "progress" | "waiting" = loadError
    ? "failed"
    : complete
      ? "complete"
      : hasProgress
        ? "progress"
        : "waiting";

  return (
    <HomeLocaleProvider>
      <HomeLanding
        online={online}
        contentSource={contentSource}
        cta={{
          loading,
          loadError,
          href: actionHref,
          kind: actionKind,
          showStatus: Boolean(game) && !loading && !loadError,
          statusKind,
          progressPercent,
          showProgress: hasProgress && !complete,
          onRetry: () => reloadContent(true),
        }}
      />
    </HomeLocaleProvider>
  );
}
