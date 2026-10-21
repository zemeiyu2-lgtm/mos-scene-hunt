"use client";

/**
 * Dev-only sound preview page (/dev/sounds).
 *
 * Not linked from any player-facing navigation - it exists so the six cues can
 * be auditioned on a real phone during acceptance. Remove or keep unlinked.
 */

import { playSound, SoundToggle, type SoundCue } from "@/components/sound";

const CUES: Array<{ cue: SoundCue; label: string; desc: string }> = [
  { cue: "tap", label: "tap", desc: "轻点反馈（最小的闷钟，最克制）" },
  { cue: "arrive", label: "arrive", desc: "抵达反馈（温暖两钟，稳定落地）" },
  { cue: "unlock", label: "unlock", desc: "场景解锁（低音开门 + 钟声揭示）" },
  { cue: "success", label: "success", desc: "答题成功（两钟肯定，不抢戏）" },
  { cue: "reward", label: "reward", desc: "领取奖励（深钟 + 上行钟旋律，标杆）" },
  { cue: "finish", label: "finish", desc: "全程完成（慢钟归途 + 低音收束）" },
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
