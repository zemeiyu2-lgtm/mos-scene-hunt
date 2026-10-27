// @vitest-environment jsdom
/**
 * Countdown behaviour on the challenge screen (timed challenge V1.0).
 *
 * These tests drive time with fake timers on purpose: the product rules are
 * about what happens at the deadline, and sleeping for 30 real seconds would
 * make the suite slow and flaky.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ChallengeExpiredPanel,
  ChallengeTimerBar,
  useAttemptClock,
} from "@/components/challenge-timer";

const T = 1_700_000_000_000;

function Harness({
  startedAt,
  limitMs,
  active,
  onExpire,
}: {
  startedAt: number | null;
  limitMs: number | null;
  active: boolean;
  onExpire: () => void;
}) {
  const { remainingMs, expired, ready } = useAttemptClock({ startedAt, limitMs, active, onExpire });
  return (
    <div>
      <span data-testid="phase">{expired ? "expired" : "running"}</span>
      <ChallengeTimerBar
        remainingMs={remainingMs}
        attempt={1}
        limitLabel="30 秒"
        ready={ready}
      />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAttemptClock", () => {
  it("counts down from the stored start", () => {
    render(<Harness startedAt={T} limitMs={30_000} active onExpire={() => {}} />);
    expect(screen.getByTestId("phase").textContent).toBe("running");

    act(() => void vi.advanceTimersByTime(5_000));
    expect(screen.getByText("0:25")).toBeTruthy();
  });

  it("reports the deadline exactly once, however many ticks follow", () => {
    const onExpire = vi.fn();
    render(<Harness startedAt={T} limitMs={30_000} active onExpire={onExpire} />);

    act(() => void vi.advanceTimersByTime(29_750));
    expect(onExpire).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(500));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("phase").textContent).toBe("expired");

    act(() => void vi.advanceTimersByTime(10_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("does not tick or expire when the question is untimed or solved", () => {
    const onExpire = vi.fn();
    const { rerender } = render(
      <Harness startedAt={null} limitMs={null} active={false} onExpire={onExpire} />,
    );
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(onExpire).not.toHaveBeenCalled();

    // Same with a limit configured but the clock stopped (solved / expired).
    rerender(<Harness startedAt={T - 60_000} limitMs={30_000} active={false} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("gives a retried attempt its own full window", () => {
    const onExpire = vi.fn();
    const { rerender } = render(<Harness startedAt={T} limitMs={30_000} active onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(onExpire).toHaveBeenCalledTimes(1);

    // The player takes a moment before tapping 重试.
    act(() => void vi.advanceTimersByTime(30_000));

    // 重试: a new start stamp, same limit -> back to the full window.
    rerender(
      <Harness startedAt={T + 60_000} limitMs={30_000} active onExpire={onExpire} />,
    );
    expect(screen.getByText("0:30")).toBeTruthy();
    expect(screen.getByTestId("phase").textContent).toBe("running");

    act(() => void vi.advanceTimersByTime(30_000));
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it("never shows more than the configured limit", () => {
    render(<Harness startedAt={T} limitMs={30_000} active onExpire={() => {}} />);
    expect(screen.getByText("0:30")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(screen.getByText("0:29")).toBeTruthy();
  });
});

describe("ChallengeExpiredPanel", () => {
  it("offers a retry that reports the next attempt number", () => {
    const onRetry = vi.fn();
    render(<ChallengeExpiredPanel attempt={1} limitLabel="30 秒" onRetry={onRetry} />);
    expect(screen.getByText(/时间到/)).toBeTruthy();
    expect(screen.getByText(/第 1 次尝试已超时/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /重试（第 2 次尝试）/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
