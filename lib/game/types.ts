/**
 * MOS Scene Hunt - V0.1 content data model.
 *
 * Design rule (spec section 5): game logic is never hardcoded into a page.
 * Everything a player reads or does is described by these types, authored in a
 * JSON content pack under /content, and validated before use.
 *
 * Forward-compatibility rule (spec sections 15 & 16): the AI-facing narrative
 * fields (`story`, `briefing`, `hint`, `npc`, `dialogue`) and the AR anchor hook
 * already exist in the schema as optional data. V0.1 merely renders them
 * statically; a future AI Story Engine can populate them at runtime. Crucially,
 * NONE of them can influence GPS, unlock or reward decisions - those are owned
 * by the deterministic engine in `state.ts`.
 */

/** The three challenge kinds V0.1 supports. */
export type ChallengeType = "text" | "choice" | "keyword";

export const SUPPORTED_CHALLENGE_TYPES: readonly ChallengeType[] = ["text", "choice", "keyword"];

export type RewardType = "keyword" | "item" | "badge" | "story";

export interface Reward {
  type: RewardType;
  title: string;
  description?: string;
  /**
   * For `keyword` rewards: the word the player collects, which later scenes may
   * reference. For `item` rewards: the inventory item id.
   */
  value?: string;
  /** Optional icon hint for the UI (emoji or short glyph). */
  icon?: string;
}

export interface Challenge {
  type: ChallengeType;
  question: string;
  /** For `choice` challenges. */
  options?: string[];
  /**
   * For `choice`: the index into `options`.
   * For `text` / `keyword`: an array of accepted answers.
   * Matching is normalised (case, width, whitespace, punctuation) - see `answers.ts`.
   */
  answer: number | string | string[];
  hint?: string;
  /**
   * For `keyword` challenges: additional accepted synonyms shown to the player
   * as a nudge. Kept separate from `answer` so the answer list stays secret.
   */
  acceptedKeywords?: string[];
  /** Optional narrative frame for the question. */
  prompt?: string;
  /** Explanation shown after a correct answer. */
  explanation?: string;
  /** Max attempts before the hint is revealed automatically. 0 = unlimited. */
  hintAfterAttempts?: number;
}

/** A remote or local character that can speak in a scene (future AI hook). */
export interface NPC {
  id: string;
  name: string;
  /** Free-form role label, e.g. "向导", "旁观者". */
  role?: string;
  /** Optional avatar URL. Must be an asset the project has rights to. */
  avatar?: string;
  /** Whether this NPC is intended to be voiced by an AI story engine later. */
  aiDriven?: boolean;
}

export interface DialogueLine {
  /** NPC id, or "narrator" / "player". */
  speaker: string;
  text: string;
  /** Optional cue for a future AI engine to improvise from. */
  intent?: string;
}

export interface Scene {
  id: string;
  title: string;
  /** Primary narrative body shown on arrival. */
  story: string;
  /** Optional pre-arrival briefing shown while travelling to the scene. */
  briefing?: string;
  location: {
    lat: number;
    lng: number;
    radius?: number;
    name?: string;
  };
  /** Progression graph. `null` means "this is the final scene". */
  nextSceneId: string | null;
  challenge?: Challenge;
  reward?: Reward;
  /** AI-facing narrative scaffolding. Purely presentational in V0.1. */
  hint?: string;
  npc?: NPC;
  dialogue?: DialogueLine[];
  /**
   * AR extension hook (spec section 16). A future build resolves this anchor
   * and renders a 3D object over the camera feed; V0.1 only stores it.
   */
  ar?: {
    anchorType?: "ground" | "wall" | "surface" | "sky";
    modelUrl?: string;
    scale?: number;
    rotation?: [number, number, number];
  };
  /** Real-world place metadata for authored location-based content. */
  place?: {
    name: string;
    type?: "monument" | "garden" | "memorial" | "landmark" | "public-space";
    observationFocus?: string;
    accessNote?: string;
    source?: {
      name: string;
      url: string;
    };
  };
  /** Optional per-scene overrides for the map style. */
  mapStyle?: {
    color?: string;
    icon?: string;
  };
}

export interface StartLocation {
  lat: number;
  lng: number;
  name?: string;
  /** Radius for the "you have arrived at the hunt start" gate. */
  radius?: number;
}

