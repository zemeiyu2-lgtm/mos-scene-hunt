"use client";

/**
 * Micro Designer — the authoring screen.
 *
 * Structured as four steps a first-time user can follow without prior context:
 *   ① 画游戏区域    draw the play area (freehand polygon or circle)
 *   ② 放置场景      place scenes inside that area
 *   ③ 设置触发距离  tune each scene's unlock radius
 *   ④ 保存游戏      save locally and play
 *
 * The map itself is the editor. Which click means what is owned here: while an
 * area-drawing session is active, clicks append boundary points; while circle
 * placement is active, one click sets the centre; otherwise clicks move the
 * selected scene. The map component only reports clicks.
 *
 * No GPS is required or requested: the designer works entirely from the map.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapView } from "@/components/map-view";
import { useSettings } from "@/components/providers";
import { Screen } from "@/components/ui";
import {
  clearActiveAuthoredGame,
  clearAuthoredGame,
  markCurrentAuthoredGame,
  saveAuthoredGame,
} from "@/lib/content";
import type { Game, HuntArea, Scene } from "@/lib/game/types";
import { BSOP_CLASSIC_TEMPLATE } from "@/lib/game/templates";
import {
  isPointInPolygon,
  polygonBoundingRadius,
  polygonCentroid,
} from "@/lib/location";
import type { MapSceneEntry } from "@/components/game-map";
import type { TileProviderId } from "@/lib/map/tiles";
import { useHunt } from "@/components/hunt-provider";

const MICRO_PRESETS = [30, 50, 75, 100, 150, 250];
const MIN_POLYGON_POINTS = 3;

export default function DesignPage() {
  const router = useRouter();
  const { game, loading, loadError, reloadContent } = useHunt();
  const { settings } = useSettings();
  const [draft, setDraft] = useState<Game | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // ① area-drawing session. While active, map clicks append boundary points.
  const [drawingArea, setDrawingArea] = useState(false);
  // One-shot circle placement: the next map click sets the area centre.
  const [placingCircle, setPlacingCircle] = useState(false);
  // What the area looked like before the current drawing session began, so
  // 「取消」 can restore it instead of destroying the designer's work.
  const [areaSnapshot, setAreaSnapshot] = useState<HuntArea | undefined>(undefined);

  const working = draft ?? game;
  const selected = working?.scenes.find((scene) => scene.id === selectedId) ?? working?.scenes[0] ?? null;

  const entries = useMemo<MapSceneEntry[]>(
    () =>
      working?.scenes.map((scene) => ({
        scene,
        status: "available",
        isActive: scene.id === selected?.id,
        distance: null,
        inRange: false,
      })) ?? [],
    [working, selected?.id],
  );

  const area = working?.huntArea;
  const isPolygon = area?.shape === "polygon";
  const polygonPoints = isPolygon ? area?.points ?? [] : [];
  const drawing = drawingArea;

  // A polygon still being drawn cannot be saved as a playable pack: the
  // validator requires at least three vertices.
  const areaIncomplete = isPolygon && polygonPoints.length < MIN_POLYGON_POINTS;

  /** Does the selected scene fall inside the drawn polygon? Cheap ray-cast. */
  const selectedOutsideArea = useMemo(() => {
    if (!isPolygon || polygonPoints.length < MIN_POLYGON_POINTS || !selected) return false;
    return !isPointInPolygon(
      { lat: selected.location.lat, lng: selected.location.lng },
      polygonPoints,
    );
  }, [isPolygon, polygonPoints, selected]);

  if (loading || !working) {
    return (
      <Screen title="创建游戏" subtitle="正在加载内容">
        <div className="card h-40 animate-pulse" />
        {loadError ? <p className="mt-3 text-sm text-red-700">{loadError}</p> : null}
      </Screen>
    );
  }

  const update = (patch: Partial<Game>) => {
    setSaved(false);
    setDraft({ ...working, ...patch, version: bumpVersion(working.version) });
  };

  const updateScene = (sceneId: string, patch: Partial<Scene>) => {
    const scenes = working.scenes.map((scene) =>
      scene.id === sceneId ? { ...scene, ...patch } : scene,
    );
    setSaved(false);
    setDraft({ ...working, scenes, version: bumpVersion(working.version) });
  };

  const updateLocation = (sceneId: string, lat: number, lng: number) => {
    const scene = working.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    updateScene(sceneId, { location: { ...scene.location, lat, lng } });
  };

  /* ---------------------------------------------------------------- ① 区域 */

  const summarizeRing = (points: Array<{ lat: number; lng: number }>) => {
    const center = polygonCentroid(points) ?? working.startLocation;
    const radiusMeters = Math.max(30, Math.round(polygonBoundingRadius(points)));
    return { center, radiusMeters };
  };

  const startPolygon = () => {
    setAreaSnapshot(working.huntArea);
    setDrawingArea(true);
    setPlacingCircle(false);
    setSaved(false);
    update({
      huntArea: {
        center: working.huntArea?.center ?? working.startLocation,
        radiusMeters: working.huntArea?.radiusMeters ?? 100,
        shape: "polygon",
        points: [],
        name: working.huntArea?.name ?? "自定义游戏区域",
      },
    });
  };

  const restartPolygon = () => {
    if (working.huntArea?.shape !== "polygon") return;
    setSaved(false);
    update({
      huntArea: {
        ...working.huntArea,
        center: working.huntArea.center ?? working.startLocation,
        radiusMeters: working.huntArea.radiusMeters || 100,
        points: [],
      },
    });
  };

  const cancelPolygon = () => {
    setDrawingArea(false);
    setSaved(false);
    // Restore whatever the area was before this session started; a brand-new
    // drawing has no snapshot, so the half-finished draft is dropped entirely.
    if (areaSnapshot) update({ huntArea: areaSnapshot });
    else if (working.huntArea?.shape === "polygon") update({ huntArea: undefined });
    setAreaSnapshot(undefined);
  };

  const undoPolygonPoint = () => {
    if (working.huntArea?.shape !== "polygon") return;
    const points = [...(working.huntArea.points ?? [])];
    points.pop();
    const { center, radiusMeters } = summarizeRing(points);
    update({
      huntArea: {
        ...working.huntArea,
        center: points.length ? center : working.huntArea.center,
        radiusMeters: points.length ? radiusMeters : Math.max(30, working.huntArea.radiusMeters || 100),
        points,
      },
    });
  };

  /** Commit the ring: it already lives on the pack; just close the session. */
  const finishPolygon = () => {
    if (working.huntArea?.shape !== "polygon") return;
    if ((working.huntArea.points?.length ?? 0) < MIN_POLYGON_POINTS) return;
    setDrawingArea(false);
    setAreaSnapshot(undefined);
  };

  const clearPolygon = () => {
    setDrawingArea(false);
    setAreaSnapshot(undefined);
    setSaved(false);
    update({
      huntArea: {
        center: working.huntArea?.center ?? working.startLocation,
        radiusMeters:
          working.huntArea?.shape === "polygon"
            ? Math.max(30, working.huntArea.radiusMeters)
            : working.huntArea?.radiusMeters ?? 100,
        shape: "circle",
        name: working.huntArea?.name ?? "圆形游戏区域",
      },
    });
  };

  const startCirclePlacement = () => {
    setAreaSnapshot(working.huntArea);
    setPlacingCircle(true);
    setDrawingArea(false);
  };

  const commitCircleCenter = (lat: number, lng: number) => {
    setPlacingCircle(false);
    setAreaSnapshot(undefined);
    update({
      huntArea: {
        center: { lat, lng },
        radiusMeters: working.huntArea?.radiusMeters ?? 100,
        shape: "circle",
        name: working.huntArea?.name ?? "圆形游戏区域",
      },
    });
  };

  const setHuntAreaRadius = (radiusMeters: number) => {
    update({
      huntArea: {
        center: working.huntArea?.center ?? working.startLocation,
        ...(working.huntArea ?? {}),
        radiusMeters,
      },
    });
  };

  /** Map click router: boundary point while drawing, circle centre while
   *  placing, otherwise move the selected scene (the original behaviour). */
  const handleMapClick = (lat: number, lng: number) => {
    if (drawingArea) {
      const current = working.huntArea;
      const points = current?.shape === "polygon" ? [...(current.points ?? [])] : [];
      points.push({ lat, lng });
      const { center, radiusMeters } = summarizeRing(points);
      update({
        huntArea: {
          center, radiusMeters, shape: "polygon", points,
          name: current?.name ?? "自定义游戏区域",
        },
      });
      return;
    }
    if (placingCircle) {
      commitCircleCenter(lat, lng);
      return;
    }
    if (!selected) return;
    updateLocation(selected.id, lat, lng);
  };

  /* ---------------------------------------------------------------- ② 场景 */

  const addScene = () => {
    const index = working.scenes.length + 1;
    const previous = working.scenes[working.scenes.length - 1];
    const base = previous?.location ?? working.startLocation;
    const id = `scene-${Date.now().toString(36)}`;
    const newScene: Scene = {
      id,
      title: `第${index}站 · 新地点`,
      story: "在这里写下玩家到达现场后看到的情境。",
      briefing: "前往这个地点，到达后解锁任务。",
      location: { lat: base.lat, lng: base.lng, radius: 15, name: "新地点" },
      nextSceneId: null,
      challenge: {
        type: "choice",
        question: "你在现场观察到了什么？",
        options: ["A", "B", "C"],
        answer: 0,
      },
      reward: { type: "keyword", title: "新线索", value: "线索" },
    };
    const scenes = working.scenes.map((scene, i) =>
      i === working.scenes.length - 1 ? { ...scene, nextSceneId: id } : scene,
    );
    scenes.push(newScene);
    setDraft({ ...working, scenes, version: bumpVersion(working.version) });
    setSelectedId(id);
    setSaved(false);
  };

  const deleteSelected = () => {
    if (!selected || working.scenes.length <= 1) return;
    const nextId = selected.nextSceneId;
    const scenes = working.scenes
      .filter((scene) => scene.id !== selected.id)
      .map((scene) =>
        scene.nextSceneId === selected.id ? { ...scene, nextSceneId: nextId } : scene,
      );
    const entrySceneId =
      working.entrySceneId === selected.id ? scenes[0]?.id : working.entrySceneId;
    setDraft({ ...working, scenes, entrySceneId, version: bumpVersion(working.version) });
    setSelectedId(scenes[0]?.id ?? null);
    setSaved(false);
  };

  /* ---------------------------------------------------------------- ④ 保存 */

  const save = () => {
    if (!working || areaIncomplete || drawingArea) return;
    if (saveAuthoredGame(working)) {
      // Point the app at this pack so 「立即试玩」 - and every screen after it -
      // loads the game the author just built instead of the bundled demo.
      markCurrentAuthoredGame(working.id);
      setDraft(working);
      setSaved(true);
    }
  };

  /**
   * 「立即试玩」 saves first, then navigates.
   *
   * Deliberately not a bare <Link>: an author who tunes a trigger radius and
   * immediately hits play expects those edits to be in the hunt. Saving here
   * makes that the only outcome, and marking the pack first guarantees the
   * /select screen resolves to it.
   */
  const play = () => {
    save();
    router.push("/select");
  };

  const loadBsopClassicTemplate = () => {
    const template = structuredClone(BSOP_CLASSIC_TEMPLATE);
    setDraft(template);
    setSelectedId(template.scenes[0]?.id ?? null);
    setSaved(false);
    setDrawingArea(false);
    setPlacingCircle(false);
    setAreaSnapshot(undefined);
  };

  const resetOfficial = () => {
    clearAuthoredGame(working.id);
    // Hand the title back to the bundled pack, otherwise /select would keep
    // resolving to a pack that no longer exists.
    clearActiveAuthoredGame();
    setDraft(null);
    setSaved(false);
    setDrawingArea(false);
    setPlacingCircle(false);
    setAreaSnapshot(undefined);
    void reloadContent(true);
  };

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(working, null, 2));
    setSaved(true);
  };

  return (
    <Screen
      title="创建游戏"
      subtitle="四步完成：画区域 → 放场景 → 设距离 → 保存"
      headerRight={<Link href="/" className="btn btn-ghost h-9 min-h-0 px-3">返回</Link>}
    >
      {/* ------------------------------------------------ 步骤导航 */}
      <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { n: "①", label: "画游戏区域", done: Boolean(area) && !areaIncomplete && !drawingArea },
          { n: "②", label: "放置场景", done: working.scenes.length > 0 && !drawingArea },
          { n: "③", label: "设置触发距离", done: working.scenes.every((s) => s.location.radius) },
          { n: "④", label: "保存游戏", done: saved },
        ].map((step) => (
          <li
            key={step.n}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold ${
              step.done
                ? "border-[var(--ok)] bg-[var(--ok)]/10 text-[var(--ok)]"
                : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"
            }`}
          >
            <span className="text-[14px]">{step.n}</span>
            <span className="truncate">{step.label}</span>
          </li>
        ))}
      </ol>

      <section className="card mb-4 overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-br from-[#15233d] via-[#243b5d] to-[#3f6a68] px-5 py-5 text-white">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">CLASSIC 01 · BSOP CAMPUS</p>
          <h2 className="mt-1.5 text-[21px] font-bold">《神学院的八个秘密》</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-white/75">把真实校园变成一条会留下记忆的路：探索 → 选择 → 行动 → 反思 → 带走。</p>
          <button type="button" className="mt-3 rounded-xl bg-white/95 px-4 py-2.5 text-[13px] font-bold text-[#15233d]" onClick={loadBsopClassicTemplate}>
            载入 BSOP 经典母版
          </button>
          <p className="mt-2 text-[10.5px] text-white/55">载入后请把 8 个场景拖到校园真实位置，再绘制游戏区域。</p>
        </div>
      </section>

      {/* ------------------------------------------------ 地图 */}
      <section className="card overflow-hidden">
        {/* `relative` is load-bearing: .map-root is position:absolute/inset:0
            (built for the full-screen /map page), so without a positioned
            ancestor here the map escapes this 46vh box, paints over the whole
            screen and swallows every click on the cards below. */}
        <div className="relative h-[46vh] min-h-[300px]">
          <MapView
            player={null}
            entries={entries}
            huntArea={working.huntArea}
            tileProvider={settings.tileProvider as TileProviderId}
            fitToHunt
            editable
            drawingMode={drawingArea}
            onMapClick={handleMapClick}
            onSceneDrag={(sceneId, lat, lng) => updateLocation(sceneId, lat, lng)}
          />
        </div>
        <div className="border-t border-[var(--line)] p-4 text-[12px] leading-relaxed">
          <p className="font-semibold">地图编辑</p>
          <p className="mt-1 text-[var(--muted)]">
            {drawingArea ? (
              <span className="font-semibold text-[var(--accent)]">
                请在地图上依次点击游戏区域的边界点
              </span>
            ) : placingCircle ? (
              <span className="font-semibold text-[var(--accent)]">
                点击地图上任意一点，作为圆形区域的中心
              </span>
            ) : (
              <>当前选中「{selected?.title ?? "地点"}」。直接拖动地点标记，或点击地图移动当前地点。</>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="chip bg-amber-100 text-amber-800">
              {isPolygon
                ? `自定义区域 · ${polygonPoints.length} 个边界点`
                : `圆形 · 半径 ${Math.round(area?.radiusMeters ?? 100)}m`}
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ ① 选择游戏区域 */}
      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold">① 选择游戏区域</p>
            <p className="text-[11.5px] text-[var(--muted)]">在地图上圈出游戏范围。不需要 GPS。</p>
          </div>
        </div>

        {drawingArea ? (
          <>
            <div className="mt-3 rounded-xl border border-dashed border-[var(--accent)] bg-[var(--surface)] p-3">
              <p className="text-[12px] font-semibold">请在地图上依次点击游戏区域的边界点</p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
                ●──────●<br />
                /&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\<br />
                ●&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;●<br />
                \&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/<br />
                ●──────●
              </p>
              <p className="mt-2 text-[13px] font-bold">已选择 {polygonPoints.length} 个点</p>
              <p className="text-[11.5px] text-[var(--muted)]">
                {polygonPoints.length < MIN_POLYGON_POINTS
                  ? `至少 ${MIN_POLYGON_POINTS} 个点才能完成。`
                  : "可以点「完成区域」闭合形状。"}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={finishPolygon}
                disabled={polygonPoints.length < MIN_POLYGON_POINTS}
              >
                完成区域
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={undoPolygonPoint}
                disabled={polygonPoints.length === 0}
              >
                撤销上一点
              </button>
              <button type="button" className="btn btn-ghost" onClick={restartPolygon}>
                重新绘制
              </button>
              <button type="button" className="btn btn-ghost" onClick={cancelPolygon}>
                取消
              </button>
            </div>
          </>
        ) : placingCircle ? (
          <>
            <div className="mt-3 rounded-xl border border-dashed border-[var(--accent)] bg-[var(--surface)] p-3">
              <p className="text-[12px] font-semibold">点击地图设置圆心</p>
              <p className="mt-1 text-[11.5px] text-[var(--muted)]">
                定好圆心后，用半径滑块调整范围。
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost mt-2 w-full"
              onClick={() => setPlacingCircle(false)}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn btn-primary h-auto min-h-14 flex-col gap-0.5 py-2"
                onClick={startPolygon}
              >
                <span className="text-[16px] leading-none">⬡</span>
                <span className="text-[12px] font-bold">自定义绘制</span>
                <span className="text-[10.5px] font-normal opacity-80">不规则区域 · 推荐</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary h-auto min-h-14 flex-col gap-0.5 py-2"
                onClick={startCirclePlacement}
              >
                <span className="text-[16px] leading-none">⭕</span>
                <span className="text-[12px] font-bold">圆形区域</span>
                <span className="text-[10.5px] font-normal opacity-70">中心 + 半径</span>
              </button>
            </div>

            {isPolygon ? (
              <div className="mt-3 rounded-xl bg-[var(--surface)] p-3">
                <p className="text-[12px] font-semibold">
                  当前区域：自定义多边形（{polygonPoints.length} 个顶点）
                </p>
                <p className="mt-1 text-[11.5px] text-[var(--muted)]">
                  外接半径约 {Math.round(area?.radiusMeters ?? 0)}m。想调整就重新绘制一次。
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="text-xs font-semibold underline" onClick={startPolygon}>
                    重新绘制
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-red-700 underline"
                    onClick={clearPolygon}
                  >
                    清除区域
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold">区域半径</label>
                  <span className="tabular text-xs font-bold">
                    {Math.round(area?.radiusMeters ?? 100)} m
                  </span>
                </div>
                <input
                  className="mt-2 w-full accent-[var(--accent)]"
                  type="range"
                  min={30}
                  max={500}
                  step={5}
                  value={area?.radiusMeters ?? 100}
                  onChange={(e) => setHuntAreaRadius(Number(e.target.value))}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {MICRO_PRESETS.map((radius) => (
                    <button
                      key={radius}
                      type="button"
                      className={`chip ${Math.round(area?.radiusMeters ?? 100) === radius ? "bg-[var(--accent)] text-[#3a2400]" : "bg-[var(--surface)]"}`}
                      onClick={() => setHuntAreaRadius(radius)}
                    >
                      {radius}m
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-[11.5px] text-[var(--muted)]">
              50–100m 就可以做非常小的游戏。实际 GPS 触发圈建议保持 15–30m。
            </p>
          </>
        )}
      </section>

      {/* ------------------------------------------------ ② 放置场景 */}
      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold">② 放置场景</p>
            <p className="text-[11.5px] text-[var(--muted)]">
              增加场景，拖动标记或点击地图放置。先到现场，再解锁任务。
            </p>
          </div>
          <button type="button" className="btn btn-secondary h-9 min-h-0 px-3 text-xs" onClick={addScene}>＋增加场景</button>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {working.scenes.map((scene, i) => (
            <button
              key={scene.id}
              type="button"
              className={`chip shrink-0 ${scene.id === selected?.id ? "bg-[var(--accent)] text-[#3a2400]" : "bg-[var(--surface)]"}`}
              onClick={() => setSelectedId(scene.id)}
            >
              {i + 1}. {scene.title}
            </button>
          ))}
        </div>

        {selected ? (
          <div className="mt-4">
            {selectedOutsideArea ? (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-800">
                提示：「{selected.title}」落在游戏区域之外。把它拖进区域内，或重新绘制区域。
              </p>
            ) : null}

            <label className="block text-xs font-semibold">场景名称<input className="input mt-1" value={selected.title} onChange={(e) => updateScene(selected.id, { title: e.target.value })} /></label>
            <label className="mt-3 block text-xs font-semibold">现场名称<input className="input mt-1" value={selected.location.name ?? ""} onChange={(e) => updateScene(selected.id, { location: { ...selected.location, name: e.target.value } })} /></label>
            <label className="mt-3 block text-xs font-semibold">到达后故事<textarea className="input mt-1 min-h-28" value={selected.story} onChange={(e) => updateScene(selected.id, { story: e.target.value })} /></label>
            <label className="mt-3 block text-xs font-semibold">到达提示<textarea className="input mt-1 min-h-20" value={selected.briefing ?? ""} onChange={(e) => updateScene(selected.id, { briefing: e.target.value })} /></label>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">纬度<input className="input mt-1" inputMode="decimal" value={selected.location.lat} onChange={(e) => updateLocation(selected.id, Number(e.target.value), selected.location.lng)} /></label>
              <label className="text-xs font-semibold">经度<input className="input mt-1" inputMode="decimal" value={selected.location.lng} onChange={(e) => updateLocation(selected.id, selected.location.lat, Number(e.target.value))} /></label>
            </div>

            <div className="mt-4 rounded-xl bg-[var(--surface)] p-3">
              <p className="text-xs font-semibold">挑战</p>
              <label className="mt-2 block text-xs">问题<textarea className="input mt-1 min-h-16" value={selected.challenge?.question ?? ""} onChange={(e) => updateScene(selected.id, { challenge: selected.challenge ? { ...selected.challenge, question: e.target.value } : undefined })} /></label>
              {selected.challenge?.type === "choice" ? (
                <>
                  <div className="mt-2 grid gap-2">
                    {(selected.challenge.options ?? []).map((option, i) => (
                      <input key={i} className="input" value={option} onChange={(e) => {
                        const options = [...(selected.challenge?.options ?? [])];
                        options[i] = e.target.value;
                        updateScene(selected.id, { challenge: { ...selected.challenge!, options } });
                      }} />
                    ))}
                  </div>
                  {selected.challenge?.reflective ? (
                    <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
                      这是<strong>反思型选择</strong>：没有标准答案，玩家做出真实选择即可完成，不用于排名或考试。
                    </div>
                  ) : (
                    <label className="mt-2 block text-xs">正确答案<input className="input mt-1" type="number" min={0} max={Math.max(0, (selected.challenge.options?.length ?? 1) - 1)} value={typeof selected.challenge.answer === "number" ? selected.challenge.answer : 0} onChange={(e) => updateScene(selected.id, { challenge: { ...selected.challenge!, answer: Number(e.target.value) } })} /></label>
                  )}
                </>
              ) : null}
              <label className="mt-2 block text-xs">答案说明<textarea className="input mt-1 min-h-16" value={selected.challenge?.explanation ?? ""} onChange={(e) => updateScene(selected.id, { challenge: selected.challenge ? { ...selected.challenge, explanation: e.target.value } : undefined })} /></label>
            </div>

            <div className="mt-4 rounded-xl bg-[var(--surface)] p-3">
              <p className="text-xs font-semibold">奖励</p>
              <label className="mt-2 block text-xs">奖励名称<input className="input mt-1" value={selected.reward?.title ?? ""} onChange={(e) => updateScene(selected.id, { reward: selected.reward ? { ...selected.reward, title: e.target.value } : { type: "keyword", title: e.target.value, value: e.target.value } })} /></label>
              <label className="mt-2 block text-xs">奖励内容<input className="input mt-1" value={selected.reward?.value ?? ""} onChange={(e) => updateScene(selected.id, { reward: selected.reward ? { ...selected.reward, value: e.target.value } : undefined })} /></label>
            </div>

            <button type="button" className="mt-4 text-xs font-semibold text-red-700 underline" onClick={deleteSelected} disabled={working.scenes.length <= 1}>
              删除这个场景
            </button>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------ ③ 设置触发距离 */}
      <section className="card mt-4 p-4">
        <p className="text-[15px] font-bold">③ 设置触发距离</p>
        <p className="mt-1 text-[11.5px] text-[var(--muted)]">
          每个场景的解锁半径。15–30m 在真实 GPS 误差下最稳。
        </p>

        <div className="mt-3 grid gap-3">
          {working.scenes.map((scene, i) => {
            const radius = scene.location.radius ?? 15;
            return (
              <div key={scene.id} className="rounded-xl bg-[var(--surface)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className={`text-left text-[12px] font-semibold ${scene.id === selected?.id ? "text-[var(--accent)]" : ""}`}
                    onClick={() => setSelectedId(scene.id)}
                  >
                    {i + 1}. {scene.title}
                  </button>
                  <span className="tabular text-xs font-bold">{radius} m</span>
                </div>
                <input
                  className="mt-2 w-full accent-[var(--accent)]"
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={radius}
                  onChange={(e) =>
                    updateScene(scene.id, { location: { ...scene.location, radius: Number(e.target.value) } })
                  }
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------ ④ 保存游戏 */}
      <section className="card mt-4 p-4">
        <p className="text-[15px] font-bold">④ 保存游戏</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
          保存后，这台设备会把你的游戏作为本地创作版本。没有账号也能立即试玩；未来接入云端发布时，这个编辑器仍可作为内容制作入口。
        </p>
        {areaIncomplete ? (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-800">
            游戏区域还没有画完（至少 {MIN_POLYGON_POINTS} 个边界点），完成或取消绘制后才能保存。
          </p>
        ) : null}
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={play}
          >
            {saved ? "✓ 已保存，立即试玩" : "保存并立即试玩"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={save}
            disabled={areaIncomplete || drawingArea}
          >
            {saved ? "✓ 已保存到本机" : "仅保存到本机"}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={copyJson}>复制游戏 JSON</button>
          <button type="button" className="btn btn-ghost btn-block text-red-700" onClick={resetOfficial}>恢复官方示范内容</button>
        </div>
      </section>
    </Screen>
  );
}

function bumpVersion(version: string): string {
  const match = version.match(/^(.*?)(\d+)\.?(\d+)?$/);
  if (!match) return version;
  return `${match[1]}${match[2]}.${Number(match[3] ?? 0) + 1}`;
}
