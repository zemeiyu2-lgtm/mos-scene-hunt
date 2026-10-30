// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  PREVIEW_SESSION_KEY,
  disablePreview,
  enablePreview,
  isPreviewActive,
  resolveRuntimeMode,
  urlRequestsPreview,
} from "@/lib/runtime/mode";

function setDemoFlag(on: boolean) {
  if (on) window.sessionStorage.setItem("mos.demo.autopilot", "1");
  else window.sessionStorage.removeItem("mos.demo.autopilot");
}

describe("runtime mode resolution", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("defaults to player when nothing asks otherwise", () => {
    expect(resolveRuntimeMode("?game=abc")).toBe("player");
    expect(resolveRuntimeMode(null)).toBe("player");
  });

  it("?demo=1 URL parameter requests demo mode", () => {
    expect(resolveRuntimeMode("?demo=1")).toBe("demo");
  });

  it("a session demo flag keeps demo mode across navigations", () => {
    setDemoFlag(true);
    expect(resolveRuntimeMode("?game=abc")).toBe("demo");
    expect(resolveRuntimeMode(null)).toBe("demo");
  });

  it("?preview=1 and the preview flag request preview mode", () => {
    expect(urlRequestsPreview("?preview=1")).toBe(true);
    expect(resolveRuntimeMode("?preview=1")).toBe("preview");
    enablePreview();
    expect(isPreviewActive()).toBe(true);
    expect(resolveRuntimeMode(null)).toBe("preview");
    disablePreview();
    expect(isPreviewActive()).toBe(false);
    expect(resolveRuntimeMode(null)).toBe("player");
  });

  it("demo wins over a stale preview flag (kiosk deep link priority)", () => {
    enablePreview();
    setDemoFlag(true);
    expect(resolveRuntimeMode(null)).toBe("demo");
  });

  it("unrecognised values never escalate the mode", () => {
    expect(resolveRuntimeMode("?demo=0")).toBe("player");
    expect(resolveRuntimeMode("?demo=true")).toBe("player");
    expect(resolveRuntimeMode("?preview=yes")).toBe("player");
    expect(PREVIEW_SESSION_KEY).toBe("mos.runtime.preview");
  });
});
