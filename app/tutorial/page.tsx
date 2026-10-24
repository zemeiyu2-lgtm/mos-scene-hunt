"use client";

import { useState } from "react";
import Link from "next/link";
import { MapView } from "@/components/map-view";
import { Screen } from "@/components/ui";
import { RIZAL_PARK_TEMPLATE } from "@/lib/game/templates";
import type { MapSceneEntry } from "@/components/game-map";
import type { PositionFix } from "@/lib/location";

const steps = [
  { title: "发现线索", detail: "先看地图与站点分布，选择要探索的路线。", label: "地图上找到站点" },
  { title: "前往地点", detail: "真实游戏会使用手机 GPS 判断你与目标的距离。演示中的玩家位置是模拟坐标。", label: "走近目标地点" },
  { title: "完成挑战", detail: "到达触发范围后，阅读现场情境并完成对应任务。", label: "解锁现场任务" },
  { title: "收集宝物", detail: "完成任务会获得线索或奖励，继续探索，最后兑现本次寻宝的目标。", label: "完成任务并寻宝" },
];

export default function TutorialPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const demoGame = RIZAL_PARK_TEMPLATE;
  const demoPlayer: PositionFix = { lat: 14.58305, lng: 120.97936, accuracy: 12, timestamp: 0, simulated: true };
  const entries: MapSceneEntry[] = demoGame.scenes.map((scene, index) => ({
    scene,
    status: index <= stepIndex ? "available" : "locked",
    isActive: index === stepIndex,
    distance: null,
    inRange: false,
  }));
  const step = steps[stepIndex];

  return (
    <Screen title="玩法演示" headerRight={<Link href="/games" className="btn btn-ghost h-9 min-h-0 px-2 text-xs">返回游戏中心</Link>}>
      <section className="card overflow-hidden">
        <div className="relative h-[280px] w-full bg-[var(--gold-chalk)]">
          <MapView player={demoPlayer} entries={entries} huntArea={demoGame.huntArea} tileProvider="osm" fitToHunt />
          <div className="pointer-events-none absolute bottom-2 left-2 z-[700] rounded-full border border-white/70 bg-[var(--hero-teal-veil)] px-3 py-1 text-[10px] font-semibold text-white shadow">演示地图 · 模拟位置</div>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-[var(--muted)]">演示 {stepIndex + 1} / {steps.length}</span>
            <span className="chip">{step.label}</span>
          </div>
          <h2 className="mt-2 text-xl font-bold">{step.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{step.detail}</p>
          <div className="mt-4 grid grid-cols-4 gap-1.5">
            {steps.map((item, index) => (
              <button key={item.title} type="button" onClick={() => setStepIndex(index)} aria-label={item.title} aria-current={index === stepIndex ? "step" : undefined} className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${index === stepIndex ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--muted)]"}`}>
                {index + 1}. {item.title}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={() => setStepIndex((current) => Math.max(0, current - 1))} disabled={stepIndex === 0}>上一步</button>
            {stepIndex < steps.length - 1 ? (
              <button type="button" className="btn btn-primary flex-1" onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}>下一步</button>
            ) : (
              <Link href="/select" className="btn btn-primary flex-1 text-center">开始探索</Link>
            )}
          </div>
        </div>
      </section>
      <p className="mt-3 px-1 text-xs leading-relaxed text-[var(--muted)]">此页面用于了解玩法，不会读取或改变你的真实位置与游戏进度。开始实际游戏后，浏览器才会请求定位权限。</p>
    </Screen>
  );
}
