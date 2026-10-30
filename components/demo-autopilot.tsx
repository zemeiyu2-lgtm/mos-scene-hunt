"use client";

/**
 * AUTO-DEMO AUTOPILOT driver + progress bar.
 *
 * Mounted once inside the player provider stack (not per-page) so it survives
 * navigation between map / scene / challenge / reward screens.
 *
 * What it does each tick while active:
 *  1. Starts the hunt if the player has not started it yet.
 *  2. Teleports the DEV GPS simulator onto the next un-completed station.
 *  3. After a short "arrival beat" on the map, deep-links into the scene with
 *     `?auto=1` so the existing auto-open-challenge flow takes over.
 *  4. The challenge and reward screens detect demo mode themselves and
 *     auto-answer / auto-continue, so every on-screen animation stays real.
 *
 * The bar itself is deliberately minimal: progress, one status word, and three
 * controls (pause / skip / exit) - nothing else, per the "界面简单明了" spec.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSettings } from "./providers";
import { useHunt } from "./hunt-provider";
import { isSimulatorAvailable } from "@/lib/location";
import {
  demoPhaseLabel,
  demoSceneChain,
  disableDemo,
  enableDemo,
  isDemoActive,
  nextDemoTarget,
  urlRequestsDemo,
} from "@/lib/demo/autopilot";

/** How long the arrival beat stays on the map before opening the scene. */
const ARRIVAL_BEAT_MS = 2_800;
const TICK_MS = 1_000;

export function DemoAutopilot() {
  const available = isSimulatorAvailable();
  const router = useRouter();
  const pathname = usePathname();
  const { settings, update } = useSettings();
  const { game, state, statuses, complete, startHunt, resetHunt } = useHunt();

  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [phaseLabel, setPhaseLabel] = useState("准备中");

  const arrivalAtRef = useRef<Record<string, number>>({});
  const navigatingRef = useRef(false);

  // Activate from the kiosk deep link (?demo=1) or a previous in-session start.
  useEffect(() => {
    if (!available) return;
    if (urlRequestsDemo(typeof window === "undefined" ? null : window.location.search)) {
      enableDemo();
    }
    setActive(isDemoActive());
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

  const exitDemo = useCallback(() => {
    disableDemo();
    setActive(false);
    setFinished(false);
    update({ simulatorEnabled: false });
    router.push("/games");
  }, [router, update]);

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

      // 2. Teleport onto the station until the trigger fires.
      if (st === "available" || st === "locked") {
        if (pathname !== "/map") {
          if (!navigatingRef.current) {
            navigatingRef.current = true;
            router.push("/map");
          }
          return;
        }
        navigatingRef.current = false;
        const coord = settings.simulatorCoordinate;
        if (!settings.simulatorEnabled || !coord || Math.abs(coord.lat - target.location.lat) > 1e-6 || Math.abs(coord.lng - target.location.lng) > 1e-6) {
          update({ simulatorEnabled: true, simulatorCoordinate: { lat: target.location.lat, lng: target.location.lng } });
        }
        return;
      }

      // 3. Arrival beat on the map, then hand over to the scene's ?auto=1 flow.
      if (st === "arrived") {
        if (!arrivalAtRef.current[targetId]) {
          arrivalAtRef.current[targetId] = Date.now();
          return;
        }
        const waited = Date.now() - arrivalAtRef.current[targetId];
        if (waited >= ARRIVAL_BEAT_MS && pathname !== `/scene/${targetId}`) {
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
  }, [active, paused, available, game, state, statuses, pathname, router, settings.simulatorCoordinate, settings.simulatorEnabled, startHunt, update]);

  // Completion can also be signalled by the hunt itself (all scenes completed).
  useEffect(() => {
    if (active && complete) setFinished(true);
  }, [active, complete]);

  if (!available || !active) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[900] border-b border-white/10 bg-[var(--ink-900,#111827)]/92 text-white shadow-lg backdrop-blur">
      <div className="mx-auto flex h-11 max-w-[520px] items-center gap-2 px-3">
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
            onClick={() => {
              arrivalAtRef.current = {};
              setFinished(false);
              setPaused(false);
              // Replay from scratch: clear progress; the next tick restarts.
              resetHunt();
            }}
          >
            重新演示
          </button>
        ) : (
          <button
            type="button"
            className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
            onClick={() => (paused ? setPaused(false) : setPaused(true))}
          >
            {paused ? "继续" : "暂停"}
          </button>
        )}
        {!finished ? (
          <button
            type="button"
            className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
            onClick={skipToNext}
          >
            下一站
          </button>
        ) : null}
        <button
          type="button"
          className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium hover:bg-white/25"
          onClick={exitDemo}
        >
          退出
        </button>
      </div>
    </div>
  );
}
