"use client";

/**
 * Sound identity (V4 "real bell body" direction):
 * - Every cue is built from the same church-bell voice: a beat-twin hum/prime
 *   core, a true minor-third tierce, inharmonic quint/nominal, fast-decaying
 *   sharp strike partials, and a two-layer mallet (low thud + metallic ting).
 * - Warmth and weight come from the beating low hum; the definite attack comes
 *   from the 3 ms envelope and the bright strike layer; the long hum tail is
 *   the natural decay.
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

export type AudioPlaybackState = "unavailable" | "suspended" | "running";

/**
 * Current audio readiness, for UI that wants to explain an autoplay-policy
 * block. Deliberately does NOT create a context: before the first playSound
 * there is nothing to unlock, and callers should treat "unavailable" as
 * "nothing to hint about" (no hardware, muted, or audio never attempted).
 */
export function currentAudioState(): AudioPlaybackState {
  if (typeof window === "undefined" || !ctx) return "unavailable";
  return ctx.state === "suspended" ? "suspended" : "running";
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
    // Outdoor pass: phone speakers lose ~10-15 dB outdoors against traffic and
    // wind. The master sits just under the limiter instead of well below it.
    out.gain.value = 1.0;
    if (typeof audio.createDynamicsCompressor === "function") {
      const limiter = audio.createDynamicsCompressor();
      limiter.threshold.value = -10;
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
 * Church-bell partial series: [ratio, gain, decayScale, detuneCents].
 *
 * V4 redesign ("real bell body"): the previous five-sine stack read as a music
 * box, not a bell. Three things were missing and are now built in:
 * - **Beat twins** on the hum and prime: two slightly detuned sines per
 *   partial produce the slow internal swell (a real bell's partials beat
 *   against each other) that pure single sines can never make.
 * - **True tierce (1.19-1.2, a minor third above the prime)** is the colour
 *   that makes a bell sound like a church bell rather than an organ pipe.
 * - **Sharp strike partials** (2.67 / 3.36) decay in well under a second and
 *   give the attack its metallic "clang" edge, while the low hum (0.5) rings
 *   longest and carries the warmth and weight.
 */
const BELL_PARTIALS: Array<[ratio: number, gain: number, decayScale: number, detuneCents: number]> = [
  [0.5, 0.55, 1.45, -5], // hum, flat twin
  [0.5, 0.3, 1.45, 6], // hum, sharp twin - the slow beat/wow of the body
  [1.0, 1.0, 1.0, 4], // prime, flat twin
  [1.0, 0.35, 1.0, -6], // prime, sharp twin
  [1.19, 0.5, 0.72, 0], // tierce (minor third) - the church-bell colour
  [1.5, 0.3, 0.5, 0], // quint
  [2.0, 0.26, 0.34, 0], // nominal - carries outdoors on small speakers
  [2.67, 0.14, 0.1, 0], // sharp strike partial - dies instantly
  [3.36, 0.07, 0.07, 0], // upper strike partial - attack edge only
];

function bell(
  audio: AudioContext,
  spec: { at: number; freq: number; dur: number; peak: number; strike?: boolean },
) {
  const { at, freq, dur, peak, strike = true } = spec;
  const start = audio.currentTime + at;
  for (let i = 0; i < BELL_PARTIALS.length; i++) {
    const [ratio, gain, decayScale, detuneCents] = BELL_PARTIALS[i];
    const partialDur = Math.max(dur * decayScale, 0.12);
    const env = audio.createGain();
    env.gain.setValueAtTime(0.0001, start);
    // 3 ms attack: an immediate, definite onset (real bell partials start at
    // full amplitude) that still avoids a click.
    env.gain.exponentialRampToValueAtTime(Math.max(peak * gain, 0.0002), start + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, start + partialDur);
    env.connect(bus as GainNode);
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * ratio, start);
    // Per-partial detune from the table: the twin pairs beat against each
    // other at ~0.5-1 Hz around the base frequency - the shimmer of cast metal.
    osc.detune.setValueAtTime(detuneCents, start);
    osc.connect(env);
    osc.start(start);
    osc.stop(start + partialDur + 0.05);
    activeVoices++;
    osc.onended = () => {
      activeVoices--;
    };
  }
  if (strike) mallet(audio, at, peak * 0.3);
}

/**
 * Two-layer strike contact:
 * - a low-passed felt-mallet thud (the body being struck), and
 * - a very short band-passed metallic "ting" (~3.6 kHz) that dies in ~30 ms.
 * The old single low-passed thud softened the onset until the cue read as a
 * beep with reverb; the bright layer is what makes the attack read as metal.
 */
function mallet(audio: AudioContext, at: number, peak: number) {
  const start = audio.currentTime + at;
  const burst = (dur: number, decayPower: number) => {
    const frames = Math.max(1, Math.floor(audio.sampleRate * dur));
    const buffer = audio.createBuffer(1, frames, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** decayPower;
    }
    const src = audio.createBufferSource();
    src.buffer = buffer;
    return src;
  };
  // Low body thud.
  const thud = burst(0.06, 3);
  const low = audio.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 1400;
  const thudEnv = audio.createGain();
  thudEnv.gain.setValueAtTime(Math.max(peak * 0.8, 0.0002), start);
  thud.connect(low);
  low.connect(thudEnv);
  thudEnv.connect(bus as GainNode);
  thud.start(start);
  activeVoices++;
  thud.onended = () => {
    activeVoices--;
  };
  // Bright metallic contact - short, quiet, purely for the attack edge.
  const ting = burst(0.03, 2);
  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3600;
  band.Q.value = 1.8;
  const tingEnv = audio.createGain();
  tingEnv.gain.setValueAtTime(Math.max(peak * 0.45, 0.0002), start);
  ting.connect(band);
  band.connect(tingEnv);
  tingEnv.connect(bus as GainNode);
  ting.start(start);
  activeVoices++;
  ting.onended = () => {
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
 * Loudness hierarchy (bell peak gains before the limiter), outdoor pass:
 *   reward 0.27 > finish 0.22 = success 0.23* > unlock 0.21 > arrive 0.20 > tap 0.08
 * (*success peaks a hair above finish by design: it confirms an answer and must
 * cut through on the spot.) Roughly +3 dB over the indoor mix, carried by the
 * raised partial gains and the crisper strike rather than raw volume alone.
 */
function scheduleCue(audio: AudioContext, cue: SoundCue) {
  if (!bus || activeVoices >= MAX_ACTIVE_VOICES) return;
  switch (cue) {
    // A single tiny, muted bell touch. Quiet by design - it sits under
    // frequent taps without ever interrupting.
    case "tap":
      bell(audio, { at: 0, freq: 523.25, dur: 0.18, peak: 0.08 });
      break;

    // Warm, stable two-bell arrival: C4 grounds, G4 confirms. Slight overlap
    // keeps it feeling like one breath, not two events.
    case "arrive":
      bell(audio, { at: 0, freq: 261.63, dur: 1.0, peak: 0.2 });
      bell(audio, { at: 0.35, freq: 392.0, dur: 1.2, peak: 0.2 });
      break;

    // Discovery: a low drone opens the door (suspense), then three bells rise
    // gently through the partial haze; a faint glint marks the reveal.
    case "unlock":
      tone(audio, { at: 0, freq: 98, dur: 0.7, peak: 0.14, attack: 0.05 });
      bell(audio, { at: 0, freq: 196.0, dur: 0.9, peak: 0.18 });
      bell(audio, { at: 0.28, freq: 246.94, dur: 0.9, peak: 0.19 });
      bell(audio, { at: 0.56, freq: 293.66, dur: 1.2, peak: 0.21 });
      glint(audio, 0.6, 0.3, 0.07);
      break;

    // Compact, affirmative two-bell step (E4 -> A4). Clear resolution and a
    // satisfying tail, but only two voices - structurally far simpler than
    // reward, so it never upstages it.
    case "success":
      bell(audio, { at: 0, freq: 329.63, dur: 0.8, peak: 0.21 });
      bell(audio, { at: 0.22, freq: 440.0, dur: 1.1, peak: 0.23 });
      break;

    // Signature cue (~2.6 s + tail). One deep bell strike (C3, hum reaching
    // C2) grounds the moment; a rising C-major bell melody climbs through it;
    // the climax C5 lands over a G3 support and resolves into a long warm
    // tail with a faint glint. Weight from the low register, not volume.
    case "reward":
      bell(audio, { at: 0, freq: 130.81, dur: 2.4, peak: 0.27 });
      bell(audio, { at: 0.15, freq: 261.63, dur: 1.0, peak: 0.2 });
      bell(audio, { at: 0.55, freq: 329.63, dur: 1.0, peak: 0.21 });
      bell(audio, { at: 0.95, freq: 392.0, dur: 1.2, peak: 0.24 });
      bell(audio, { at: 1.35, freq: 523.25, dur: 1.8, peak: 0.27 });
      bell(audio, { at: 1.35, freq: 196.0, dur: 1.6, peak: 0.17 });
      glint(audio, 1.35, 0.7, 0.06);
      break;

    // Full ending (~3.6 s + tail). Three slow, evenly spaced bells (F3 - A3 -
    // C4) walk home, then a low sustained C-major chord (C3 + F3 + C4) rings
    // out underneath - calm, round, complete. Slower and wider than reward;
    // the journey, not the treasure.
    case "finish":
      bell(audio, { at: 0, freq: 174.61, dur: 1.2, peak: 0.2 });
      bell(audio, { at: 0.5, freq: 220.0, dur: 1.2, peak: 0.2 });
      bell(audio, { at: 1.0, freq: 261.63, dur: 1.4, peak: 0.21 });
      bell(audio, { at: 1.6, freq: 130.81, dur: 2.2, peak: 0.22 });
      bell(audio, { at: 1.6, freq: 174.61, dur: 2.0, peak: 0.17 });
      bell(audio, { at: 1.6, freq: 261.63, dur: 2.0, peak: 0.17 });
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
