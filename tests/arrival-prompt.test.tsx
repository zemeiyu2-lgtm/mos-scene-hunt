// @vitest-environment jsdom
/**
 * Arrival prompt component (components/arrival-prompt.tsx).
 *
 * The card is the only thing standing between "GPS says arrived" and "the player
 * is taken into the challenge", so these tests pin the interaction contract:
 *   - it announces the right target and never navigates on its own;
 *   - the primary button enters the task, a double tap only navigates once;
 *   - both dismiss affordances leave the player on the map;
 *   - it rings the shared `arrive` cue exactly once per mount, honours the mute
 *     toggle, and still renders when audio is unavailable or blocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const SOUND_KEY = "mos-scene-hunt:sound-enabled";

/* --- Web Audio fakes (same shape as tests/sound.test.tsx) ------------------ */

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
    this.onended?.();
  }
}

class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  detune = new FakeParam();
}

function makeFakeContext(state: AudioContextState = "running", failResume = false) {
  return class FakeAudioContext {
    state = state;
    currentTime = 0;
    sampleRate = 48000;
    destination = new FakeNode();
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
      return Object.assign(new FakeNode(), { type: "", frequency: new FakeParam(), Q: new FakeParam() });
    }
    createBuffer(_channels: number, frames: number) {
      return { length: frames, getChannelData: () => new Float32Array(frames) };
    }
    createBufferSource() {
      return new FakeNode();
    }
  };
}

/** Fresh module graph so the sound module's singleton context resets. */
async function loadPrompt() {
  vi.resetModules();
  return import("@/components/arrival-prompt");
}

const arriveProps = (overrides: Partial<Record<string, unknown>> = {}) => ({
  sceneTitle: "1. 钟楼",
  placeName: "钟楼广场",
  onViewTask: vi.fn(),
  onDismiss: vi.fn(),
  ...overrides,
});

/** The sound hint appears after a 400 ms grace period; wait past it. */
async function afterSoundGracePeriod() {
  await new Promise((resolve) => setTimeout(resolve, 450));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  oscillatorCount = 0;
  cleanup();
});

describe("announcement content", () => {
  it("shows the arrival headline and the current target name", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps()} />);

    expect(screen.getByTestId("arrival-prompt")).toBeTruthy();
    expect(screen.getByText("目标已发现！")).toBeTruthy();
    expect(screen.getByText("1. 钟楼")).toBeTruthy();
    // Place + qualitative in-range hint. No precise distance: GPS accuracy
    // (±20-65 m) dwarfs the trigger ring (15-30 m), so a metre figure would
    // be unverifiable noise.
    expect(screen.getByText(/钟楼广场 · 你已进入任务触发范围。/)).toBeTruthy();
  });

  it("never shows a precise distance figure", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps()} />);
    expect(screen.queryByText(/距中心/)).toBeNull();
  });

  it("renders without a place name", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps({ placeName: null })} />);
    expect(screen.getByText("1. 钟楼")).toBeTruthy();
    expect(screen.getByText("你已进入任务触发范围。")).toBeTruthy();
  });

  it("offers one clear primary action and a non-navigating way back to the map", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps()} />);
    expect(screen.getByTestId("arrival-prompt-view-task").textContent).toContain("查看任务");
    expect(screen.getByTestId("arrival-prompt-continue").textContent).toContain("继续查看地图");
    expect(screen.getByTestId("arrival-prompt-dismiss")).toBeTruthy();
  });
});

describe("navigation contract", () => {
  it("never navigates on its own — mounting only announces", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);
    expect(props.onViewTask).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("enters the task on the primary tap", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);
    fireEvent.click(screen.getByTestId("arrival-prompt-view-task"));
    expect(props.onViewTask).toHaveBeenCalledTimes(1);
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("ignores a double tap so a slow phone cannot navigate twice", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);
    const primary = screen.getByTestId("arrival-prompt-view-task");
    fireEvent.click(primary);
    fireEvent.click(primary);
    fireEvent.click(primary);
    expect(props.onViewTask).toHaveBeenCalledTimes(1);
  });

  it("dismisses from the close button without entering the task", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);
    fireEvent.click(screen.getByTestId("arrival-prompt-dismiss"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onViewTask).not.toHaveBeenCalled();
  });

  it("dismisses from 继续查看地图 without entering the task", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);
    fireEvent.click(screen.getByTestId("arrival-prompt-continue"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onViewTask).not.toHaveBeenCalled();
  });
});

