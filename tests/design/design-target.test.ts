/**
 * Tests for the「继续设计」deep link resolution (app/design/design-target.ts).
 *
 * Regression guard: the games centre links to /design?game=<id>, and the
 * design page must load exactly that authored pack - not whatever pack is
 * currently active. Previously the query parameter was ignored entirely.
 */

import { describe, expect, it } from "vitest";
import { pickDesignGame } from "@/app/design/design-target";
import type { Game } from "@/lib/game/types";

const PACK: Game = {
  id: "my-hunt",
  title: "我的寻宝",
  version: "0.1.0",
  format: "mos-scene-hunt",
  startLocation: { lat: 22.5, lng: 114.0 },
  entrySceneId: "s1",
  scenes: [
    {
      id: "s1",
      title: "第一站",
      story: "故事",
      location: { lat: 22.5, lng: 114.0, radius: 15 },
      nextSceneId: null,
      challenge: { type: "choice", question: "？", options: ["A", "B"], answer: 0 },
      reward: { type: "keyword", title: "线索", value: "线索" },
    },
  ],
} as unknown as Game;

const loadById = (id: string) => (id === PACK.id ? PACK : null);

describe("pickDesignGame", () => {
  it("loads the exact authored pack named by the ?game= parameter", () => {
    const result = pickDesignGame("?game=my-hunt", loadById);
    expect(result?.id).toBe("my-hunt");
    expect(result?.title).toBe("我的寻宝");
    expect(result?.scenes[0]?.id).toBe("s1");
  });

  it("keeps other query parameters and still finds the game id", () => {
    const result = pickDesignGame("?foo=1&game=my-hunt&bar=2", loadById);
    expect(result?.id).toBe("my-hunt");
  });

  it("returns null when the parameter is absent", () => {
    expect(pickDesignGame("", loadById)).toBeNull();
    expect(pickDesignGame("?foo=1", loadById)).toBeNull();
  });

  it("returns null when the named game is not stored locally", () => {
    expect(pickDesignGame("?game=unknown-id", loadById)).toBeNull();
  });

  it("returns an independent clone - editing the draft cannot touch the store", () => {
    const stored: Game = structuredClone(PACK);
    const result = pickDesignGame("?game=my-hunt", () => stored);
    result!.title = "被改过的标题";
    result!.scenes[0]!.title = "被改过的站";
    expect(stored.title).toBe("我的寻宝");
    expect(stored.scenes[0]!.title).toBe("第一站");
  });
});
