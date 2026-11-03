/**
 * Outdoor type scale (B-03 / B-02 UX-03).
 *
 * 171 sub-12px text nodes were found across the player surfaces: distance
 * readouts, HUD counters, task cards - the exact strings a player squints at
 * in daylight. This test pins the floor so the scale cannot silently erode:
 *
 *   tier 0  meta / decorative           >= 12px  (was 10-11px)
 *   tier 1  secondary body              >= 13px  (was 12-12.5px)
 *   tier 2  emphasis / titles           14-16px
 *   tier 3  HUD numbers / page titles   17px+
 *
 * Two thresholds: every player-facing surface must respect the 12px floor;
 * the surfaces read *while walking* (map HUD, arrival card, tab bar) must
 * respect 13px. Creator/admin tooling is explicitly out of scope here - it is
 * desk work, and /design gets its own pass.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Surfaces a player reads on the street. */
const PLAYER_FILES = [
  "app/page.tsx",
  "app/map/page.tsx",
  "app/select/page.tsx",
  "app/games/page.tsx",
  "app/quest/page.tsx",
  "app/scene/[sceneId]/page.tsx",
  "app/challenge/[sceneId]/page.tsx",
  "app/reward/[sceneId]/page.tsx",
  "app/bag/page.tsx",
  "app/tutorial/page.tsx",
  "components/ui.tsx",
  "components/arrival-prompt.tsx",
  "components/gps-status-banner.tsx",
  "components/gps-diagnostics.tsx",
  "components/tab-bar.tsx",
  "components/challenge-timer.tsx",
  "components/game-qr.tsx",
  "components/media-gallery.tsx",
];

/** Surfaces read mid-walk, in daylight, one-handed. */
const OUTDOOR_CRITICAL_FILES = [
  "app/map/page.tsx",
  "components/arrival-prompt.tsx",
  "components/gps-status-banner.tsx",
  "components/tab-bar.tsx",
];

const PX = /text-\[(\d+(?:\.\d+)?)px\]/g;

function sizesBelow(file: string, floor: number): string[] {
  const source = readFileSync(file, "utf8");
  const offenders: string[] = [];
  for (const match of source.matchAll(PX)) {
    const size = Number.parseFloat(match[1]);
    if (size < floor) offenders.push(`text-[${match[1]}px]`);
  }
  return offenders;
}

describe("outdoor type scale", () => {
  it("keeps every player surface at the 12px floor", () => {
    const problems = PLAYER_FILES.flatMap((file) =>
      sizesBelow(file, 12).map((offender) => `${file}: ${offender} (floor 12px)`),
    );
    expect(problems).toEqual([]);
  });

  it("keeps walk-time surfaces at the 13px floor", () => {
    const problems = OUTDOOR_CRITICAL_FILES.flatMap((file) =>
      sizesBelow(file, 13).map((offender) => `${file}: ${offender} (floor 13px)`),
    );
    expect(problems).toEqual([]);
  });

  it("documents the scale in globals.css", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/户外字号层级|outdoor type scale/i);
    expect(css).toMatch(/12px/);
    expect(css).toMatch(/13px/);
  });
});
