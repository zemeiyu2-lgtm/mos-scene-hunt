"use client";

/**
 * Player-facing positioning status.
 *
 * This is the exit from the B-02 UX-01 dead end: every non-healthy state the
 * provider can be in now renders *something* with an action, and the four
 * states a player can actually experience stay distinguishable:
 *
 *   requesting  waiting politely, with a low-key "try again now"
 *   stalled     no fix yet (timeout / weak signal / system location off)
 *   error       permission denied or a fatal browser error - needs the player
 *   unsupported the browser has no Geolocation API
 *
 * Denied permissions are explained with the steps for the platform the player
 * is actually on (iOS Safari cannot be fixed from the address bar), and the
 * "granted but still no fix" case points at the system location switch instead
 * of blaming the browser.
 *
 * Layout rule: the banner sits in the top strip, never over the map centre or
 * the task card, and every action is at least 44 px tall.
 */

import { useMemo } from "react";
import type { GeoError, PermissionState } from "@/lib/location";
import type { GpsStatus } from "./gps-provider";
import {
  detectCurrentPlatform,
  locationServiceGuide,
  permissionRecoveryGuide,
  type Guidance,
} from "@/lib/location/guidance";

export interface GpsStatusBannerProps {
  status: GpsStatus;
  error: GeoError | null;
  permission: PermissionState;
  /** True once any fix (real or simulated) has been received. */
  hasFix: boolean;
  onRetry: () => void;
  onStart: () => void;
}

const SHELL = "pointer-events-auto mt-2 rounded-xl border px-3 py-2.5";
const TITLE = "text-[14px] font-semibold leading-snug";
const BODY = "mt-1 text-[13px] leading-snug";
const ACTION =
  "btn btn-primary mt-2 h-11 min-h-[44px] w-full px-4 text-[14px]";

function StepList({ guide }: { guide: Guidance }) {
  return (
    <ol className="mt-2 space-y-1 pl-4 text-[13px] leading-snug" style={{ listStyle: "decimal" }}>
      {guide.steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export function GpsStatusBanner({
  status,
  error,
  permission,
  hasFix,
  onRetry,
  onStart,
}: GpsStatusBannerProps) {
  const platform = useMemo(() => detectCurrentPlatform(), []);
  const permissionGuide = useMemo(() => permissionRecoveryGuide(platform), [platform]);
  const serviceGuide = useMemo(() => locationServiceGuide(platform), [platform]);

  if (status === "watching") return null;

  if (status === "unsupported") {
    return (
      <div className={`${SHELL} border-[var(--err-border)] bg-[var(--err-bg)]`} role="alert">
        <p className={`${TITLE} text-[var(--err-text)]`}>当前浏览器无法使用定位</p>
        <p className={`${BODY} text-[var(--err-text)]`}>
          请用 Safari、Chrome 或 Edge 等主流浏览器打开本页，并在系统设置中允许浏览器使用位置。
        </p>
      </div>
    );
  }

  if (status === "error") {
    const denied = error?.code === "PERMISSION_DENIED" || permission === "denied";
    if (denied) {
      return (
        <div className={`${SHELL} border-[var(--err-border)] bg-[var(--err-bg)]`} role="alert">
          <p className={`${TITLE} text-[var(--err-text)]`}>定位权限被拒绝，暂时无法寻宝</p>
          <StepList guide={permissionGuide} />
          {permissionGuide.note ? (
            <p className="mt-2 text-[13px] leading-snug text-[var(--err-text)]">{permissionGuide.note}</p>
          ) : null}
          <button type="button" className={ACTION} onClick={onRetry}>
            重新请求定位
          </button>
        </div>
      );
    }
    return (
      <div className={`${SHELL} border-[var(--err-border)] bg-[var(--err-bg)]`} role="alert">
        <p className={`${TITLE} text-[var(--err-text)]`}>定位暂时不可用</p>
        <p className={`${BODY} text-[var(--err-text)]`}>{error?.userMessage ?? "无法获取当前位置，请稍后重试。"}</p>
        <button type="button" className={ACTION} onClick={onRetry}>
          重新请求定位
        </button>
      </div>
    );
  }

  if (status === "stalled") {
    // Not a permission problem but still no fix: the system location switch or
    // the surroundings are. Say both, and give the platform's own switch path.
    // "unknown"/"prompt" count as "not the blocker" too - a browser that was
    // still asking would not have produced a timeout error in the first place.
    const permissionNotBlocking = permission !== "denied";
    return (
      <div className={`${SHELL} border-[var(--warn-border)] bg-[var(--warn-bg)]`} role="status" aria-live="polite">
        <p className={`${TITLE} text-[var(--warn-text)]`}>暂时还没有拿到你的位置</p>
        <p className={`${BODY} text-[var(--warn-text)]`}>
          {error?.code === "TIMEOUT"
            ? "定位请求超时。室内、地下或高楼之间常常会这样，到开阔处通常几秒内就能定位。"
            : permissionNotBlocking
              ? "定位权限没有问题，但还没有位置数据。可能是系统定位服务被关闭，或当前遮挡太严重。"
              : "定位启动失败或信号太弱。请在开阔位置重试。"}
        </p>
        {permissionNotBlocking ? (
          <p className="mt-2 text-[13px] font-semibold leading-snug text-[var(--warn-text)]">
            {serviceGuide.title}：
            <span className="font-normal"> {serviceGuide.steps.join("；")}</span>
          </p>
        ) : null}
        <button type="button" className={ACTION} onClick={onRetry}>
          重新请求定位
        </button>
      </div>
    );
  }

  if (status === "idle" && !hasFix) {
    return (
      <div className={`${SHELL} border-[var(--warn-border)] bg-[var(--warn-bg)]`} role="status" aria-live="polite">
        <p className={`${BODY} text-[var(--warn-text)]`}>
          尚未开始定位。允许定位后才能显示你的当前位置和目标方向。
        </p>
        <button type="button" className={ACTION} onClick={onStart}>
          获取我的位置
        </button>
      </div>
    );
  }

  if (status === "requesting" && !hasFix) {
    return (
      <div className={`${SHELL} border-[var(--warn-border)] bg-[var(--warn-bg)]`} role="status" aria-live="polite">
        <p className={`${BODY} text-[var(--warn-text)]`}>
          正在获取定位……首次定位通常需要 10–30 秒，请在开阔位置稍候。
        </p>
        <button
          type="button"
          className="mt-1.5 inline-flex h-11 min-h-[44px] items-center text-[13px] font-semibold text-[var(--warn-text)] underline"
          onClick={onRetry}
        >
          一直没有反应？重新定位
        </button>
      </div>
    );
  }

  return null;
}