/**
 * The overall playable area of a hunt.
 *
 * huntArea.radiusMeters is the whole exploration zone. Micro hunts may use
 * compact radii (for example 50-100m); scene.location.radius is the precise unlock ring.
 */
export interface HuntArea {
  center: {
    lat: number;
    lng: number;
  };
  /** Overall exploration radius in metres. Kept for backwards compatibility and compact-area hints. */
  radiusMeters: number;
  /** "circle" is the legacy/default mode; "polygon" is a precise author-drawn boundary. */
  shape?: "circle" | "polygon";
  /** WGS84 vertices for a custom closed hunt boundary. Minimum 3 points when shape="polygon". */
  points?: Array<{ lat: number; lng: number }>;
  /** Optional player-facing label. */
  name?: string;
}

export interface Game {
  /** Stable id, also used for the persisted save slot. */
  id: string;
  /** BCP-47 tag, e.g. "zh-CN". */
  language: string;
  title: string;
  description: string;
  author?: string;
  version: string;
  /** Estimated minutes, shown on the hunt-select card. */
  estimatedMinutes?: number;
  difficulty?: "easy" | "medium" | "hard";
  /** Where the hunt begins. */
  startLocation: StartLocation;
  /** Optional overall exploration boundary. */
  huntArea?: HuntArea;
  /** Ordered entry point into the scene graph. */
  entrySceneId?: string;
  scenes: Scene[];
  /** Future-proofing metadata for the AI story engine. */
  aiProfile?: {
    /** Narrative tone the AI should adopt when generating content. */
    tone?: string;
    /** Facts the AI must not contradict. */
    canon?: string[];
    /** Whether the content pack is safe to hand to an AI generator. */
    allowGeneration?: boolean;
  };
}

/* ------------------------------------------------------------------ */
/* Structural validation                                              */
/* ------------------------------------------------------------------ */

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export class GameDataError extends Error {
  readonly issues: ValidationIssue[];
  constructor(gameId: string, issues: ValidationIssue[]) {
    const errors = issues.filter((i) => i.severity === "error");
    super(
      `Content pack "${gameId}" failed validation with ${errors.length} error(s): ` +
        errors.map((e) => `${e.path} ${e.message}`).join("; "),
    );
    this.name = "GameDataError";
    this.issues = issues;
  }
}

/**
 * Validate a raw content pack.
 *
 * Deliberately hand-rolled rather than pulling in a schema library: it keeps the
 * dependency tree small (easier licence audit), and lets us emit player-oriented
 * messages plus cross-reference checks that a generic validator would not do,
 * such as "nextSceneId points at a scene that does not exist" or "the scene graph
 * contains a cycle".
 */
