"use client";

/**
 * Hunt provider - the orchestration seam.
 *
 * Responsibilities:
 *  - load and validate the content pack
 *  - hydrate the save from storage and reconcile it against the pack
 *  - reduce GPS fixes into engine actions (arrive / leave)
 *  - persist on every meaningful change
 *  - expose derived, read-only values the screens render
 *
 * Deliberately does NOT contain any game rules. The rules live in
 * `lib/game/state.ts`; this file only decides when to dispatch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  activeScene,
  availableSceneIds,
  completionRatio,
  createInitialState,
  gameReducer,
  isGameComplete,
  reconcileState,
  sceneStatuses,
  statusOf,
  type GameState,
  type SceneStatus,
} from "@/lib/game/state";
import { DEFAULT_TRIGGER_RADIUS, distanceToLocation, isWithinRadius, type PositionFix } from "@/lib/location";
import { entryScene, sceneOrder, type Game, type Scene } from "@/lib/game/types";
import { loadGame, type LoadedGame } from "@/lib/content";
import {
  clearGameState,
  loadGameState,
  saveGameState,
  upsertHuntIndex,
  type SaveEnvelope,
} from "@/lib/storage";
import { useSettings } from "./providers";
import { useGps } from "./gps-provider";

export interface SceneDistance {
  sceneId: string;
  distance: number;
  /** True when inside the trigger ring (including the accuracy slack). */
  inRange: boolean;
  /** Signed metres to the edge of the ring; negative means inside. */
  margin: number;
}

interface HuntContextValue {
  game: Game | null;
  state: GameState | null;
  loading: boolean;
  loadError: string | null;
  /** Non-fatal authoring warnings from validation. */
  contentIssues: LoadedGame["issues"];
  contentSource: "network" | "cache" | null;
  loadProgress?: number;

  /** The scene the player should be heading to. */
  current: Scene | null;
  /** Distances for every scene, recomputed on each fix. */
  distances: Record<string, SceneDistance>;
  /** Scenes the player may enter right now. */
  available: string[];
  statuses: { scene: Scene; status: SceneStatus; isActive: boolean }[];
  complete: boolean;
  ratio: number;
  allScenes: Scene[];
  /** True when any scene's ring currently contains the player. */
  insideAnyScene: boolean;
  /** Id of the scene whose ring the player is standing in, if any. */
  insideSceneId: string | null;

  // Commands
  startHunt: () => void;
  enterScene: (sceneId: string) => void;
  openChallenge: (sceneId: string) => void;
  submitAnswer: (sceneId: string, payload: { selectedIndex?: number; text?: string }) => void;
  dismissScene: () => void;
  resetHunt: () => void;
  setState: (state: GameState) => void;
  reloadContent: (force?: boolean) => void;
  exportCurrentSave: () => string | null;
  importSaveText: (text: string) => boolean;
  lastSaveAt: number | null;
}

const HuntContext = createContext<HuntContextValue | null>(null);

