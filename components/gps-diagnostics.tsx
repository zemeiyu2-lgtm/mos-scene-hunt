"use client";

/**
 * GPS diagnostics chip - field-testing aid, not a player feature.
 *
 * Collapsed by default (one small chip) so ordinary players are never shown
 * technical detail; a tap expands the read-only snapshot that outdoor testers
 * need: status, permission, fix freshness, accuracy band, last error, whether
 * the watcher handle exists, how many automatic recoveries ran, page
 * visibility, and whether the fix is simulated.
 *
 * Hard rules enforced here:
 *  - READ-ONLY: nothing in this component dispatches, calls start/retry, or
 *    otherwise drives the GPS engine.
 *  - No coordinates are ever rendered; accuracy is shown as a coarse band.
 *  - No network, no logging, no persistence - pure render of provider state.
 */

import { useEffect, useState } from "react";
import { useGps, type GpsStatus } from "./gps-provider";
import type { PermissionState } from "@/lib/location/provider";

const STATUS_LABEL: Record<GpsStatus, string> = {
  idle: "未开始",
  requesting: "定位中",
  watching: "监听中",
  error: "出错",
  unsupported: "设备不支持",
};

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: "已允许",
  denied: "已拒绝",
  prompt: "待询问",
  unknown: "未知",
  unsupported: "不支持查询",
};

/** Coarse accuracy band - enough to judge signal quality, no numbers needed. */
function accuracyBand(accuracy: number | null | undefined): string {
  if (accuracy == null) return "—";
  if (accuracy <= 10) return "优 (≤10m)";
  if (accuracy <= 25) return "良 (≤25m)";
  if (accuracy <= 65) return "中 (≤65m)";
  return "差 (>65m)";
}

function ageLabel(lastFixAt: number): string {
  if (!lastFixAt) return "尚无定位";
  const age = Math.max(0, Date.now() - lastFixAt);
  if (age < 5_000) return "刚刚";
  if (age < 60_000) return `${Math.round(age / 1000)} 秒前`;
  return `${Math.round(age / 60_000)} 分钟前`;
}

const ERROR_LABEL: Record<string, string> = {
  PERMISSION_DENIED: "权限被拒绝",
  POSITION_UNAVAILABLE: "位置不可用",
  TIMEOUT: "定位超时",
  UNSUPPORTED: "浏览器不支持",
};

export function GpsDiagnosticsChip() {
  const gps = useGps();
  const [open, setOpen] = useState(false);
  // Tick so "age" stays honest while the panel is open; paused when closed.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const rows: [string, string][] = [
    ["定位状态", STATUS_LABEL[gps.status]],
    ["定位权限", PERMISSION_LABEL[gps.permission]],
    ["最近定位", ageLabel(gps.lastFixAt)],
    ["定位精度", accuracyBand(gps.fix?.accuracy)],
    [
      "最近错误",
      gps.error ? ERROR_LABEL[gps.error.code] ?? gps.error.code : "无",
    ],
    ["定位监听", gps.watcherAlive ? "运行中" : "未运行"],
    ["自动恢复", `${gps.autoRebuildCount} 次`],
    ["页面状态", typeof document !== "undefined" && document.hidden ? "后台" : "前台"],
    ["模拟定位", gps.isSimulated ? "开启" : "关闭"],
  ];

  return (
    <div className="pointer-events-auto mt-2" data-testid="gps-diagnostics">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="chip text-[11px] text-[var(--muted)]"
        data-testid="gps-diagnostics-toggle"
      >
        GPS 诊断 {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div
          className="mt-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 py-2"
          data-testid="gps-diagnostics-panel"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-[11.5px] text-[var(--muted)]">{k}</dt>
                <dd className="text-right text-[11.5px] font-medium text-[var(--text)]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
