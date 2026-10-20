"use client";

/**
 * Dev-only sound preview page (/dev/sounds).
 *
 * Not linked from any player-facing navigation - it exists so the six cues can
 * be auditioned on a real phone during acceptance. Remove or keep unlinked.
 */

import { playSound, SoundToggle, type SoundCue } from "@/components/sound";

const CUES: Array<{ cue: SoundCue; label: string; desc: string }> = [
  { cue: "tap", label: "tap", desc: "轻点反馈（最克制）" },
  { cue: "arrive", label: "arrive", desc: "抵达反馈（温暖两音）" },
  { cue: "unlock", label: "unlock", desc: "场景解锁 / 发现感" },
  { cue: "success", label: "success", desc: "答题成功（积极、不抢戏）" },
  { cue: "reward", label: "reward", desc: "领取奖励（标杆音效）" },
  { cue: "finish", label: "finish", desc: "全程完成（完整收尾）" },
];

export default function DevSoundsPage() {
  return (
    <main className="page py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-bold">音效试听</h1>
        <SoundToggle />
      </div>
      <p className="mt-1 text-[12.5px] text-[var(--muted)]">
        开发调试页面，未接入玩家导航。逐个播放可对比六种音效的层次与响度。
      </p>
      <div className="mt-4 grid gap-2">
        {CUES.map(({ cue, label, desc }) => (
          <button
            key={cue}
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => playSound(cue)}
          >
            {label} · {desc}
          </button>
        ))}
      </div>
    </main>
  );
}
