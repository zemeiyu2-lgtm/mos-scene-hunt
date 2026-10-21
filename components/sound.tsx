"use client";

/**
 * Game sounds, synthesised with the Web Audio API (no audio files).
 *
 * Sound identity (V3 "deeper chapel bell" direction):
 * - Every cue is built from the same warm church-bell voice: an inharmonic
 *   partial series (hum / prime / tierce / quint / nominal) with a soft
 *   low-passed mallet strike and long exponential tails.
 * - Warmth and weight come from the low hum partial and the strike body;
 *   brightness stays capped so nothing reads as a brittle music-box chime.
 * - Loudness comes from layering and the master limiter, never from a single
 *   loud oscillator, so cues stay clean on small phone speakers and in
 *   headphones.
 * - Rapid re-triggers are throttled per cue and capped globally; autoplay
 *   policies are respected (nothing schedules until the context runs); init
 *   failures degrade to silence without crashing the game.
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
    // lets bell layers sit well above the old ~0.05 peak without clipping
    // when several voices overlap.
    const out = audio.createGain();
    out.gain.value = 0.9;
    if (typeof audio.createDynamicsCompressor === "function") {
      const limiter = audio.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 20;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
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
  unlock: 220,
  success: 240,
  reward: 600,
  finish: 600,
};

/** Hard cap on scheduled-but-unfinished voices; extra plays are dropped. */
const MAX_ACTIVE_VOICES = 48;

const lastPlayedAt = new Map<SoundCue, number>();
let activeVoices = 0;

/* ------------------------------------------------------------------ */
/* Synthesis primitives                                                */
/* ------------------------------------------------------------------ */

/** Plain decaying oscillator (used for the low drone under `unlock`). */
function tone(
  audio: AudioContext,
  spec: { at: number; freq: number; dur: number; peak: number; attack?: number },
) {
  const { at, freq, dur, peak, attack = 0.02 } = spec;
  const start = audio.currentTime + at;
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  env.connect(bus as GainNode);
  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  osc.connect(env);
  osc.start(start);
  osc.stop(start + dur + 0.03);
  activeVoices++;
  osc.onended = () => {
    activeVoices--;
  };
}

/**
 * Church-bell partial series: [ratio, gain, decay scale]. The hum (0.5) and
 * the slightly inharmonic tierce (1.19) give the warm, "mature" body; the
 * quiet nominal (2.0) keeps just enough definition. Higher partials decay
 * faster, like real metal.
 */
const BELL_PARTIALS: Array<[ratio: number, gain: number, decayScale: number]> = [
  [0.5, 0.5, 1.15],
  [1.0, 1.0, 0.85],
  [1.19, 0.32, 0.6],
  [1.5, 0.2, 0.45],
  [2.0, 0.1, 0.3],
];

function bell(
  audio: AudioContext,
  spec: { at: number; freq: number; dur: number; peak: number; strike?: boolean },
) {
  const { at, freq, dur, peak, strike = true } = spec;
  const start = audio.currentTime + at;
  for (let i = 0; i < BELL_PARTIALS.length; i++) {
    const [ratio, gain, decayScale] = BELL_PARTIALS[i];
    const partialDur = Math.max(dur * decayScale, 0.15);
    const env = audio.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(peak * gain, 0.0002), start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, start + partialDur);
    env.connect(bus as GainNode);
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * ratio, start);
    // Small alternating detune lets close partials beat gently - the slow
    // internal "shimmer" of a real bell, without any extra voices.
    osc.detune.setValueAtTime(i % 2 === 0 ? 3 : -3, start);
    osc.connect(env);
    osc.start(start);
    osc.stop(start + partialDur + 0.05);
    activeVoices++;
    osc.onended = () => {
      activeVoices--;
    };
  }
  if (strike) mallet(audio, at, peak * 0.25);
}

/** Soft low-passed noise burst - the felt-mallet contact, never a metal click. */
function mallet(audio: AudioContext, at: number, peak: number) {
  const start = audio.currentTime + at;
  const dur = 0.06;
  const frames = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  }
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const low = audio.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 1600;
  const env = audio.createGain();
  env.gain.setValueAtTime(Math.max(peak, 0.0002), start);
  src.connect(low);
  low.connect(env);
  env.connect(bus as GainNode);
  src.start(start);
  activeVoices++;
  src.onended = () => {
    activeVoices--;
  };
}

