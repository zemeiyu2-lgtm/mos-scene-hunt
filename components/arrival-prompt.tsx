"use client";

/**
 * Arrival prompt - the map's "you have reached the target" beat.
 *
 * Reaching the trigger ring is a discovery moment, so it gets its own
 * announcement instead of silently navigating the player away from the map.
 * The card only *reports* the arrival and offers the two deliberate actions;
 * it holds no game rules. The state machine still owns arrival (FIX_UPDATE)
 * and challenge opening (OPEN_CHALLENGE) - this component never dispatches.
 *
 * Interaction contract:
 *  - 「查看任务」 is the only path into the scene. The parent navigates.
 *  - Closing keeps the player on the map; the arrived status is untouched, so
 *    the task card's own 「解锁情境」 entry is still there afterwards.
 *  - Sound is entirely optional: a blocked AudioContext only hides the
 *    "enable sound" hint, it never blocks either action.
 */

import { useEffect, useRef } from "react";
import { playSound } from "@/components/sound";

export interface ArrivalPromptProps {
  /** Title of the scene the player just reached. */
  sceneTitle: string;
  /** Optional place label shown under the title. */
  placeName?: string | null;
  /** Distance in metres to the target, for a "you are standing in it" hint. */
  distanceMetres?: number | null;
  /** Enter the scene / challenge. Only called on an explicit tap. */
  onViewTask: () => void;
  /** Dismiss the card and keep exploring the map. */
  onDismiss: () => void;
}

export function ArrivalPrompt({
  sceneTitle,
  placeName,
  distanceMetres,
  onViewTask,
  onDismiss,
}: ArrivalPromptProps) {
  const navigatedRef = useRef(false);

  // Arrival cue: soft two-bell `arrive` from the shared sound module, which
  // already applies the mute toggle, its own per-cue cooldown and the gesture
  // unlock. Keyed on the scene so a re-render never re-rings; callers also
  // guard the mount with the same per-arrival event key.
  useEffect(() => {
    playSound("arrive");
  }, [sceneTitle]);

  const viewTask = () => {
    // A double tap on a slow phone must not push the same route twice.
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    onViewTask();
  };

  return (
    // Centred rather than pinned to the bottom: the bottom of the map screen
    // already carries the task card and the tab bar, and the top carries the
    // HUD. Sitting in the middle keeps both reachable, and `max-h` + scroll
    // keeps the card inside the viewport on short/narrow phones.
    <div className="pointer-events-none absolute inset-0 z-[560] grid place-items-center px-4">
      <div className="w-full max-w-[420px]">
        <section
          className="card pointer-events-auto max-h-[70dvh] w-full overflow-y-auto p-4"
          style={{ boxShadow: "0 16px 40px -12px rgba(15, 23, 42, 0.38)" }}
          role="dialog"
          aria-modal="false"
          aria-labelledby="arrival-prompt-title"
          aria-describedby="arrival-prompt-desc"
          data-testid="arrival-prompt"
        >
          <div className="flex items-start gap-3">
            <div
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-[18px]"
              aria-hidden="true"
            >
              📍
            </div>
            <div className="min-w-0 flex-1">
              <p
                id="arrival-prompt-title"
                className="text-[16px] font-bold leading-tight text-[var(--text)]"
              >
                目标已发现！
              </p>
              <p className="mt-1 truncate text-[14px] font-semibold text-emerald-700">
                {sceneTitle}
              </p>
              <p
                id="arrival-prompt-desc"
                className="mt-1 text-[12px] leading-snug text-[var(--muted)]"
              >
                {placeName ? `${placeName} · ` : ""}
                {distanceMetres !== null && distanceMetres !== undefined
                  ? `你已进入触发范围（距中心 ${Math.max(0, Math.round(distanceMetres))} m）。`
                  : "你已进入任务触发范围。"}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[16px] text-[var(--muted)]"
              aria-label="关闭提醒，继续查看地图"
              title="继续查看地图"
              data-testid="arrival-prompt-dismiss"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={viewTask}
              className="btn btn-primary btn-block"
              data-testid="arrival-prompt-view-task"
            >
              查看任务 →
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="btn btn-ghost btn-block"
              data-testid="arrival-prompt-continue"
            >
              继续查看地图
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
