// @vitest-environment jsdom
/**
 * Tests for the share QR block (components/game-qr.tsx).
 *
 * qrcode.react is mocked so the tests can (a) capture the exact value handed
 * to the encoder - proving the QR encodes the FULL share URL, payload
 * included - and (b) force an encoder crash to verify the error boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GameQr } from "@/components/game-qr";

const behavior = vi.hoisted(() => ({ mode: "render" as "render" | "throw", lastValue: "" }));

vi.mock("qrcode.react", () => ({
  QRCodeCanvas: (props: { value: string }) => {
    behavior.lastValue = props.value;
    if (behavior.mode === "throw") throw new Error("encoder exploded");
    return <canvas data-testid="qr-canvas" />;
  },
}));

const ORIGIN = "https://mos-scene-hunt.vercel.app";
const fullShareUrl = (payloadChars: number) => `${ORIGIN}/select#hunt=g.${"A".repeat(payloadChars)}`;

beforeEach(() => {
  behavior.mode = "render";
  behavior.lastValue = "";
  cleanup();
});

describe("GameQr", () => {
  it("renders a QR for a short share link and encodes the FULL URL", () => {
    const url = fullShareUrl(600);
    render(<GameQr url={url} fileNamePrefix="test-hunt" />);
    expect(screen.getByTestId("qr-canvas")).toBeTruthy();
    // The encoder receives the complete share URL, #hunt= payload included -
    // never a truncated link or the site home page.
    expect(behavior.lastValue).toBe(url);
    expect(screen.getByText("下载二维码图片（PNG）")).toBeTruthy();
  });

  it("shows a precise explanation (no canvas) for a too-dense link without crashing", () => {
    const url = fullShareUrl(2700);
    render(<GameQr url={url} fileNamePrefix="test-hunt" />);
    expect(screen.queryByTestId("qr-canvas")).toBeNull();
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("version");
    expect(note.textContent).toContain("复制链接");
  });

  it("shows a capacity explanation (no canvas) for over-capacity input without crashing", () => {
    const url = fullShareUrl(4000);
    render(<GameQr url={url} fileNamePrefix="test-hunt" />);
    expect(screen.queryByTestId("qr-canvas")).toBeNull();
    expect(screen.getByRole("note").textContent).toContain("容量上限");
  });

  it("falls back to the copy-link message when the encoder itself throws", () => {
    behavior.mode = "throw";
    const url = fullShareUrl(600);
    render(<GameQr url={url} fileNamePrefix="test-hunt" />);
    // No unhandled crash: the boundary replaces the block with guidance.
    expect(screen.getByRole("note").textContent).toContain("复制链接发送");
  });
});