/** High, airy glint used sparingly on discovery / climax moments. */
function glint(audio: AudioContext, at: number, dur: number, peak: number) {
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
  band.frequency.value = 5200;
  band.Q.value = 1.4;
  const env = audio.createGain();
  env.gain.setValueAtTime(Math.max(peak, 0.0002), start);
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
 * Loudness hierarchy (bell peak gains before the limiter):
 *   reward 0.20 > finish 0.16 > success 0.16 > unlock 0.15 > arrive 0.14 > tap 0.06
 * All cues share one bell voice; they differ in register, rhythm, spacing and
 * tail length. Tails are long and warm - impact comes from low support and
 * spacing, never from added high notes or volume.
 */
function scheduleCue(audio: AudioContext, cue: SoundCue) {
  if (!bus || activeVoices >= MAX_ACTIVE_VOICES) return;
  switch (cue) {
    // A single tiny, muted bell touch. Quiet by design - it sits under
    // frequent taps without ever interrupting.
    case "tap":
      bell(audio, { at: 0, freq: 523.25, dur: 0.18, peak: 0.06 });
      break;

    // Warm, stable two-bell arrival: C4 grounds, G4 confirms. Slight overlap
    // keeps it feeling like one breath, not two events.
    case "arrive":
      bell(audio, { at: 0, freq: 261.63, dur: 1.0, peak: 0.14 });
      bell(audio, { at: 0.35, freq: 392.0, dur: 1.2, peak: 0.14 });
      break;

    // Discovery: a low drone opens the door (suspense), then three bells rise
    // gently through the partial haze; a faint glint marks the reveal.
    case "unlock":
      tone(audio, { at: 0, freq: 98, dur: 0.7, peak: 0.1, attack: 0.05 });
      bell(audio, { at: 0, freq: 196.0, dur: 0.9, peak: 0.13 });
      bell(audio, { at: 0.28, freq: 246.94, dur: 0.9, peak: 0.14 });
      bell(audio, { at: 0.56, freq: 293.66, dur: 1.2, peak: 0.15 });
      glint(audio, 0.6, 0.3, 0.05);
      break;

    // Compact, affirmative two-bell step (E4 -> A4). Clear resolution and a
    // satisfying tail, but only two voices - structurally far simpler than
    // reward, so it never upstages it.
    case "success":
      bell(audio, { at: 0, freq: 329.63, dur: 0.8, peak: 0.15 });
      bell(audio, { at: 0.22, freq: 440.0, dur: 1.1, peak: 0.16 });
      break;

    // Signature cue (~2.6 s + tail). One deep bell strike (C3, hum reaching
    // C2) grounds the moment; a rising C-major bell melody climbs through it;
    // the climax C5 lands over a G3 support and resolves into a long warm
    // tail with a faint glint. Weight from the low register, not volume.
    case "reward":
      bell(audio, { at: 0, freq: 130.81, dur: 2.4, peak: 0.2 });
      bell(audio, { at: 0.15, freq: 261.63, dur: 1.0, peak: 0.15 });
      bell(audio, { at: 0.55, freq: 329.63, dur: 1.0, peak: 0.16 });
      bell(audio, { at: 0.95, freq: 392.0, dur: 1.2, peak: 0.18 });
      bell(audio, { at: 1.35, freq: 523.25, dur: 1.8, peak: 0.2 });
      bell(audio, { at: 1.35, freq: 196.0, dur: 1.6, peak: 0.12 });
      glint(audio, 1.35, 0.7, 0.04);
      break;

    // Full ending (~3.6 s + tail). Three slow, evenly spaced bells (F3 - A3 -
    // C4) walk home, then a low sustained C-major chord (C3 + F3 + C4) rings
    // out underneath - calm, round, complete. Slower and wider than reward;
    // the journey, not the treasure.
    case "finish":
      bell(audio, { at: 0, freq: 174.61, dur: 1.2, peak: 0.14 });
      bell(audio, { at: 0.5, freq: 220.0, dur: 1.2, peak: 0.14 });
      bell(audio, { at: 1.0, freq: 261.63, dur: 1.4, peak: 0.15 });
      bell(audio, { at: 1.6, freq: 130.81, dur: 2.2, peak: 0.16 });
      bell(audio, { at: 1.6, freq: 174.61, dur: 2.0, peak: 0.12 });
      bell(audio, { at: 1.6, freq: 261.63, dur: 2.0, peak: 0.12 });
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