export function HuntProvider({
  gameId,
  children,
}: {
  gameId: string;
  children: ReactNode;
}) {
  const { settings } = useSettings();
  const { fix } = useGps();

  const [loaded, setLoaded] = useState<LoadedGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSaveAt, setLastSaveAt] = useState<number | null>(null);

  /**
   * The reducer needs a game to run. Before the pack loads there is nothing to
   * reduce, so we hold a placeholder and swap it in once loaded - rather than
   * making every consumer handle `null`.
   */
  const [state, dispatch] = useReducer(
    (prev: GameState | null, action: Parameters<typeof gameReducer>[2] & { __game?: Game }) => {
      const game = action.__game;
      if (!game) return prev;
      const base = prev ?? createInitialState(game);
      return gameReducer(game, base, action);
    },
    null,
  );

  const loadedGameRef = useRef<Game | null>(null);

  /** Dispatch with the loaded game automatically attached. */
  const act = useCallback((action: Parameters<typeof gameReducer>[2]) => {
    const game = loadedGameRef.current;
    if (!game) return;
    dispatch({ ...action, __game: game } as never);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Load                                                            */
  /* ---------------------------------------------------------------- */

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await loadGame(gameId);
        loadedGameRef.current = result.game;
        setLoaded(result);

        // Hydrate from storage and reconcile against the pack. Reconciliation is
        // what makes a content-pack edit safe mid-playthrough.
        const persisted = loadGameState(gameId);
        const hydrated = reconcileState(result.game, persisted);
        dispatch({ type: "HYDRATE", state: hydrated, __game: result.game } as never);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [gameId],
  );

  useEffect(() => {
    void load();
    // `force` is intentionally not part of the initial-load dependency.
  }, [load]);

  /* ---------------------------------------------------------------- */
  /* Reduce GPS fixes into arrival state                             */
  /* ---------------------------------------------------------------- */

  /**
   * Which scene rings currently contain the player.
   *
   * Only scenes the player is allowed to enter are evaluated: standing on a
   * locked future scene must not pre-arm it, or a shortcut through the map would
   * skip the hunt.
   */
  const insideIds = useMemo(() => {
    const game = loadedGameRef.current;
    if (!game || !state || !fix) return [] as string[];
    const allowed = new Set(availableSceneIds(game, state));
    return game.scenes
      .filter((scene) => allowed.has(scene.id) || state.scenes[scene.id]?.status !== "locked")
      .filter((scene) =>
        isWithinRadius(fix, scene.location, {
          accuracy: fix.accuracy,
          allowAccuracySlack: settings.allowAccuracySlack,
        }),
      )
      .map((scene) => scene.id);
  }, [loaded, state, fix, settings.allowAccuracySlack]);

  // Push the computed containment into the reducer. The reducer only flips
  // arrived <-> baseline; it can never complete a scene from position alone.
  useEffect(() => {
    if (!fix || !loadedGameRef.current) return;
    act({ type: "FIX_UPDATE", now: fix.timestamp || Date.now(), insideSceneIds: insideIds });
  }, [insideIds, fix, act]);

  /* ---------------------------------------------------------------- */
  /* Persist                                                         */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!state) return;
    // Debounced: a walking player generates a fix per second and each one
    // touches lastUpdatedAt.
    const id = window.setTimeout(() => {
      if (saveGameState(state)) {
        setLastSaveAt(Date.now());
        if (loadedGameRef.current) {
          upsertHuntIndex({
            gameId: state.gameId,
            title: loadedGameRef.current.title,
            completedScenes: Object.values(state.scenes).filter((p) => p.status === "completed").length,
            totalScenes: loadedGameRef.current.scenes.length,
            lastPlayedAt: Date.now(),
          });
        }
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [state]);

  /* ---------------------------------------------------------------- */
  /* Derived values                                                  */
  /* ---------------------------------------------------------------- */

  const derived = useMemo(() => {
    const game = loaded?.game ?? null;
    if (!game || !state) {
      return {
        current: null,
        distances: {} as Record<string, SceneDistance>,
        available: [] as string[],
        statuses: [] as { scene: Scene; status: SceneStatus; isActive: boolean }[],
        complete: false,
        ratio: 0,
        allScenes: [] as Scene[],
        insideAnyScene: false,
        insideSceneId: null as string | null,
      };
    }

    const distances: Record<string, SceneDistance> = {};
    if (fix) {
      for (const scene of game.scenes) {
        const d = distanceToLocation(fix, scene.location);
        const slack = settings.allowAccuracySlack
          ? Math.min(fix.accuracy, (scene.location.radius ?? DEFAULT_TRIGGER_RADIUS) * 0.5)
          : 0;
        distances[scene.id] = {
          sceneId: scene.id,
          distance: d,
          inRange: isWithinRadius(fix, scene.location, {
            accuracy: fix.accuracy,
            allowAccuracySlack: settings.allowAccuracySlack,
          }),
          margin: d - ((scene.location.radius ?? DEFAULT_TRIGGER_RADIUS) + slack),
        };
      }
    }

    const insideIds = Object.values(distances).filter((d) => d.inRange).map((d) => d.sceneId);

    return {
      current: activeScene(game, state),
      distances,
      available: availableSceneIds(game, state),
      statuses: sceneStatuses(game, state),
      complete: isGameComplete(game, state),
      ratio: completionRatio(game, state),
      allScenes: sceneOrder(game),
      insideAnyScene: insideIds.length > 0,
      insideSceneId: insideIds[0] ?? null,
    };
  }, [loaded, state, fix, settings.allowAccuracySlack]);

  /* ---------------------------------------------------------------- */
  /* Commands                                                        */
  /* ---------------------------------------------------------------- */

  const startHunt = useCallback(() => {
    act({ type: "START", now: Date.now() });
    const game = loadedGameRef.current;
    const entry = game ? entryScene(game) : undefined;
    if (entry && game && state) {
      // The entry scene is reachable by definition; this only moves the pointer.
      if (statusOf(game, state, entry.id) !== "locked") {
        act({ type: "ENTER_SCENE", sceneId: entry.id, now: Date.now() });
      }
    }
  }, [act, state]);

  const enterScene = useCallback(
    (sceneId: string) => act({ type: "ENTER_SCENE", sceneId, now: Date.now() }),
    [act],
  );
  const openChallenge = useCallback(
    (sceneId: string) => act({ type: "OPEN_CHALLENGE", sceneId, now: Date.now() }),
    [act],
  );
  const submitAnswer = useCallback(
    (sceneId: string, payload: { selectedIndex?: number; text?: string }) =>
      act({ type: "SUBMIT_ANSWER", sceneId, now: Date.now(), ...payload }),
    [act],
  );
  const dismissScene = useCallback(
    () => act({ type: "CLOSE_SCENE", sceneId: state?.currentSceneId ?? "", now: Date.now() }),
    [act, state?.currentSceneId],
  );
  const resetHunt = useCallback(() => {
    clearGameState();
    act({ type: "RESET", now: Date.now() });
  }, [act]);

  const setStateExternal = useCallback(
    (next: GameState) => {
      const game = loadedGameRef.current;
      if (!game) return;
      dispatch({ type: "HYDRATE", state: reconcileState(game, next), __game: game } as never);
    },
    [],
  );

  const exportCurrentSave = useCallback(() => {
    if (!state) return null;
    return JSON.stringify(
      {
        schemaVersion: 1,
        savedAt: Date.now(),
        exportedAt: Date.now(),
        gameId: state.gameId,
        gameVersion: state.gameVersion,
        state,
      } satisfies SaveEnvelope,
      null,
      2,
    );
  }, [state]);

  const importSaveText = useCallback(
    (text: string) => {
      try {
        const envelope = JSON.parse(text) as SaveEnvelope;
        if (envelope?.state) {
          setStateExternal(envelope.state);
          return true;
        }
      } catch {
        /* fall through */
      }
      return false;
    },
    [setStateExternal],
  );

  const value = useMemo<HuntContextValue>(
    () => ({
      game: loaded?.game ?? null,
      state,
      loading,
      loadError,
      contentIssues: loaded?.issues ?? [],
      contentSource: loaded?.source ?? null,
      current: derived.current,
      distances: derived.distances,
      available: derived.available,
      statuses: derived.statuses,
      complete: derived.complete,
      ratio: derived.ratio,
      allScenes: derived.allScenes,
      insideAnyScene: derived.insideAnyScene,
      insideSceneId: derived.insideSceneId,
      startHunt,
      enterScene,
      openChallenge,
      submitAnswer,
      dismissScene,
      resetHunt,
      setState: setStateExternal,
      reloadContent: (force = true) => void load(force),
      exportCurrentSave,
      importSaveText,
      lastSaveAt,
    }),
    [
      loaded,
      state,
      loading,
      loadError,
      derived,
      startHunt,
      enterScene,
      openChallenge,
      submitAnswer,
      dismissScene,
      resetHunt,
      setStateExternal,
      load,
      exportCurrentSave,
      importSaveText,
      lastSaveAt,
    ],
  );

  return <HuntContext.Provider value={value}>{children}</HuntContext.Provider>;
}

export function useHunt(): HuntContextValue {
  const ctx = useContext(HuntContext);
  if (!ctx) throw new Error("useHunt must be used inside <HuntProvider>");
  return ctx;
}

/** Convenience for screens that only make sense once the pack is loaded. */
export function useGame(): { game: Game; state: GameState } {
  const { game, state } = useHunt();
  if (!game || !state) throw new Error("useGame used before the content pack finished loading");
  return { game, state };
}

export type { PositionFix };
