"use client";

/**
 * Game sounds, synthesised with the Web Audio API (no audio files).
 *
 * Design goals for the V1 immersive pass:
 * - `reward` is the signature cue: a rising arpeggio that turns back on itself
 *   and resolves into a shimmering held note over a warm chord.
 * - Each cue differs by contour, texture and layering - not just pitch.
 * - Loudness comes from layering (sub body + fundamental + harmonic top) and a
 *   master limiter, never from a single loud oscillator, so nothing clips or
 *   buzzes on small phone speakers.
 * - Rapid re-triggers are throttled per cue and capped globally, so bursts of
 *   events cannot stack into a distorted wall of sound.
 * - Autoplay policies are respected: nothing is scheduled until the context
 *   actually runs, and init failures degrade to silence without crashing.
 */

import { useEffect, useState } from "react";

export type SoundCue = "tap" | "arrive" | "unlock" | "success" | "reward" | "finish";

const KEY = "mos-scene-hunt:sound-enabled";

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEY) !== "off";
}

/* ------------------------------------------------------------------ */
/* Audio context + master bus                                          */
/* ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let gestureBound = false;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const w = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    const audio = new Ctor();
    // Master chain: bus -> soft limiter -> destination. The limiter is what
    // lets every voice sit well above the old ~0.05 peak without clipping
    // when several voices overlap.
    const out = audio.createGain();
    out.gain.value = 0.9;
    if (typeof audio.createDynamicsCompressor === "function") {
      const limiter = audio.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 20;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.22;
      out.connect(limiter);
      limiter.connect(audio.destination);
    } else {
      out.connect(audio.destination);
    }
    ctx = audio;
    bus = out;
  } catch {
    // No audio hardware / blocked construction: the game stays playable in
    // silence instead of crashing.
    ctx = null;
    bus = null;
  }
  return ctx;
}

/** Browsers keep the context suspended until a user gesture; re-resume then. */
function bindGestureUnlock(audio: AudioContext) {
  if (gestureBound || typeof window === "undefined") return;
  gestureBound = true;
  const unlock = () => {
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

/* ------------------------------------------------------------------ */
/* Playback management                                                 */
/* ------------------------------------------------------------------ */

/** Minimum interval between two plays of the same cue (ms). */
const COOLDOWN_MS: Record<SoundCue, number> = {
  tap: 70,
  arrive: 180,
  unlock: 200,
  success: 220,
  reward: 500,
  finish: 500,
};

/** Hard cap on scheduled-but-unfinished voices; extra plays are dropped. */
const MAX_ACTIVE_VOICES = 28;

const lastPlayedAt = new Map<SoundCue, number>();
let activeVoices = 0;

/* ------------------------------------------------------------------ */
/* Synthesis primitives                                                */
/* ------------------------------------------------------------------ */

type ToneSpec = {
  /** Offset from "now" in seconds. */
  at: number;
  freq: number;
  dur: number;
  type?: OscillatorType;
  /** Peak gain of the main voice. */
  peak?: number;
  /** Rise time in seconds; kept short so onsets never click. */
  attack?: number;
  /** Vibrato depth in Hz (for the shimmering held reward note). */
  vibrato?: number;
  /** Relative gain of a sine one octave below (body/warmth). */
  sub?: number;
  /** Relative gain of a sine one octave above (brightness). */
  harmonic?: number;
};

function voice(
  audio: AudioContext,
  start: number,
  freq: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  attack: number,
): OscillatorNode {
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  env.connect(bus as GainNode);

  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.connect(env);
  osc.start(start);
  osc.stop(start + dur + 0.03);
  activeVoices++;
  osc.onended = () => {
    activeVoices--;
  };
  return osc;
}

function tone(audio: AudioContext, spec: ToneSpec) {
  const {
    at,
    freq,
    dur,
    type = "triangle",
    peak = 0.2,
    attack = 0.012,
    vibrato = 0,
    sub = 0,
    harmonic = 0,
  } = spec;
  const start = audio.currentTime + at;
  const osc = voice(audio, start, freq, dur, type, peak, attack);
  if (vibrato > 0) {
    const lfo = audio.createOscillator();
    lfo.frequency.setValueAtTime(5.5, start);
    const depth = audio.createGain();
    depth.gain.setValueAtTime(vibrato, start);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + dur + 0.05);
    activeVoices++;
    lfo.onended = () => {
      activeVoices--;
    };
  }
  if (sub > 0) voice(audio, start, freq / 2, dur, "sine", peak * sub, attack + 0.01);
  if (harmonic > 0) voice(audio, start, freq * 2, dur * 0.7, "sine", peak * harmonic, attack);
}

/** Short filtered noise burst - the "glint" on discovery / reward moments. */
function sparkle(audio: AudioContext, at: number, dur: number, peak: number) {
  const start = audio.currentTime + at;
  const frames = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 6200;
  band.Q.value = 1.6;
  const env = audio.createGain();
  env.gain.setValueAtTime(peak, start);
  src.connect(band);
  band.connect(env);
  env.connect(bus as GainNode);
  src.start(start);
  activeVoices++;
  src.onended = () => {
    activeVoices--;
  };
}

/* ------------------------------------------------------------------ */
/* Cue designs                                                         */
/* ------------------------------------------------------------------ */

/**
 * Loudness hierarchy (peak gains before the limiter):
 *   reward 0.24 > finish 0.20 > success 0.20 > unlock 0.18 > arrive 0.15 > tap 0.07
 * All cues share the warm triangle/sine palette; they differ in contour,
 * rhythm, texture (noise glint, vibrato, sub body) and length.
 */
function scheduleCue(audio: AudioContext, cue: SoundCue) {
  if (!bus || activeVoices >= MAX_ACTIVE_VOICES) return;
  switch (cue) {
    // Soft, 50 ms tick. Quiet by design - it sits under frequent taps.
    case "tap":
      tone(audio, { at: 0, freq: 520, dur: 0.05, type: "sine", peak: 0.07, attack: 0.006 });
      break;

    // Warm two-note arrival: low root with body, then a fifth above.
    case "arrive":
      tone(audio, { at: 0, freq: 293.66, dur: 0.16, peak: 0.13, attack: 0.02, sub: 0.4 });
      tone(audio, { at: 0.14, freq: 440, dur: 0.2, peak: 0.15, attack: 0.015, harmonic: 0.25 });
      break;

    // Discovery: rising three-note reveal over a low "door opening" drone,
    // finished with a noise glint. Expectation -> reveal.
    case "unlock":
      tone(audio, { at: 0, freq: 110, dur: 0.32, type: "sine", peak: 0.12, attack: 0.02 });
      tone(audio, { at: 0, freq: 440, dur: 0.1, peak: 0.16 });
      tone(audio, { at: 0.09, freq: 587.33, dur: 0.1, peak: 0.17 });
      tone(audio, { at: 0.18, freq: 880, dur: 0.22, peak: 0.18, harmonic: 0.25 });
      sparkle(audio, 0.2, 0.25, 0.07);
      break;

    // Compact, bright confirmation. Two notes plus a soft tail - clearly
    // positive, but structurally simpler than reward so it never upstages it.
    case "success":
      tone(audio, { at: 0, freq: 659.26, dur: 0.12, peak: 0.18 });
      tone(audio, { at: 0.11, freq: 880, dur: 0.28, peak: 0.2, harmonic: 0.28, sub: 0.4 });
      break;

    // Signature cue (~1.4 s). A quick D-major rise, a turn back, then a held
    // shimmering top note over a warm resolving chord: treasure found, reward
    // in hand.
    case "reward":
      tone(audio, { at: 0, freq: 587.33, dur: 0.12, peak: 0.2 });
      tone(audio, { at: 0.12, freq: 739.99, dur: 0.12, peak: 0.21 });
      tone(audio, { at: 0.24, freq: 880, dur: 0.14, peak: 0.23 });
      tone(audio, { at: 0.36, freq: 1174.66, dur: 0.3, peak: 0.24, harmonic: 0.2 });
      sparkle(audio, 0.36, 0.2, 0.09);
      tone(audio, { at: 0.56, freq: 880, dur: 0.12, peak: 0.16 });
      tone(audio, { at: 0.72, freq: 1174.66, dur: 0.7, peak: 0.22, vibrato: 6, sub: 0.4 });
      tone(audio, { at: 0.72, freq: 587.33, dur: 0.62, peak: 0.13, attack: 0.03 });
      tone(audio, { at: 0.72, freq: 739.99, dur: 0.62, peak: 0.11, attack: 0.03 });
      tone(audio, { at: 0.72, freq: 880, dur: 0.62, peak: 0.11, attack: 0.03 });
      tone(audio, { at: 0.72, freq: 146.83, dur: 0.6, type: "sine", peak: 0.12, attack: 0.04 });
      break;

    // Full ending (~1.9 s). A slow, steady ascent into a sustained C-major
    // chord with a low root - "the journey is complete", clearly a different
    // animal from a single-scene reward.
    case "finish":
      tone(audio, { at: 0, freq: 523.25, dur: 0.18, peak: 0.18, attack: 0.02 });
      tone(audio, { at: 0.22, freq: 659.26, dur: 0.18, peak: 0.19, attack: 0.02 });
      tone(audio, { at: 0.44, freq: 783.99, dur: 0.24, peak: 0.2, attack: 0.02 });
      tone(audio, { at: 0.78, freq: 523.25, dur: 0.85, peak: 0.16, attack: 0.05 });
      tone(audio, { at: 0.78, freq: 659.26, dur: 0.85, peak: 0.14, attack: 0.05 });
      tone(audio, { at: 0.78, freq: 783.99, dur: 0.85, peak: 0.14, attack: 0.05 });
      tone(audio, { at: 0.78, freq: 1046.5, dur: 0.8, peak: 0.1, attack: 0.05, harmonic: 0.2 });
      tone(audio, { at: 0.78, freq: 130.81, dur: 0.8, type: "sine", peak: 0.13, attack: 0.06 });
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function playSound(cue: SoundCue) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(KEY) === "off") return;
  const audio = getContext();
  if (!audio) return;
  bindGestureUnlock(audio);

  // Rapid re-triggers of the same event must not stack copies of the cue.
  const last = lastPlayedAt.get(cue);
  const now = performance.now();
  if (last !== undefined && now - last < COOLDOWN_MS[cue]) return;
  lastPlayedAt.set(cue, now);

  if (audio.state === "suspended") {
    // Autoplay policy: only schedule once the context actually runs, so a
    // blocked start cannot dump a stack of queued notes in one burst on resume.
    void audio
      .resume()
      .then(() => {
        if (audio.state === "running") scheduleCue(audio, cue);
      })
      .catch(() => undefined);
    return;
  }
  scheduleCue(audio, cue);
}

export function SoundToggle() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => setEnabled(isSoundEnabled()), []);
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
      }}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
