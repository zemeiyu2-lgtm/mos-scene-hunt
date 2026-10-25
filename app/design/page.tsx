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

import { useMemo, useRef, useState, useEffect } from "react";
import { GameQr } from "@/components/game-qr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapView } from "@/components/map-view";
import { useSettings } from "@/components/providers";
import { Screen } from "@/components/ui";
import {
  clearActiveAuthoredGame,
  clearAuthoredGame,
  DEFAULT_GAME_ID,
  HUNT_MANIFEST,
  listAuthoredGameIds,
  markCurrentAuthoredGame,
  saveAuthoredGameChecked,
  importGamePackageChecked,
  readAuthoredGame,
} from "@/lib/content";
import type { Game, HuntArea, Scene } from "@/lib/game/types";
import {
  addChoiceOption,
  answerLines,
  CHALLENGE_TYPE_LABEL,
  changeChallengeType,
  createChallenge,
  MAX_CHOICE_OPTIONS,
  MIN_CHOICE_OPTIONS,
  removeChoiceOption,
  setChoiceOption,
  setCorrectOption,
  withAnswerLines,
} from "@/lib/game/challenge-edit";
import { RIZAL_PARK_TEMPLATE } from "@/lib/game/templates";
import {
  isPointInPolygon,
  polygonBoundingRadius,
  polygonCentroid,
} from "@/lib/location";
import type { MapSceneEntry } from "@/components/game-map";
import type { TileProviderId } from "@/lib/map/tiles";
import { useHunt } from "@/components/hunt-provider";
import { createGameShareUrl, createPublishedGameUrl } from "@/lib/content/share";
import { MediaEditor } from "@/components/media-gallery";
import { exportGameJson, summarizeSpatial, validateGamePackage } from "@/lib/game/package";
import { describeSaveErrors, type SaveFailureText } from "@/lib/game/save-errors";
import { pickDesignGame } from "./design-target";
import { createBlankGame, nextBlankGameId } from "./design-game";

const MICRO_PRESETS = [30, 50, 75, 100, 150, 250];
const MIN_POLYGON_POINTS = 3;

