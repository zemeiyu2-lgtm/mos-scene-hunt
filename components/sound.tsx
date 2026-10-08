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

function createLayer(audio: AudioContext, master: GainNode, frequency: number, volume: number, type: OscillatorType) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();
  osc.type = type;
  osc.frequency.value = frequency;
  filter.type = "lowpass";
  filter.frequency.value = type === "sine" ? 900 : 1600;
  gain.gain.value = volume;
  osc.connect(filter).connect(gain).connect(master);
  osc.start();
  return { osc, gain, filter };
}

/**
 * Lightweight original ambient score.
 * It is generated in-browser: no audio files, no third-party music and no package bloat.
 * A slow chord bed + moving fifth/arpeggio creates an actual musical pulse without
 * competing with GPS, voice guidance or the real-world environment.
 */
export function playMusic(kind: MusicKind = "intro"): () => void {
  if (typeof window === "undefined" || window.localStorage.getItem(KEY) === "off") return () => {};
  const audio = getContext();
  if (!audio) return () => {};
  resume(audio);

  activeMusicStop?.();

  const master = audio.createGain();
  const filter = audio.createBiquadFilter();
  master.gain.setValueAtTime(0.0001, audio.currentTime);
  master.gain.exponentialRampToValueAtTime(kind === "intro" ? 0.026 : 0.021, audio.currentTime + 1.8);
  filter.type = "lowpass";
  filter.frequency.value = kind === "intro" ? 1250 : 1450;
  master.connect(filter).connect(audio.destination);

  const chords = kind === "intro"
    ? [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]]
    : [[196, 246.94, 293.66], [220, 277.18, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];

  const layers = [
    createLayer(audio, master, chords[0][0], 0.42, "sine"),
    createLayer(audio, master, chords[0][1], 0.11, "triangle"),
    createLayer(audio, master, chords[0][2], 0.08, "triangle"),
  ];

  const pulse = audio.createOscillator();
  const pulseGain = audio.createGain();
  pulse.type = "sine";
  pulse.frequency.value = kind === "intro" ? 110 : 98;
  pulseGain.gain.value = 0.018;
  pulse.connect(pulseGain).connect(master);
  pulse.start();

  const arpeggio = audio.createOscillator();
  const arpGain = audio.createGain();
  arpeggio.type = "triangle";
  arpeggio.frequency.value = chords[0][1] * 2;
  arpGain.gain.value = kind === "intro" ? 0.018 : 0.014;
  arpeggio.connect(arpGain).connect(master);
  arpeggio.start();

  let step = 0;
  const timer = window.setInterval(() => {
    if (step >= 16) step = 0;
    const chord = chords[Math.floor(step / 4)];
    const note = chord[step % 3] * (step % 2 === 0 ? 1 : 2);
    const now = audio.currentTime;
    layers.forEach((layer, index) => {
      layer.osc.frequency.cancelScheduledValues(now);
      layer.osc.frequency.setValueAtTime(layer.osc.frequency.value, now);
      layer.osc.frequency.linearRampToValueAtTime(chord[index], now + 1.6);
    });
    arpeggio.frequency.cancelScheduledValues(now);
    arpeggio.frequency.setValueAtTime(arpeggio.frequency.value, now);
    arpeggio.frequency.exponentialRampToValueAtTime(note, now + 0.35);
    step += 1;
  }, 1200);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    const now = audio.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    window.setTimeout(() => {
      layers.forEach(({ osc }) => { try { osc.stop(); } catch {} });
      try { pulse.stop(); } catch {}
      try { arpeggio.stop(); } catch {}
      master.disconnect();
    }, 950);
    if (activeMusicStop === stop) activeMusicStop = null;
  };
  activeMusicStop = stop;
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
