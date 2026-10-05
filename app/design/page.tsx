"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapView } from "@/components/map-view";
import { useSettings } from "@/components/providers";
import { Screen } from "@/components/ui";
import { clearAuthoredGame, saveAuthoredGame } from "@/lib/content";
import type { Game, Scene } from "@/lib/game/types";
import type { MapSceneEntry } from "@/components/game-map";
import type { TileProviderId } from "@/lib/map/tiles";
import { useHunt } from "@/components/hunt-provider";

const MICRO_PRESETS = [30, 50, 75, 100, 150, 250];

export default function DesignPage() {
  const { game, loading, loadError, reloadContent } = useHunt();
  const { settings } = useSettings();
  const [draft, setDraft] = useState<Game | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      location: { lat: base.lat, lng: base.lng, radius: 20, name: "新地点" },
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

  const setSelectedLocationFromMap = (lat: number, lng: number) => {
    if (!selected) return;
    updateLocation(selected.id, lat, lng);
  };

  const setAreaCenterFromMap = (lat: number, lng: number) => {
    update({ huntArea: { ...(working.huntArea ?? { radiusMeters: 100 }), center: { lat, lng }, name: working.huntArea?.name ?? "微型探索区" } });
  };

  const save = () => {
    if (!working) return;
    if (saveAuthoredGame(working)) {
      setDraft(working);
      setSaved(true);
    }
  };

  const resetOfficial = () => {
    clearAuthoredGame(working.id);
    setDraft(null);
    setSaved(false);
    void reloadContent(true);
  };

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(working, null, 2));
    setSaved(true);
  };

  return (
    <Screen
      title="创建游戏"
      subtitle="地图、范围、地点与内容都可以直接编辑"
      headerRight={<Link href="/" className="btn btn-ghost h-9 min-h-0 px-3">返回</Link>}
    >
      <section className="card overflow-hidden">
        <div className="h-[46vh] min-h-[300px]">
          <MapView
            player={null}
            entries={entries}
            huntArea={working.huntArea}
            tileProvider={settings.tileProvider as TileProviderId}
            fitToHunt
            editable
            onMapClick={setSelectedLocationFromMap}
            onSceneDrag={(sceneId, lat, lng) => updateLocation(sceneId, lat, lng)}
          />
        </div>
        <div className="border-t border-[var(--line)] p-4 text-[12px] leading-relaxed">
          <p className="font-semibold">地图编辑</p>
          <p className="mt-1 text-[var(--muted)]">
            当前选中「{selected?.title ?? "地点"}」。直接拖动地图上的地点标记，或点击地图把当前地点放到那里。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-secondary h-9 min-h-0 px-3 text-xs" onClick={() => setAreaCenterFromMap(selected?.location.lat ?? working.startLocation.lat, selected?.location.lng ?? working.startLocation.lng)}>
              用当前地点作区域中心
            </button>
            <span className="chip bg-amber-100 text-amber-800">
              区域半径 {Math.round(working.huntArea?.radiusMeters ?? 100)}m · 直径约 {Math.round((working.huntArea?.radiusMeters ?? 100) * 2)}m
            </span>
          </div>
        </div>
      </section>

      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold">① 游戏基本信息</p>
            <p className="text-[11.5px] text-[var(--muted)]">先定义“玩什么”。</p>
          </div>
          <span className="chip bg-slate-100 text-slate-600">Micro Designer</span>
        </div>

        <label className="mt-4 block text-xs font-semibold">游戏名称<input className="input mt-1" value={working.title} onChange={(e) => update({ title: e.target.value })} /></label>
        <label className="mt-3 block text-xs font-semibold">游戏说明<textarea className="input mt-1 min-h-20" value={working.description} onChange={(e) => update({ description: e.target.value })} /></label>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold">游戏范围</label>
            <span className="tabular text-xs font-bold">{Math.round(working.huntArea?.radiusMeters ?? 100)} m</span>
          </div>
          <input
            className="mt-2 w-full accent-[var(--accent)]"
            type="range"
            min={30}
            max={500}
            step={5}
            value={working.huntArea?.radiusMeters ?? 100}
            onChange={(e) =>
              update({
                huntArea: {
                  ...(working.huntArea ?? { center: working.startLocation, radiusMeters: 100 }),
                  radiusMeters: Number(e.target.value),
                },
              })
            }
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MICRO_PRESETS.map((radius) => (
              <button
                key={radius}
                type="button"
                className={`chip ${Math.round(working.huntArea?.radiusMeters ?? 100) === radius ? "bg-[var(--accent)] text-[#3a2400]" : "bg-[var(--surface)]"}`}
                onClick={() =>
                  update({
                    huntArea: {
                      ...(working.huntArea ?? { center: working.startLocation, radiusMeters: 100 }),
                      radiusMeters: radius,
                    },
                  })
                }
              >
                {radius}m
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--muted)]">
            50–100m 就可以做非常小的游戏。实际 GPS 触发圈仍建议保持 15–30m。
          </p>
        </div>
      </section>

      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold">② 地点与内容</p>
            <p className="text-[11.5px] text-[var(--muted)]">选择一个地点，然后直接改它。</p>
          </div>
          <button type="button" className="btn btn-secondary h-9 min-h-0 px-3 text-xs" onClick={addScene}>＋增加地点</button>
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
            <label className="block text-xs font-semibold">地点名称<input className="input mt-1" value={selected.title} onChange={(e) => updateScene(selected.id, { title: e.target.value })} /></label>
            <label className="mt-3 block text-xs font-semibold">现场名称<input className="input mt-1" value={selected.location.name ?? ""} onChange={(e) => updateScene(selected.id, { location: { ...selected.location, name: e.target.value } })} /></label>
            <label className="mt-3 block text-xs font-semibold">到达后故事<textarea className="input mt-1 min-h-28" value={selected.story} onChange={(e) => updateScene(selected.id, { story: e.target.value })} /></label>
            <label className="mt-3 block text-xs font-semibold">到达提示<textarea className="input mt-1 min-h-20" value={selected.briefing ?? ""} onChange={(e) => updateScene(selected.id, { briefing: e.target.value })} /></label>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">纬度<input className="input mt-1" inputMode="decimal" value={selected.location.lat} onChange={(e) => updateLocation(selected.id, Number(e.target.value), selected.location.lng)} /></label>
              <label className="text-xs font-semibold">经度<input className="input mt-1" inputMode="decimal" value={selected.location.lng} onChange={(e) => updateLocation(selected.id, selected.location.lat, Number(e.target.value))} /></label>
            </div>
            <label className="mt-3 block text-xs font-semibold">触发半径：{selected.location.radius ?? 50}m<input className="mt-2 w-full accent-[var(--accent)]" type="range" min={10} max={100} step={5} value={selected.location.radius ?? 50} onChange={(e) => updateScene(selected.id, { location: { ...selected.location, radius: Number(e.target.value) } })} /></label>

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
                  <label className="mt-2 block text-xs">正确答案<input className="input mt-1" type="number" min={0} max={Math.max(0, (selected.challenge.options?.length ?? 1) - 1)} value={typeof selected.challenge.answer === "number" ? selected.challenge.answer : 0} onChange={(e) => updateScene(selected.id, { challenge: { ...selected.challenge!, answer: Number(e.target.value) } })} /></label>
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
              删除这个地点
            </button>
          </div>
        ) : null}
      </section>

      <section className="card mt-4 p-4">
        <p className="text-[15px] font-bold">③ 保存并试玩</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
          保存后，这台设备会把你的游戏作为本地创作版本。没有账号也能立即试玩；未来接入云端发布时，这个编辑器仍可作为内容制作入口。
        </p>
        <div className="mt-3 grid gap-2">
          <button type="button" className="btn btn-primary btn-block" onClick={save}>{saved ? "✓ 已保存到本机" : "保存我的游戏"}</button>
          <Link href="/select" className="btn btn-secondary btn-block">立即试玩</Link>
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