export default function DesignPage() {
  const router = useRouter();
  const { game, loading, loadError, reloadContent } = useHunt();
  const { settings } = useSettings();
  const [draft, setDraft] = useState<Game | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Set when a save is refused because the pack would not survive a reload.
  // Cleared on the next successful save so a stale banner never misleads.
  const [saveFailure, setSaveFailure] = useState<SaveFailureText | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  // ① area-drawing session. While active, map clicks append boundary points.
  const [drawingArea, setDrawingArea] = useState(false);
  // One-shot circle placement: the next map click sets the area centre.
  const [placingCircle, setPlacingCircle] = useState(false);
  // JSON import lives in a collapsed drawer: it is a power feature, not the
  // first thing an author needs on a phone screen.
  const [importOpen, setImportOpen] = useState(false);
  // What the area looked like before the current drawing session began, so
  // 「取消」 can restore it instead of destroying the designer's work.
  const [areaSnapshot, setAreaSnapshot] = useState<HuntArea | undefined>(undefined);
  // 「新建空白游戏」 guard: when the draft has unsaved edits we ask first instead
  // of silently replacing them (save / discard / cancel).
  const [pendingBlank, setPendingBlank] = useState(false);
  const [blankMessage, setBlankMessage] = useState<string | null>(null);
  // The intro is secondary to the map, so it stays collapsed until asked for.
  const [infoOpen, setInfoOpen] = useState(false);
  // 问题 4：地图视野归设计者所有。只有显式「重置视野」才重新取景；选站、
  // 拖动标记、开关面板都不会再自动重置缩放。
  const [fitToken, setFitToken] = useState(0);

  // 「继续设计」 deep link from the games centre (/design?game=<id>). Without
  // this the designer would land on whatever pack happens to be active - often
  // the bundled demo - and could silently edit and save over the wrong game.
  // Runs once on mount; a missing or unknown id keeps the current behaviour.
  useEffect(() => {
    const target = pickDesignGame(window.location.search, readAuthoredGame);
    if (!target) return;
    setDraft(target);
    setSelectedId(target.scenes[0]?.id ?? null);
    // The draft is byte-identical to the stored pack, so it starts in the
    // saved state; any subsequent edit flips it back to unsaved.
    setSaved(true);
    setDrawingArea(false);
    setPlacingCircle(false);
    setAreaSnapshot(undefined);
  }, []);

  const working = draft ?? game;
  const selected = working?.scenes.find((scene) => scene.id === selectedId) ?? working?.scenes[0] ?? null;
  const challenge = selected?.challenge;
  /**
   * Edits exist only in the draft, so a fresh page showing the bundled or
   * active pack (`draft === null`) is not "unsaved" - it simply has nothing of
   * the author's yet.
   */
  const hasUnsavedEdits = Boolean(draft) && !saved;

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
  const polygonPoints = useMemo(
    () => (isPolygon ? area?.points ?? [] : []),
    [isPolygon, area?.points],
  );

  // A polygon still being drawn cannot be saved as a playable pack: the
  // validator requires at least three vertices.
  const areaIncomplete = isPolygon && polygonPoints.length < MIN_POLYGON_POINTS;
  const spatial = useMemo(() => (working ? summarizeSpatial(working) : null), [working]);
  const packageReport = useMemo(() => (working ? validateGamePackage(working) : null), [working]);
  const spatialWarnings = packageReport?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const spatialErrors = packageReport?.issues.filter((issue) => issue.severity === "error") ?? [];

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
      <Screen title="创作中心">
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

  const moveScene = (sceneId: string, direction: -1 | 1) => {
    const index = working.scenes.findIndex((scene) => scene.id === sceneId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= working.scenes.length) return;
    const scenes = [...working.scenes];
    [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
    for (let i = 0; i < scenes.length; i++) scenes[i] = { ...scenes[i], nextSceneId: i < scenes.length - 1 ? scenes[i + 1].id : null };
    setDraft({ ...working, scenes, entrySceneId: scenes[0]?.id, version: bumpVersion(working.version) });
    setSelectedId(sceneId);
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

  /** Pre-flight checks shared by both share paths (self-contained, online). */
  const ensureShareable = (): Game => {
    if (!working) throw new Error("游戏尚未加载");
    if (!packageReport?.canPlaytest) {
      const firstError = packageReport?.issues.find((issue) => issue.severity === "error");
      throw new Error(firstError ? `请先修复游戏问题：${firstError.message}` : "请先完成游戏校验");
    }
    const configured = (point: { lat: number; lng: number } | undefined) =>
      Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && !(point.lat === 0 && point.lng === 0));
    const missing: string[] = [];
    if (!configured(working.startLocation)) missing.push("真实起点");
    if (!working.huntArea) {
      missing.push("游戏区域");
    } else if (working.huntArea.shape === "polygon") {
      if ((working.huntArea.points?.length ?? 0) < MIN_POLYGON_POINTS) missing.push("完整的游戏区域边界");
      else if (working.huntArea.points?.some((point) => !configured(point))) missing.push("游戏区域边界上的真实坐标");
    } else if (!configured(working.huntArea.center)) {
      missing.push("游戏区域中心");
    }
    if (working.scenes.some((scene) => !configured(scene.location))) missing.push("所有站点的真实 GPS 坐标");
    if (missing.length) throw new Error("暂不能发布，请先设置：" + [...new Set(missing)].join("、") + "。0,0 是占位值，不是真实地点。");
    if (!save()) throw new Error("游戏未能保存到本机，请先修正下方提示的问题后再发布。");
    return working;
  };

  const share = async () => {
    if (!working || areaIncomplete || drawingArea) return;
    setShareBusy(true);
    setShareMessage(null);
    setShareUrl(null);
    try {
      const game = ensureShareable();
      const url = await createGameShareUrl(game);
      setShareUrl(url);
      if (navigator.share) {
        try {
          await navigator.share({ title: working.title, text: "邀请你来玩：" + working.title, url });
          setShareMessage("已打开系统分享面板；也可以在下方展示二维码或下载二维码图片。");
        } catch (error) {
          // 区分「用户取消」和「分享面板真的失败」：两者都曾静默吞掉，
          // 让作者以为分享成功或按钮失灵。取消不算失败，面板失败则回退到
          // 链接 + 二维码，它们本来就已生成。
          if (error instanceof DOMException && error.name === "AbortError") {
            setShareMessage("已取消系统分享；链接和二维码仍然可用，可复制链接或截图二维码发给朋友。");
          } else {
            setShareMessage(
              `系统分享未完成（${error instanceof Error ? error.message : "未知原因"}）；请复制链接或使用下方二维码发送。`,
            );
          }
        }
      } else {
        try {
          await navigator.clipboard.writeText(url);
          setShareMessage("分享链接已复制；也可以在下方展示二维码或下载二维码图片。");
        } catch {
          setShareMessage("分享链接已生成，请复制链接或使用下方二维码。");
        }
      }
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "生成分享链接失败");
    } finally {
      setShareBusy(false);
    }
  };

  /**
   * Publish the game to the server and share the short hosted link. The pack
   * is validated again server-side; identical re-publishes are idempotent and
   * every version gets an immutable versionId. The resulting short URL goes
   * through the same link/QR/share UI as the self-contained link.
   */
  const publishOnline = async () => {
    if (!working || areaIncomplete || drawingArea) return;
    setShareBusy(true);
    setShareMessage(null);
    setShareUrl(null);
    try {
      const game = ensureShareable();
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(game),
      });
      const body = (await response.json().catch(() => null)) as
        | { gameId?: string; versionId?: string; created?: boolean; playPath?: string; message?: string; detail?: string }
        | null;
      if (!response.ok || !body?.playPath) {
        throw new Error(body?.detail || body?.message || `发布失败（HTTP ${response.status}）`);
      }
      const url = createPublishedGameUrl(body.gameId!, body.versionId!);
      setShareUrl(url);
      setShareMessage(
        body.created
          ? `已发布到线上（版本 ${body.versionId}）。链接和二维码已生成，可复制或扫码分享。`
          : `内容未变化，线上已是该版本（${body.versionId}），无需重复发布。`,
      );
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "发布到线上失败");
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage("分享链接已复制，可以发给微信好友或群。");
    } catch {
      setShareMessage("复制失败；请长按或选择下方链接复制。");
    }
  };

  // 社交分享入口（来自 PR #68 c187447）：微信复制粘贴、Facebook/Viber 跳转、
  // 系统分享面板。二维码渲染与 PNG 下载由 GameQr 组件统一处理。
  const shareToPlatform = async (platform: "wechat" | "viber" | "facebook" | "system") => {
    if (!shareUrl) return;
    const title = working?.title || "MOS Scene Hunt";
    const message = "邀请你来玩：" + title + "\n" + shareUrl;
    try {
      if (platform === "wechat") {
        await navigator.clipboard.writeText(message);
        setShareMessage("游戏链接和邀请文字已复制。请打开微信，进入朋友或群聊后粘贴发送；网页不能直接替你选择微信联系人。");
        return;
      }
      if (platform === "facebook") {
        const target = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(shareUrl);
        window.open(target, "_blank", "noopener,noreferrer");
        setShareMessage("已打开 Facebook 分享页面。发布前请确认分享内容中保留完整游戏链接。");
        return;
      }
      if (platform === "viber") {
        const target = "viber://forward?text=" + encodeURIComponent(message);
        window.location.href = target;
        setShareMessage("已尝试打开 Viber。如果没有打开，请复制下方链接并粘贴到 Viber 对话中。");
        return;
      }
      if (navigator.share) {
        await navigator.share({ title, text: "邀请你来玩：" + title, url: shareUrl });
        setShareMessage("系统分享面板已打开。请选择微信、Viber、Facebook 或其他应用。");
      } else {
        await navigator.clipboard.writeText(message);
        setShareMessage("此浏览器不支持系统分享，游戏链接和邀请文字已复制。");
      }
    } catch {
      setShareMessage("未能直接打开该应用。请复制下方链接，再在对应应用中粘贴发送。");
    }
  };

  const importPackageText = (text: string) => {
    const outcome = importGamePackageChecked(text);
    if (outcome.status === "error") {
      setImportMessage(outcome.message);
      return;
    }
    if (outcome.status === "conflict") {
      // 同 ID 不同内容：绝不覆盖本机游戏，编辑器中的当前草稿也保持原样。
      setImportMessage(
        `本机已有一个同 ID（${outcome.game.id}）但内容不同的游戏，为避免覆盖你的游戏和进度，未导入。` +
          "如需导入这份包，请先修改包内的游戏 ID，或确认后删除本机同名游戏再试。",
      );
      return;
    }
    const game = outcome.game;
    setDraft(game);
    setSelectedId(game.scenes[0]?.id ?? null);
    setSaved(true);
    setDrawingArea(false);
    setPlacingCircle(false);
    setAreaSnapshot(undefined);
    setShareUrl(null);
    setShareMessage(null);
    if (outcome.status === "already-exists") {
      // 内容完全相同：不重复写入，但把已存版本载入编辑器继续编辑是安全的。
      setImportMessage(`本机已有内容相同的「${game.title}」，未重复写入；已载入编辑器。`);
      return;
    }
    const warningCount = outcome.issues.filter((issue) => issue.severity === "warning").length;
    setImportMessage(warningCount
      ? `已导入「${game.title}」，发现 ${warningCount} 项提醒。请在地图上核对真实坐标与安全路线。`
      : `已导入「${game.title}」，已保存到本机游戏库。`);
  };

  const importPackageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    importPackageText(await file.text());
  };

  const save = (): boolean => {
    if (!working || areaIncomplete || drawingArea) return false;
    const result = saveAuthoredGameChecked(working);
    if (!result.ok) {
      // Refused before the write: the previous valid save (if any) is intact.
      setSaveFailure(describeSaveErrors(result.errors));
      return false;
    }
    setSaveFailure(null);
    // Point the app at this pack so 「立即试玩」 - and every screen after it -
    // loads the game the author just built instead of the bundled demo.
    markCurrentAuthoredGame(working.id);
    setDraft(working);
    setSaved(true);
    return true;
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
    if (save()) router.push("/select");
  };

  const loadOfficialTemplate = () => {
    const template = structuredClone(RIZAL_PARK_TEMPLATE);
    setDraft(template);
    setSelectedId(template.scenes[0]?.id ?? null);
    setSaved(false);
    setDrawingArea(false);
    setPlacingCircle(false);
    setAreaSnapshot(undefined);
  };

  /* ------------------------------------------------ 新建空白游戏 */

  /**
   * Replace the draft with a brand-new pack.
   *
   * The id is allocated against every stored slot (not just the ones that
   * currently validate) plus the bundled pack ids, so a blank game can never
   * land on top of an existing game or the demo. Nothing is written to storage
   * here - the author still has to press 保存, exactly like the template flow.
   */
  const startBlankGame = () => {
    const reserved = [
      ...listAuthoredGameIds(),
      DEFAULT_GAME_ID,
      ...HUNT_MANIFEST.map((entry) => entry.id),
    ];
    const id = nextBlankGameId(reserved);
    const blank = createBlankGame({ id, startLocation: working.startLocation });
    setDraft(blank);
    setSelectedId(blank.scenes[0]?.id ?? null);
    setSaved(false);
    setDrawingArea(false);
    setPlacingCircle(false);
    setAreaSnapshot(undefined);
    setShareUrl(null);
    setShareMessage(null);
    setImportMessage(null);
    setPendingBlank(false);
    setBlankMessage(
      `已新建空白游戏「${blank.title}」（ID：${blank.id}）。点「仅保存到本机」后才会出现在游戏中心。`,
    );
  };

  const requestBlankGame = () => {
    setBlankMessage(null);
    if (drawingArea || areaIncomplete) {
      setBlankMessage("游戏区域还没画完，请先「完成区域」或「取消」绘制，再新建游戏。");
      return;
    }
    if (hasUnsavedEdits) {
      setPendingBlank(true);
      return;
    }
    startBlankGame();
  };

  const saveThenBlank = () => {
    if (!save()) {
      setBlankMessage("当前游戏保存失败，请检查浏览器存储空间后重试。");
      return;
    }
    startBlankGame();
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
    await navigator.clipboard.writeText(exportGameJson(working));
    setSaved(true);
  };

  const exportPackage = () => {
    const report = validateGamePackage(working);
    if (!report.game || report.issues.some((issue) => issue.severity === "error")) return;
    const blob = new Blob([exportGameJson(report.game)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${working.id}.json`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Screen
      title="创作中心"
      headerRight={<div className="flex items-center gap-1"><Link href="/how-to-create" className="btn btn-ghost h-9 min-h-0 px-2 text-xs">创作说明</Link><Link href="/" className="btn btn-ghost h-9 min-h-0 px-2 text-xs">返回</Link></div>}
    >
      <section id="package-import" className="card mb-4 scroll-mt-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
          onClick={() => setImportOpen((open) => !open)}
          aria-expanded={importOpen}
        >
          <span className="min-w-0">
            <span className="block font-bold">导入游戏包</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">粘贴或选择 AI 生成的 MOS Scene Hunt JSON 文件</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-[var(--muted)] transition-transform">{importOpen ? "▾" : "▸"}</span>
        </button>
        {importOpen ? (
          <div className="border-t border-[var(--line)] p-4 pt-3">
            <input ref={importInputRef} type="file" accept=".json,application/json" className="sr-only" onChange={(event) => void importPackageFile(event)} />
            <button type="button" className="btn btn-secondary w-full" onClick={() => importInputRef.current?.click()}>选择 JSON 游戏包</button>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'把 AI 输出的完整 JSON 粘贴到这里……\n标准格式包含 format、formatVersion 和 game。'}
              className="mt-3 min-h-[140px] w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
              spellCheck={false}
              aria-label="粘贴 AI 生成的 JSON 游戏包"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-primary" onClick={() => importPackageText(importText)} disabled={!importText.trim()}>校验并导入</button>
              <button type="button" className="btn btn-ghost" onClick={() => setImportText("")}>清空文本</button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              导入后请先在地图上核对坐标，再现场试玩。格式详情见
              <Link href="/how-to-create" className="mx-1 font-semibold text-[var(--accent)] underline">创作说明</Link>。
            </p>
            {importMessage ? <p role="status" className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed">{importMessage}</p> : null}
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------ 当前游戏 / 新建 */}
      <section className="card mb-4 p-3">
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold">游戏名称</span>
            <input className="input" value={working.title} onChange={(e) => update({ title: e.target.value })} />
          </label>
          <button
            type="button"
            className="btn btn-secondary h-10 min-h-0 shrink-0 px-3 text-xs"
            onClick={requestBlankGame}
          >
            ＋ 新建空白游戏
          </button>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[var(--muted)]">
          <span>
            存档 ID：<span className="font-mono">{working.id}</span>
          </span>
          <button
            type="button"
            className="font-semibold underline"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
          >
            简介
          </button>
          {hasUnsavedEdits ? <span className="font-semibold text-amber-700">· 有未保存的修改</span> : null}
        </p>
        {infoOpen ? (
          <label className="mt-2 block text-xs font-semibold">
            简介
            <textarea className="input mt-1 min-h-16" value={working.description} onChange={(e) => update({ description: e.target.value })} />
          </label>
        ) : null}

        {pendingBlank ? (
          <div role="alertdialog" aria-label="当前游戏有未保存的修改" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-[12px] font-bold text-amber-900">当前游戏还有未保存的修改</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-amber-900">
              新建会切换到一款空白游戏。请选择如何处理这些修改。
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button type="button" className="btn btn-primary h-9 min-h-0 px-2 text-[11px]" onClick={saveThenBlank}>
                保存并新建
              </button>
              <button type="button" className="btn btn-secondary h-9 min-h-0 px-2 text-[11px]" onClick={startBlankGame}>
                放弃修改
              </button>
              <button
                type="button"
                className="btn btn-ghost h-9 min-h-0 px-2 text-[11px]"
                onClick={() => {
                  setPendingBlank(false);
                  setBlankMessage(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        {blankMessage ? (
          <p role="status" className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2 text-[11.5px] leading-relaxed">
            {blankMessage}
          </p>
        ) : null}
      </section>

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

      {/* ------------------------------------------------ 地图（主要工作区） */}
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
            mapCenter={working.startLocation}
            tileProvider={settings.tileProvider as TileProviderId}
            fitToHunt
            fitToken={fitToken}
            editable
            drawingMode={drawingArea}
            onMapClick={handleMapClick}
            onSceneSelect={(sceneId) => setSelectedId(sceneId)}
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
              <>点击地图标记可选中对应站点；拖动标记可调整位置。点击地图空白处，则移动当前选中站点。</>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="chip bg-amber-100 text-amber-800">
              {isPolygon
                ? `自定义区域 · ${polygonPoints.length} 个边界点`
                : `圆形 · 半径 ${Math.round(area?.radiusMeters ?? 100)}m`}
            </span>
            <button
              type="button"
              className="chip bg-[var(--surface)] text-[var(--muted)]"
              onClick={() => setFitToken((t) => t + 1)}
              title="把所有站点和游戏区域重新收进画面"
            >
              ⌖ 重置视野
            </button>
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
                      className={`chip ${Math.round(area?.radiusMeters ?? 100) === radius ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-[var(--surface)]"}`}
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

      {/* ------------------------------------------------ 官方模板（紧凑入口） */}
      <section className="card mt-4 flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">官方母版：黎刹公园 · 寻找最后的宝藏</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">五站示范流程，载入后请核对坐标并现场试玩。</p>
        </div>
        <button type="button" className="btn btn-secondary h-9 min-h-0 shrink-0 px-3 text-xs" onClick={loadOfficialTemplate}>
          载入母版
        </button>
      </section>

      {/* ------------------------------------------------ 空间摘要 */}
      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold">空间设计总览</p>
            <p className="mt-1 text-[11.5px] text-[var(--muted)]">地图决定玩家在哪里经历故事；系统只提示问题，不替你改点位。</p>
          </div>
          <span className="chip bg-[var(--surface)]">{working.scenes.length} 个体验点</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-[var(--surface)] p-3 text-center"><div className="tabular text-[17px] font-bold">{Math.round(spatial?.totalMeters ?? 0)}m</div><div className="text-[10.5px] text-[var(--muted)]">总路线</div></div>
          <div className="rounded-xl bg-[var(--surface)] p-3 text-center"><div className="tabular text-[17px] font-bold">{spatial?.walkingMinutes ?? 0}′</div><div className="text-[10.5px] text-[var(--muted)]">粗略步行</div></div>
          <div className="rounded-xl bg-[var(--surface)] p-3 text-center"><div className="tabular text-[17px] font-bold">{Math.round(area?.radiusMeters ?? 0)}m</div><div className="text-[10.5px] text-[var(--muted)]">区域尺度</div></div>
        </div>
        {working.scenes.length > 1 ? <div className="mt-3 overflow-x-auto pb-1"><div className="flex min-w-max items-center gap-1">{working.scenes.map((scene, i) => <span key={scene.id} className="flex items-center gap-1">{i > 0 ? <span className="text-[var(--muted)]">→</span> : null}<button type="button" className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${scene.id === selected?.id ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--line)]"}`} onClick={() => setSelectedId(scene.id)}>{i + 1}. {scene.title}</button></span>)}</div></div> : null}
        {(spatialWarnings.length || spatialErrors.length) ? <div className="mt-3 space-y-2">{[...spatialErrors, ...spatialWarnings].slice(0, 6).map((issue, i) => <div key={issue.path + i} className={`rounded-xl px-3 py-2 text-[11.5px] ${issue.severity === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}><strong>{issue.severity === "error" ? "需要修正：" : "空间提示："}</strong>{issue.message}</div>)}</div> : <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[11.5px] font-semibold text-emerald-800">空间检查通过，可以继续设计。</p>}
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
              className={`chip shrink-0 ${scene.id === selected?.id ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-[var(--surface)]"}`}
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

                        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-[var(--surface)] p-3"><div><p className="text-[11px] text-[var(--muted)]">路线顺序</p><p className="text-[13px] font-bold">第 {working.scenes.findIndex((s) => s.id === selected.id) + 1} / {working.scenes.length} 站</p></div><div className="flex gap-1"><button type="button" className="btn btn-ghost h-8 min-h-0 px-2 text-xs" disabled={working.scenes[0]?.id === selected.id} onClick={() => moveScene(selected.id, -1)}>← 上移</button><button type="button" className="btn btn-ghost h-8 min-h-0 px-2 text-xs" disabled={working.scenes[working.scenes.length - 1]?.id === selected.id} onClick={() => moveScene(selected.id, 1)}>下移 →</button></div></div>
            <label className="block text-xs font-semibold">场景名称<input className="input mt-1" value={selected.title} onChange={(e) => updateScene(selected.id, { title: e.target.value })} /></label>
            <label className="mt-3 block text-xs font-semibold">现场名称<input className="input mt-1" value={selected.location.name ?? ""} onChange={(e) => updateScene(selected.id, { location: { ...selected.location, name: e.target.value } })} /></label>
            <label className="mt-3 block text-xs font-semibold">到达后故事<textarea className="input mt-1 min-h-28" value={selected.story} onChange={(e) => updateScene(selected.id, { story: e.target.value })} /></label>
            <label className="mt-3 block text-xs font-semibold">到达提示<textarea className="input mt-1 min-h-20" value={selected.briefing ?? ""} onChange={(e) => updateScene(selected.id, { briefing: e.target.value })} /></label>
            <MediaEditor media={selected.media} onChange={(media) => updateScene(selected.id, { media })} />

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">纬度<input className="input mt-1" inputMode="decimal" value={selected.location.lat} onChange={(e) => updateLocation(selected.id, Number(e.target.value), selected.location.lng)} /></label>
              <label className="text-xs font-semibold">经度<input className="input mt-1" inputMode="decimal" value={selected.location.lng} onChange={(e) => updateLocation(selected.id, selected.location.lat, Number(e.target.value))} /></label>
            </div>

            <div className="mt-4 rounded-xl bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">挑战</p>
                {challenge ? (
                  <span className="chip bg-[var(--surface)] text-[10.5px]">{CHALLENGE_TYPE_LABEL[challenge.type]}</span>
                ) : null}
              </div>
              {challenge ? (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="题型">
                    {(["choice", "keyword", "text"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={challenge.type === type}
                        className={`rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold ${
                          challenge.type === type
                            ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                            : "border-[var(--line)] text-[var(--muted)]"
                        }`}
                        onClick={() => {
                          if (challenge.type === type) return;
                          updateScene(selected.id, { challenge: changeChallengeType(challenge, type) });
                        }}
                      >
                        {CHALLENGE_TYPE_LABEL[type]}
                      </button>
                    ))}
                  </div>
                  <label className="mt-2 block text-xs">问题<textarea className="input mt-1 min-h-16" value={challenge.question} onChange={(e) => updateScene(selected.id, { challenge: { ...challenge, question: e.target.value } })} /></label>
                  {challenge.type === "choice" ? (
                    <div className="mt-2">
                      <div className="grid gap-1.5">
                        {(challenge.options ?? []).map((option, i) => {
                          const isCorrect = !challenge.reflective && challenge.answer === i;
                          return (
                            <div key={i} className="flex items-center gap-1.5">
                              <button
                                type="button"
                                role="radio"
                                aria-checked={isCorrect}
                                aria-label={`把选项 ${i + 1} 设为正确答案`}
                                disabled={Boolean(challenge.reflective)}
                                className={`h-7 w-7 shrink-0 rounded-full border text-[11px] font-bold ${
                                  isCorrect
                                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                                    : "border-[var(--line)] text-[var(--muted)]"
                                }`}
                                onClick={() => updateScene(selected.id, { challenge: setCorrectOption(challenge, i) })}
                              >
                                {isCorrect ? "✓" : String.fromCharCode(65 + i)}
                              </button>
                              <input
                                className="input"
                                aria-label={`选项 ${i + 1}`}
                                value={option}
                                onChange={(e) => updateScene(selected.id, { challenge: setChoiceOption(challenge, i, e.target.value) })}
                              />
                              <button
                                type="button"
                                aria-label={`删除选项 ${i + 1}`}
                                disabled={(challenge.options?.length ?? 0) <= MIN_CHOICE_OPTIONS}
                                className="shrink-0 px-1 text-[16px] leading-none text-[var(--muted)] disabled:opacity-30"
                                onClick={() => updateScene(selected.id, { challenge: removeChoiceOption(challenge, i) })}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="text-[11.5px] font-semibold underline disabled:text-[var(--muted)] disabled:no-underline"
                          disabled={(challenge.options?.length ?? 0) >= MAX_CHOICE_OPTIONS}
                          onClick={() => updateScene(selected.id, { challenge: addChoiceOption(challenge) })}
                        >
                          ＋ 添加选项
                        </button>
                        <span className="text-[10.5px] text-[var(--muted)]">
                          {challenge.reflective ? "反思型选择：无标准答案" : "点左侧字母设为正确答案"}
                        </span>
                      </div>
                      {challenge.reflective ? (
                        <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
                          这是<strong>反思型选择</strong>：没有标准答案，玩家做出真实选择即可完成，不用于排名或考试。
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <label className="mt-2 block text-xs">可接受的答案（每行一个）<textarea className="input mt-1 min-h-16" value={answerLines(challenge)} onChange={(e) => updateScene(selected.id, { challenge: withAnswerLines(challenge, e.target.value) })} /></label>
                  )}
                  <label className="mt-2 block text-xs">答案说明<textarea className="input mt-1 min-h-16" value={challenge.explanation ?? ""} onChange={(e) => updateScene(selected.id, { challenge: { ...challenge, explanation: e.target.value } })} /></label>
                  <MediaEditor media={challenge.media} onChange={(media) => updateScene(selected.id, { challenge: { ...challenge, media } })} />
                </>
              ) : (
                <div className="mt-2">
                  <p className="text-[11.5px] leading-relaxed text-[var(--muted)]">这一站还没有挑战，玩家到达后无法进入任务页。建议添加一个。</p>
                  <button
                    type="button"
                    className="btn btn-secondary mt-2 h-9 min-h-0 px-3 text-xs"
                    onClick={() => updateScene(selected.id, { challenge: createChallenge("choice") })}
                  >
                    ＋ 添加挑战
                  </button>
                </div>
              )}
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
                  aria-label={`${scene.title} 触发距离（滑杆）`}
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
          保存到本机后无需账号即可立即试玩；分享会生成独立链接和二维码，接收方不依赖你的本机存档。
        </p>
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-[11.5px] leading-relaxed">
          <p className="font-semibold">发布前请确认</p>
          <p className="mt-1 text-[var(--muted)]">先设好真实起点、区域和各站坐标（AI 给的 0,0 只是占位），并在安全的户外试玩。修改后需重新发布，旧链接不会自动更新；二维码在本机生成，不调用外部服务。</p>
        </div>
        {areaIncomplete ? (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-800">
            游戏区域还没有画完（至少 {MIN_POLYGON_POINTS} 个边界点），完成或取消绘制后才能保存。
          </p>
        ) : null}
        {saveFailure ? (
          <div
            role="alert"
            className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] leading-relaxed text-red-800"
          >
            <p className="font-semibold">{saveFailure.summary}</p>
            {/* A single problem is already spelled out in the summary above. */}
            {saveFailure.problems.length > 1 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {saveFailure.problems.map((problem) => (
                  <li key={problem.path}>
                    <span className="font-semibold">{problem.label}</span>：{problem.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {saveFailure.hidden > 0 ? <p className="mt-1">还有 {saveFailure.hidden} 处未列出。</p> : null}
            <p className="mt-1">本机上的旧存档没有被改动，修正后即可正常保存。</p>
          </div>
        ) : null}
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={play}
            disabled={areaIncomplete || drawingArea}
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
          <button type="button" className="btn btn-primary btn-block" onClick={share} disabled={areaIncomplete || drawingArea || shareBusy}>
            {shareBusy ? "正在生成分享链接…" : "🔗 生成分享链接（本机直传）"}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={publishOnline} disabled={areaIncomplete || drawingArea || shareBusy}>
            {shareBusy ? "正在发布…" : "☁️ 发布到线上（生成可分享链接）"}
          </button>
          {shareUrl ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <p className="text-[12px] font-semibold">游戏二维码</p>
            <GameQr
              url={shareUrl}
              fileNamePrefix={(working?.title || "MOS-Scene-Hunt").replace(/[^\\w-]+/g, "-")}
              onMessage={setShareMessage}
            />
              <p className="mt-3 text-[12px] font-semibold">分享链接</p>
              <p className="mt-1 break-all text-[10.5px] leading-relaxed text-[var(--muted)]">{shareUrl}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => shareToPlatform("wechat")}>微信分享</button>
                <button type="button" className="btn btn-secondary" onClick={() => shareToPlatform("viber")}>Viber 分享</button>
                <button type="button" className="btn btn-secondary" onClick={() => shareToPlatform("facebook")}>Facebook 分享</button>
                <button type="button" className="btn btn-secondary" onClick={() => shareToPlatform("system")}>其他应用分享</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-secondary" onClick={copyShareUrl}>复制链接</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShareUrl(null)}>收起二维码</button>
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--muted)]">这份二维码和链接对应当前发布的游戏内容。修改游戏后请重新发布；旧二维码仍指向旧版本。</p>
            </div>
          ) : null}
          {shareMessage ? <p className="text-center text-[11.5px] text-[var(--muted)]">{shareMessage}</p> : null}
          <div className="grid grid-cols-2 gap-2"><button type="button" className="btn btn-ghost btn-block" onClick={copyJson}>复制游戏 JSON</button><button type="button" className="btn btn-ghost btn-block" onClick={exportPackage}>导出游戏包</button></div>
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
