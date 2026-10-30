"use client";

/**
 * AUTO-DEMO AUTOPILOT driver + progress bar + end screen.
 *
 * Mounted once inside the player provider stack (not per-page) so it survives
 * navigation between map / scene / challenge / reward screens.
 *
 * What it does each tick while active:
 *  1. Starts the hunt if the player has not started it yet.
 *  2. Injects a simulated fix straight into the GPS channel (its own demo
 *     channel - it never touches `settings.simulatorEnabled` or the DEV
 *     simulator panel) onto the next un-completed station.
 *  3. After a short "arrival beat" on the map, deep-links into the scene with
 *     `?auto=1` so the existing auto-open-challenge flow takes over.
 *  4. The challenge and reward screens detect demo mode themselves and
 *     auto-answer / auto-continue, so every on-screen animation stays real.
 *
 * Isolation guardrails (decision D-001/D-002/D-012):
 *  - The provider this driver talks to was mounted in demo mode; every write
 *    it triggers lands in the demo sessionStorage namespace, never in the
 *    player save. `resetHunt` here only resets the demo session.
 *  - The demo flag lives in sessionStorage, never in a cookie or save file.
 *  - Exit clears the demo session state and does a full page navigation so no
 *    demo-mode provider instance survives into normal browsing.
 *
 * The bar stays deliberately slim: progress, one status word, speed, and
 * pause / skip / exit. A completion overlay summarizes the run without ever
 * writing player-visible score data.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHunt } from "./hunt-provider";
import { useGps } from "./gps-provider";
import { simulateFix } from "@/lib/location";
import {
  demoPhaseLabel,
  demoSceneChain,
  demoSpeedFactor,
  disableDemo,
  enableDemo,
  getDemoSpeed,
  isDemoActive,
  isDemoSupported,
  nextDemoTarget,
  setDemoSpeed,
  urlRequestsDemo,
  type DemoSpeed,
} from "@/lib/demo/autopilot";
import { clearGameStateForMode } from "@/lib/storage";

/** How long the arrival beat stays on the map before opening the scene. */
const ARRIVAL_BEAT_MS = 2_800;
const TICK_MS = 1_000;