export function validateGame(raw: unknown): { game: Game; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) =>
    issues.push({ path, message, severity: "warning" });

  if (typeof raw !== "object" || raw === null) {
    err("$", "内容包必须是一个 JSON 对象");
    throw new GameDataError("<unknown>", issues);
  }
  const g = raw as Partial<Game>;

  const str = (v: unknown, path: string, required = true): string => {
    if (typeof v === "string" && v.length > 0) return v;
    if (required) err(path, "必须是非空字符串");
    return "";
  };
  const num = (v: unknown, path: string, required = true): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (required) err(path, "必须是有限数字");
    return NaN;
  };

  const id = str(g.id, "$.id");
  str(g.language, "$.language");
  str(g.title, "$.title");
  str(g.description, "$.description");
  str(g.version, "$.version");

  if (!g.startLocation || typeof g.startLocation !== "object") {
    err("$.startLocation", "缺少起点定义");
  } else {
    checkLatLng(g.startLocation.lat, g.startLocation.lng, "$.startLocation", err);
  }

  if (g.huntArea !== undefined) {
    if (!g.huntArea || typeof g.huntArea !== "object") {
      err("$.huntArea", "寻宝区域必须是对象");
    } else {
      checkLatLng(g.huntArea.center?.lat, g.huntArea.center?.lng, "$.huntArea.center", err);
      const r = g.huntArea.radiusMeters;
      if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) {
        err("$.huntArea.radiusMeters", "必须是正数");
      } else if (r < 30) {
        warn("$.huntArea.radiusMeters", "区域半径 " + r + "m 很小，请确认 GPS 环境适合此范围");
      } else if (r > 5000) {
        warn("$.huntArea.radiusMeters", "区域半径 " + r + "m 偏大，建议不超过 5km");
      }
      if (g.huntArea.shape !== undefined && g.huntArea.shape !== "circle" && g.huntArea.shape !== "polygon") {
        err("$.huntArea.shape", "必须是 circle 或 polygon");
      }
      if (g.huntArea.shape === "polygon") {
        if (!Array.isArray(g.huntArea.points) || g.huntArea.points.length < 3) {
          err("$.huntArea.points", "自定义闭环至少需要 3 个地图点");
        } else {
          g.huntArea.points.forEach((point, i) => {
            checkLatLng(point?.lat, point?.lng, `$.huntArea.points[${i}]`, err);
          });
        }
      } else if (g.huntArea.points !== undefined && !Array.isArray(g.huntArea.points)) {
        err("$.huntArea.points", "必须是坐标数组");
      }
    }
  }

  if (!Array.isArray(g.scenes) || g.scenes.length === 0) {
    err("$.scenes", "至少需要一个场景");
  } else {
    const seen = new Set<string>();
    g.scenes.forEach((scene, i) => {
      const base = `$.scenes[${i}]`;
      if (!scene || typeof scene !== "object") {
        err(base, "场景必须是对象");
        return;
      }
      const sid = str(scene.id, `${base}.id`);
      if (sid) {
        if (seen.has(sid)) err(`${base}.id`, `场景 id 重复：${sid}`);
        seen.add(sid);
      }
      str(scene.title, `${base}.title`);
      str(scene.story, `${base}.story`);

      if (!scene.location || typeof scene.location !== "object") {
        err(`${base}.location`, "缺少 location");
      } else {
        checkLatLng(scene.location.lat, scene.location.lng, `${base}.location`, err);
        const r = scene.location.radius;
        if (r !== undefined) {
          if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) {
            err(`${base}.location.radius`, "半径必须是正数");
          } else if (r < 10) {
            warn(
              `${base}.location.radius`,
              `半径 ${r}m 小于建议下限 20m，真实 GPS 误差下可能难以触发`,
            );
          } else if (r > 500) {
            warn(`${base}.location.radius`, `半径 ${r}m 偏大，可能提前触发，建议不超过 300m`);
          }
        } else {
          warn(`${base}.location.radius`, "未设置半径，将使用默认 50m");
        }
      }

      if (scene.nextSceneId !== null && scene.nextSceneId !== undefined) {
        if (typeof scene.nextSceneId !== "string" || !scene.nextSceneId) {
          err(`${base}.nextSceneId`, "必须是场景 id 或 null");
        }
      }

      if (scene.challenge) {
        validateChallenge(scene.challenge, `${base}.challenge`, err, warn);
      }

      if (scene.reward) {
        const validRewardTypes: RewardType[] = ["keyword", "item", "badge", "story"];
        if (!validRewardTypes.includes(scene.reward.type as RewardType)) {
          err(`${base}.reward.type`, `奖励类型必须是 ${validRewardTypes.join(" / ")}`);
        }
        str(scene.reward.title, `${base}.reward.title`);
        if (scene.reward.type === "keyword" && !scene.reward.value && !scene.reward.title) {
          err(`${base}.reward`, "keyword 类型奖励需要 value 或 title");
        }
      }
    });

    // Cross-reference + cycle detection over the scene graph.
    const ids = new Set(g.scenes.map((s) => s?.id).filter(Boolean) as string[]);
    g.scenes.forEach((scene, i) => {
      if (scene?.nextSceneId && !ids.has(scene.nextSceneId)) {
        err(`$.scenes[${i}].nextSceneId`, `指向不存在的场景：${scene.nextSceneId}`);
      }
    });

    const entry = g.entrySceneId ?? g.scenes[0]?.id;
    if (entry && !ids.has(entry)) {
      err("$.entrySceneId", `入口场景不存在：${entry}`);
    }
    if (entry && ids.has(entry)) {
      detectCycle(entry, g.scenes, issues);
      // Reachability: flag scenes the player can never arrive at.
      const reachable = collectReachable(entry, g.scenes);
      g.scenes.forEach((scene, i) => {
        if (scene?.id && !reachable.has(scene.id)) {
          warn(`$.scenes[${i}].id`, `场景 "${scene.id}" 无法从入口到达（孤立场景）`);
        }
      });
    }
  }

  if (issues.some((i) => i.severity === "error")) {
    throw new GameDataError(id || "<unknown>", issues);
  }
  return { game: g as Game, issues };
}

