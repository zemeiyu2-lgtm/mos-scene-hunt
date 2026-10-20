// @vitest-environment jsdom
/**
 * Tests for the synthesised game sounds (components/sound.tsx).
 *
 * Covers: complete six-cue mapping, mute behaviour, graceful degradation when
 * Web Audio is missing or fails to initialise, suspended-context handling,
 * rapid re-trigger stacking control, and SoundToggle persistence.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const KEY = "mos-scene-hunt:sound-enabled";

/* ------------------------------------------------------------------ */
/* Web Audio fakes                                                     */
/* ------------------------------------------------------------------ */

let constructed = 0;
let oscillatorCount = 0;

class FakeParam {
  value = 0;
  connect(target: unknown) {
    return target;
  }
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}

class FakeNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect(target: unknown) {
    return target;
  }
  start() {}
  stop() {
    // Emulate the voice finishing so the module's active-voice bookkeeping
    // behaves like real audio in the long run.
    this.onended?.();
  }
}

class FakeOscillator extends FakeNode {
  type: string = "sine";
  frequency = new FakeParam();
  detune = new FakeParam();
}

function makeFakeContext(state: AudioContextState = "running", failResume = false) {
  return class FakeAudioContext {
    state = state;
    currentTime = 0;
    sampleRate = 48000;
    destination = new FakeNode();
    constructor() {
      constructed++;
    }
    resume() {
      if (failResume) return Promise.reject(new Error("resume blocked"));
      this.state = "running";
      return Promise.resolve();
    }
    createGain() {
      return Object.assign(new FakeNode(), { gain: new FakeParam() });
    }
    createOscillator() {
      oscillatorCount++;
      return new FakeOscillator();
    }
    createDynamicsCompressor() {
      return Object.assign(new FakeNode(), {
        threshold: new FakeParam(),
        knee: new FakeParam(),
        ratio: new FakeParam(),
        attack: new FakeParam(),
        release: new FakeParam(),
      });
    }
    createBiquadFilter() {
      return Object.assign(new FakeNode(), {
        type: "",
        frequency: new FakeParam(),
        Q: new FakeParam(),
      });
    }
    createBuffer(channels: number, frames: number, rate: number) {
      // Shape only mirrors what the module reads; channel/rate included so the
      // fake parameters are consumed.
      return { channels, rate, length: frames, getChannelData: () => new Float32Array(frames) };
    }
    createBufferSource() {
      return new FakeNode();
    }
  };
}

/** Re-import the module fresh so its singleton state resets between tests. */
async function loadSound() {
  vi.resetModules();
  return import("@/components/sound");
}

const CUES = ["tap", "arrive", "unlock", "success", "reward", "finish"] as const;

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  constructed = 0;
  oscillatorCount = 0;
  cleanup();
});

describe("playSound cue mapping", () => {
  it("maps all six cues to non-empty playback", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    for (const cue of CUES) {
      const { playSound } = await loadSound();
      playSound(cue);
      expect(oscillatorCount, `cue "${cue}" should schedule oscillators`).toBeGreaterThan(0);
      oscillatorCount = 0;
    }
  });

  it("keeps the six-cue type exhaustive at runtime", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { playSound } = await loadSound();
    expect(() => CUES.forEach((cue) => playSound(cue))).not.toThrow();
  });
});

describe("mute behaviour", () => {
  it("never creates an AudioContext or schedules sound while muted", async () => {
    window.localStorage.setItem(KEY, "off");
    const { playSound } = await loadSound();
    expect(() => playSound("reward")).not.toThrow();
    expect(constructed).toBe(0);
    expect(oscillatorCount).toBe(0);
  });

  it("plays again after unmuting via SoundToggle", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    window.localStorage.setItem(KEY, "off");
    const { SoundToggle } = await loadSound();
    const { rerender } = render(<SoundToggle />);
    expect(screen.getByRole("button").textContent).toBe("🔇");
    fireEvent.click(screen.getByRole("button"));
    rerender(<SoundToggle />);
    expect(window.localStorage.getItem(KEY)).toBe("on");
    expect(screen.getByRole("button").textContent).toBe("🔊");
    // Enabling gives a tap confirmation through the freshly created context.
    expect(constructed).toBe(1);
    expect(oscillatorCount).toBeGreaterThan(0);
  });
});

describe("graceful degradation", () => {
  it("does not crash when the AudioContext constructor throws", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio hardware");
        }
      },
    );
    const { playSound } = await loadSound();
    expect(() => playSound("tap")).not.toThrow();
    expect(() => playSound("reward")).not.toThrow();
  });

  it("does not crash when Web Audio is unsupported", async () => {
    const { playSound } = await loadSound();
    expect(() => playSound("tap")).not.toThrow();
    expect(constructed).toBe(0);
  });

  it("does not crash when resume() rejects on a suspended context", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext("suspended", true));
    const { playSound } = await loadSound();
    playSound("unlock");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(oscillatorCount).toBe(0);
  });
});

describe("suspended context / autoplay policy", () => {
  it("waits for resume before scheduling, then plays once running", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext("suspended"));
    const { playSound } = await loadSound();
    playSound("unlock");
    expect(oscillatorCount).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(oscillatorCount).toBeGreaterThan(0);
  });
});

describe("rapid re-trigger control", () => {
  it("drops a burst of identical taps inside the cooldown window", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { playSound } = await loadSound();
    playSound("tap");
    expect(oscillatorCount).toBeGreaterThan(0);
    oscillatorCount = 0;
    for (let i = 0; i < 20; i++) playSound("tap");
    expect(oscillatorCount).toBe(0);
  });

  it("drops a burst of heavy cues inside the cooldown window", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { playSound } = await loadSound();
    playSound("reward");
    expect(oscillatorCount).toBeGreaterThan(0);
    oscillatorCount = 0;
    for (let i = 0; i < 20; i++) playSound("reward");
    expect(oscillatorCount).toBe(0);
  });

  it("lets the same cue play again after its cooldown window", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("AudioContext", makeFakeContext());
      const { playSound } = await loadSound();
      playSound("tap");
      const first = oscillatorCount;
      oscillatorCount = 0;
      vi.advanceTimersByTime(120); // tap cooldown is 70 ms
      playSound("tap");
      expect(oscillatorCount).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SoundToggle persistence", () => {
  it("saves the off state and restores it on a fresh mount", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { SoundToggle } = await loadSound();
    render(<SoundToggle />);
    expect(screen.getByRole("button").textContent).toBe("🔊");
    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(KEY)).toBe("off");

    const { SoundToggle: FreshToggle } = await loadSound();
    cleanup();
    render(<FreshToggle />);
    expect(screen.getByRole("button").textContent).toBe("🔇");
    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(KEY)).toBe("on");
  });
});
