"use client";

import { useEffect, useState } from "react";

export type SoundCue = "tap" | "arrive" | "unlock" | "success" | "reward" | "finish";
const KEY = "mos-scene-hunt:sound-enabled";
let ctx: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined") return null;
  ctx ??= new AudioContext();
  return ctx;
}

export function playSound(cue: SoundCue) {
  if (typeof window === "undefined" || window.localStorage.getItem(KEY) === "off") return;
  const audio = getContext();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume();
  const patterns: Record<SoundCue, Array<[number, number, number]>> = {
    tap: [[0, 520, 0.035]],
    arrive: [[0, 420, 0.07], [0.09, 620, 0.08]],
    unlock: [[0, 440, 0.07], [0.1, 660, 0.08], [0.2, 880, 0.1]],
    success: [[0, 660, 0.07], [0.09, 880, 0.1]],
    reward: [[0, 523, 0.08], [0.1, 659, 0.08], [0.2, 784, 0.12], [0.34, 1047, 0.16]],
    finish: [[0, 392, 0.08], [0.11, 523, 0.08], [0.22, 659, 0.1], [0.36, 784, 0.18]],
  };
  const now = audio.currentTime;
  for (const [offset, frequency, duration] of patterns[cue]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = cue === "tap" ? "sine" : "triangle";
    osc.frequency.setValueAtTime(frequency, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.055, now + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + offset);
    osc.stop(now + offset + duration + 0.02);
  }
}

export function SoundToggle() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => setEnabled(window.localStorage.getItem(KEY) !== "off"), []);
  return (
    <button type="button" className="sound-toggle" aria-label={enabled ? "关闭声音" : "开启声音"} title={enabled ? "声音开启" : "声音关闭"}
      onClick={() => { const next = !enabled; setEnabled(next); window.localStorage.setItem(KEY, next ? "on" : "off"); if (next) playSound("tap"); }}>
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