function checkLatLng(
  lat: unknown,
  lng: unknown,
  path: string,
  err: (p: string, m: string) => void,
): void {
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    err(`${path}.lat`, "纬度必须在 -90 到 90 之间");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    err(`${path}.lng`, "经度必须在 -180 到 180 之间");
  }
}

function validateChallenge(
  c: Challenge,
  base: string,
  err: (p: string, m: string) => void,
  warn: (p: string, m: string) => void,
): void {
  if (!SUPPORTED_CHALLENGE_TYPES.includes(c.type)) {
    err(`${base}.type`, `V0.1 仅支持 ${SUPPORTED_CHALLENGE_TYPES.join(" / ")}`);
    return;
  }
  if (typeof c.question !== "string" || !c.question) err(`${base}.question`, "必须是非空字符串");

  if (c.type === "choice") {
    if (!Array.isArray(c.options) || c.options.length < 2) {
      err(`${base}.options`, "选择题至少需要 2 个选项");
      return;
    }
    if (c.options.length > 6) warn(`${base}.options`, "选项超过 6 个，移动端可能显示拥挤");
    if (typeof c.answer !== "number" || !Number.isInteger(c.answer)) {
      err(`${base}.answer`, "选择题的 answer 必须是选项下标（整数）");
    } else if (c.answer < 0 || c.answer >= c.options.length) {
      err(`${base}.answer`, `选项下标越界：${c.answer}`);
    }
  } else if (c.type === "text" || c.type === "keyword") {
    const answers = Array.isArray(c.answer) ? c.answer : [c.answer];
    if (answers.length === 0 || answers.some((a) => typeof a !== "string" || !a.trim())) {
      err(`${base}.answer`, "文本/关键词题需要至少一个非空答案");
    }
    if (c.acceptedKeywords && !Array.isArray(c.acceptedKeywords)) {
      err(`${base}.acceptedKeywords`, "必须是字符串数组");
    }
    // Secret-leak guard: an accepted keyword that equals the answer is pointless,
    // while an answer listed in acceptedKeywords would spawn a giveaway hint.
    if (Array.isArray(c.acceptedKeywords) && c.type === "keyword") {
      const answerSet = new Set(answers.map((a) => String(a).toLowerCase().trim()));
      const leaked = c.acceptedKeywords.filter((k) =>
        answerSet.has(String(k).toLowerCase().trim()),
      );
      if (leaked.length) {
        warn(`${base}.acceptedKeywords`, `提示词与答案重复，建议移除：${leaked.join(", ")}`);
      }
    }
  }
}

function detectCycle(entryId: string, scenes: Scene[], issues: ValidationIssue[]): void {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const state = new Map<string, 0 | 1 | 2>();

  const visit = (id: string, trail: string[]): void => {
    const status = state.get(id);
    if (status === 1) {
      issues.push({
        path: `$.scenes[${id}]`,
        message: `场景图存在环：${[...trail, id].join(" -> ")}`,
        severity: "error",
      });
      return;
    }
    if (status === 2) return;
    state.set(id, 1);
    const next = byId.get(id)?.nextSceneId;
    if (next) visit(next, [...trail, id]);
    state.set(id, 2);
  };
  visit(entryId, []);
}

function collectReachable(entryId: string, scenes: Scene[]): Set<string> {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = [entryId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = byId.get(id)?.nextSceneId;
    if (next) stack.push(next);
  }
  return seen;
}

/** Total number of scenes in a hunt, for progress display. */
export function sceneCount(game: Game): number {
  return game.scenes.length;
}

/** The first scene a player encounters, honouring an explicit entrySceneId. */
export function entryScene(game: Game): Scene | undefined {
  const id = game.entrySceneId ?? game.scenes[0]?.id;
  return game.scenes.find((s) => s.id === id);
}

/** Ordered scene list following the nextSceneId chain from the entry scene. */
export function sceneOrder(game: Game): Scene[] {
  const byId = new Map(game.scenes.map((s) => [s.id, s]));
  const order: Scene[] = [];
  const seen = new Set<string>();
  let current = entryScene(game);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    order.push(current);
    current = current.nextSceneId ? byId.get(current.nextSceneId) : undefined;
  }
  // Append any scenes not on the main chain so content is never silently hidden.
  for (const scene of game.scenes) if (!seen.has(scene.id)) order.push(scene);
  return order;
}