const SPEED_LABEL: Record<DemoSpeed, string> = {
  slow: "慢速",
  normal: "正常",
  fast: "快速",
};
const SPEED_ORDER: DemoSpeed[] = ["slow", "normal", "fast"];

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} 分 ${String(s).padStart(2, "0")} 秒`;
}

export function DemoAutopilot() {
  const available = isDemoSupported();
  const router = useRouter();
  const pathname = usePathname();
  const { game, state, statuses, complete, startHunt, resetHunt, runtimeMode } = useHunt();
  const { injectFix } = useGps();

  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [phaseLabel, setPhaseLabel] = useState("准备中");
  const [speed, setSpeedState] = useState<DemoSpeed>("normal");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const arrivalAtRef = useRef<Record<string, number>>({});
  const navigatingRef = useRef(false);

  // Activate from the kiosk deep link (?demo=1) or a previous in-session start.
  useEffect(() => {
    if (!available) return;
    if (urlRequestsDemo(typeof window === "undefined" ? null : window.location.search)) {
      enableDemo();
    }
    setActive(isDemoActive());
    setSpeedState(getDemoSpeed());
  }, [available]);

  // Body marker: CSS hides the DEV simulator panel while the demo is running,
  // keeping the screen to just the game plus the slim demo bar.
  useEffect(() => {
    if (!available) return;
    if (active) document.body.dataset.demoAutopilot = "1";
    else delete document.body.dataset.demoAutopilot;
    return () => {
      delete document.body.dataset.demoAutopilot;
    };
  }, [active, available]);

  // Stamp when the demo actually starts driving, for the end-screen summary.
  useEffect(() => {
    if (active && startedAt === null) setStartedAt(Date.now());
  }, [active, startedAt]);

  /**
   * Exit the demo completely: clear the demo session state, drop the flag and
   * do a FULL page navigation. The reload guarantees no demo-mode provider
   * instance (and no claimed simulator channel) survives into normal browsing.
   */
  const exitDemo = useCallback(() => {
    disableDemo();
    setActive(false);
    setFinished(false);
    setFinishedAt(null);
    if (state?.gameId) clearGameStateForMode(state.gameId, "demo");
    window.location.assign("/games");
  }, [state?.gameId]);

  const replayDemo = useCallback(() => {
    arrivalAtRef.current = {};
    setFinished(false);
    setFinishedAt(null);
    setPaused(false);
    setStartedAt(Date.now());
    // Replay from scratch: clear demo-session progress; the next tick restarts.
    resetHunt();
  }, [resetHunt]);

  const cycleSpeed = useCallback(() => {
    const next = SPEED_ORDER[(SPEED_ORDER.indexOf(speed) + 1) % SPEED_ORDER.length];
    setDemoSpeed(next);
    setSpeedState(next);
    // Re-time the current arrival beat under the new speed.
    arrivalAtRef.current = {};
  }, [speed]);

  const skipToNext = useCallback(() => {
    arrivalAtRef.current = {};
    // Fast-forward: the next tick teleports straight onto the target centre.
    setPaused(false);
  }, []);

  useEffect(() => {
    if (!active || paused || !available) return;

    const tick = () => {
      if (!game) {
        setPhaseLabel("加载游戏包…");
        return;
      }
      // 1. Make sure the hunt is started (also auto-enters the entry scene).
      if (!state?.startedAt) {
        setPhaseLabel("开始游戏");
        startHunt();
        return;
      }
      const chain = demoSceneChain(game);
      const statusById: Record<string, (typeof statuses)[number]["status"]> = {};
      for (const entry of statuses) statusById[entry.scene.id] = entry.status;
      const targetId = nextDemoTarget(chain, statusById);
      const completedCount = chain.filter((id) => statusById[id] === "completed").length;

      if (!targetId) {
        setFinished(true);
        setFinishedAt((prev) => prev ?? Date.now());
        setPhaseLabel("演示结束");
        setProgressLabel(`${chain.length} / ${chain.length}`);
        return;
      }
      setFinished(false);
      setProgressLabel(`${completedCount + 1} / ${chain.length}`);
      const target = game.scenes.find((s) => s.id === targetId);
      if (!target) return;
      const st = statusById[targetId] ?? "locked";
      setPhaseLabel(`${demoPhaseLabel(st)} · ${target.title}`);

      // 2. Teleport the demo channel onto the station until the trigger fires.
      //    The fix goes through the demo's own injection channel; player
      //    settings and the DEV panel are never involved.
      if (st === "available" || st === "locked") {
        if (pathname !== "/map") {
          if (!navigatingRef.current) {
            navigatingRef.current = true;
            router.push("/map");
          }
          return;
        }
        navigatingRef.current = false;
        const fix = simulateFix({
          enabled: true,
          coordinate: { lat: target.location.lat, lng: target.location.lng },
          jitter: false,
          jitterMetres: 0,
          accuracy: 8,
          speedMps: 1.4,
        });
        if (fix) injectFix(fix);
        return;
      }

      // 3. Arrival beat on the map, then hand over to the scene's ?auto=1 flow.
      if (st === "arrived") {
        if (!arrivalAtRef.current[targetId]) {
          arrivalAtRef.current[targetId] = Date.now();
          return;
        }
        const waited = Date.now() - arrivalAtRef.current[targetId];
        if (waited >= ARRIVAL_BEAT_MS * demoSpeedFactor(speed) && pathname !== `/scene/${targetId}`) {
          if (!navigatingRef.current) {
            navigatingRef.current = true;
            router.push(`/scene/${targetId}?auto=1`);
          }
        }
        return;
      }

      // 4. challenging / completed: the screens themselves drive the flow.
      navigatingRef.current = false;
    };

    const timer = window.setInterval(tick, TICK_MS);
    tick();
    return () => window.clearInterval(timer);
  }, [active, paused, available, game, state, statuses, pathname, router, speed, startHunt, injectFix]);

  // Completion can also be signalled by the hunt itself (all scenes completed).
  useEffect(() => {
    if (active && complete) {
      setFinished(true);
      setFinishedAt((prev) => prev ?? Date.now());
    }
  }, [active, complete]);

  if (!available || !active) return null;

  const elapsed = finished && startedAt ? (finishedAt ?? Date.now()) - startedAt : 0;
  const totalScenes = progressLabel.split(" / ")[1];
  const doneScenes = finished && totalScenes ? Number(totalScenes) : Number(progressLabel.split(" / ")[0] ?? 0);

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-[900] border-b border-white/10 bg-[var(--ink-900,#111827)]/92 text-white shadow-lg backdrop-blur">
        <div className="demo-bar-inner mx-auto flex h-11 max-w-[520px] items-center gap-2 px-3">
          <span className="shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">
            自动演示
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[12px] font-semibold">
              {finished ? "演示结束 🎉" : progressLabel ? `第 ${progressLabel} 站` : "准备中"}
            </p>
            {!finished && progressLabel ? (
              <p className="truncate text-[10px] text-white/70">{phaseLabel}</p>
            ) : null}
          </div>
          {finished ? (
            <button
              type="button"
              className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
              onClick={replayDemo}
            >
              重新演示
            </button>
          ) : (
            <>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
                onClick={cycleSpeed}
                title="演示速度"
              >
                {SPEED_LABEL[speed]}
              </button>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
                onClick={() => (paused ? setPaused(false) : setPaused(true))}
              >
                {paused ? "继续" : "暂停"}
              </button>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
                onClick={skipToNext}
              >
                下一站
              </button>
            </>
          )}
          <button
            type="button"
            className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
            onClick={exitDemo}
          >
            退出
          </button>
        </div>
      </div>

      {finished && runtimeMode === "demo" ? (
        <div className="fixed inset-0 z-[880] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="card w-full max-w-[380px] p-6 text-center shadow-2xl">
            <p className="text-3xl">🎉</p>
            <h2 className="mt-2 text-[18px] font-bold">演示完成</h2>
            <p className="mt-1 text-[13px] text-[var(--ink-600,#4b5563)]">
              {game?.title ? `《${game.title}》` : ""}自动演示已完整走完全部站点。
            </p>
            <dl className="mt-4 space-y-1.5 rounded-xl bg-[var(--paper-50,#f9fafb)] p-4 text-left text-[13px]">
              <div className="flex justify-between">
                <dt className="text-[var(--ink-500,#6b7280)]">完成站点</dt>
                <dd className="font-semibold">{doneScenes} / {totalScenes ?? "?"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ink-500,#6b7280)]">演示用时</dt>
                <dd className="font-semibold">{formatElapsed(elapsed)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ink-500,#6b7280)]">播放速度</dt>
                <dd className="font-semibold">{SPEED_LABEL[speed]}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--ink-500,#6b7280)]">
              演示不会计入真人游戏进度或成绩。
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-secondary flex-1" onClick={replayDemo}>
                重新演示
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={exitDemo}>
                返回游戏中心
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