describe("arrival cue", () => {
  it("rings the shared arrive cue once on mount", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps()} />);
    // The `arrive` cue is two bells; each bell schedules its partial series
    // (9 oscillators in components/sound.tsx), so one ring = 18 oscillators.
    // Two rings would be 36 - the point of the assertion is "one ring, not two".
    expect(oscillatorCount).toBe(18);
  });

  it("does not ring again when the card re-renders for the same arrival", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    const { rerender } = render(<ArrivalPrompt {...arriveProps()} />);
    const afterMount = oscillatorCount;
    rerender(<ArrivalPrompt {...arriveProps({ placeName: "钟楼广场（东侧入口）" })} />);
    rerender(<ArrivalPrompt {...arriveProps({ placeName: "钟楼广场（西门）" })} />);
    expect(oscillatorCount).toBe(afterMount);
  });

  it("stays silent when the player has muted sound, but the card still works", async () => {
    window.localStorage.setItem(SOUND_KEY, "off");
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);

    expect(oscillatorCount).toBe(0);
    // Core interaction must not depend on audio.
    expect(screen.getByText("1. 钟楼")).toBeTruthy();
    fireEvent.click(screen.getByTestId("arrival-prompt-view-task"));
    expect(props.onViewTask).toHaveBeenCalledTimes(1);
  });

  it("still renders and navigates when Web Audio is unavailable", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);

    expect(screen.getByTestId("arrival-prompt")).toBeTruthy();
    fireEvent.click(screen.getByTestId("arrival-prompt-view-task"));
    expect(props.onViewTask).toHaveBeenCalledTimes(1);
  });

  it("still renders and navigates when the audio context refuses to resume", async () => {
    // Autoplay policy: the browser keeps the context suspended and blocks resume.
    vi.stubGlobal("AudioContext", makeFakeContext("suspended", true));
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);

    expect(screen.getByTestId("arrival-prompt")).toBeTruthy();
    fireEvent.click(screen.getByTestId("arrival-prompt-continue"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("autoplay-policy sound hint", () => {
  it("explains how to unlock the chime when the context stays suspended", async () => {
    // Phone browsers: no user gesture yet, so the context stays suspended and
    // the chime cannot play. The card must tell the player the one tap that
    // unlocks it instead of leaving silence unexplained.
    vi.stubGlobal("AudioContext", makeFakeContext("suspended", true));
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps()} />);

    // Within the grace period the card does not claim anything yet.
    expect(screen.queryByTestId("arrival-prompt-sound-hint")).toBeNull();
    await afterSoundGracePeriod();
    expect(screen.getByTestId("arrival-prompt-sound-hint").textContent).toContain(
      "点按屏幕任意处",
    );
    // The hint must never gate the interaction.
    expect(screen.getByTestId("arrival-prompt-view-task")).toBeTruthy();
  });

  it("shows no hint when the chime actually plays", async () => {
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps()} />);

    await afterSoundGracePeriod();
    expect(screen.queryByTestId("arrival-prompt-sound-hint")).toBeNull();
  });

  it("shows no hint when audio is unavailable (nothing to unlock)", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const { ArrivalPrompt } = await loadPrompt();
    const props = arriveProps();
    render(<ArrivalPrompt {...props} />);

    await afterSoundGracePeriod();
    expect(screen.queryByTestId("arrival-prompt-sound-hint")).toBeNull();
    // Card still fully works in silence.
    fireEvent.click(screen.getByTestId("arrival-prompt-view-task"));
    expect(props.onViewTask).toHaveBeenCalledTimes(1);
  });

  it("shows no hint while the player has muted sound", async () => {
    window.localStorage.setItem(SOUND_KEY, "off");
    vi.stubGlobal("AudioContext", makeFakeContext());
    const { ArrivalPrompt } = await loadPrompt();
    render(<ArrivalPrompt {...arriveProps()} />);

    await afterSoundGracePeriod();
    expect(screen.queryByTestId("arrival-prompt-sound-hint")).toBeNull();
  });
});
