"use client";

import { useEffect, useState } from "react";

export type SoundCue = "tap" | "arrive" | "unlock" | "success" | "reward" | "finish";
export type MusicKind = "intro" | "explore";

const KEY = "mos-scene-hunt:sound-enabled";
let ctx: AudioContext | null = null;
let activeMusicStop: (() => void) | null = null;

function getContext() {
  if (typeof window === "undefined") return null;
  ctx ??= new AudioContext();
  return ctx;
}

function resume(audio: AudioContext) {
  if (audio.state === "suspended") void audio.resume();
}

export function playSound(cue: SoundCue) {
  if (typeof window === "undefined" || window.localStorage.getItem(KEY) === "off") return;
  const audio = getContext();
  if (!audio) return;
  resume(audio);

  const patterns: Record<SoundCue, Array<[number, number, number]>> = {
    tap: [[0, 520, 0.035]],
    arrive: [[0, 392, 0.08], [0.1, 587.33, 0.12]],
    unlock: [[0, 440, 0.08], [0.1, 659.25, 0.1], [0.2, 880, 0.14]],
    success: [[0, 523.25, 0.08], [0.1, 659.25, 0.1], [0.22, 783.99, 0.16]],
    reward: [[0, 523.25, 0.07], [0.1, 659.25, 0.08], [0.2, 783.99, 0.11], [0.34, 1046.5, 0.17]],
    finish: [[0, 392, 0.09], [0.11, 523.25, 0.09], [0.23, 659.25, 0.11], [0.37, 783.99, 0.22], [0.61, 1046.5, 0.28]],
  };

  const now = audio.currentTime;
  for (const [offset, frequency, duration] of patterns[cue]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = cue === "tap" ? "sine" : "triangle";
    osc.frequency.setValueAtTime(frequency, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(cue === "finish" ? 0.045 : 0.055, now + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + offset);
    osc.stop(now + offset + duration + 0.02);
  }
}

export function speak(text: string): void {
  if (typeof window === "undefined" || window.localStorage.getItem(KEY) === "off" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = 0.92;
  u.volume = 0.82;
  window.speechSynthesis.speak(u);
}

const MUSIC_URLS: Record<MusicKind, string> = {
  // CC0 soundtrack sources hosted by Wikimedia Commons.
  intro: "https://commons.wikimedia.org/wiki/Special:Redirect/file/John_Bartmann_-_ethereal-moments-master.webm",
  explore: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Komiku_-_05_-_Down_the_river.ogg",
};

let activeAudio: HTMLAudioElement | null = null;

export function playMusic(kind: MusicKind = "intro"): () => void {
  if (typeof window === "undefined" || window.localStorage.getItem(KEY) === "off") return () => {};

  activeMusicStop?.();

  const audio = new Audio(MUSIC_URLS[kind]);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;
  activeAudio = audio;

  const fadeIn = window.setInterval(() => {
    if (audio.paused) return;
    audio.volume = Math.min(0.18, audio.volume + 0.015);
    if (audio.volume >= 0.18) window.clearInterval(fadeIn);
  }, 120);

  const stop = () => {
    window.clearInterval(fadeIn);
    const fadeOut = window.setInterval(() => {
      audio.volume = Math.max(0, audio.volume - 0.025);
      if (audio.volume <= 0.001) {
        window.clearInterval(fadeOut);
        audio.pause();
        audio.src = "";
        if (activeAudio === audio) activeAudio = null;
      }
    }, 80);
    if (activeMusicStop === stop) activeMusicStop = null;
  };

  activeMusicStop = stop;

  void audio.play().catch(() => {
    // Browsers may block autoplay until the user interacts.
    // The game remains fully playable without music.
  });

  return stop;
}

export function stopMusic() {
  activeMusicStop?.();
  activeMusicStop = null;
}

export function SoundToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(window.localStorage.getItem(KEY) !== "off");
    return undefined;
  }, []);

  return (
    <button
      type="button"
      className="sound-toggle"
      aria-label={enabled ? "关闭声音" : "开启声音"}
      title={enabled ? "声音开启" : "声音关闭"}
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        window.localStorage.setItem(KEY, next ? "on" : "off");
        if (next) playSound("tap");
        else stopMusic();
      }}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
