"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useGps } from "@/components/gps-provider";
import { Screen } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  idle: "尚未开始",
  requesting: "正在获取定位…",
  watching: "正在接收定位",
  error: "定位遇到问题",
  unsupported: "浏览器不支持定位",
};

const PERMISSION_LABEL: Record<string, string> = {
  unknown: "暂时未知",
  granted: "已允许",
  denied: "已拒绝",
  prompt: "等待授权",
  unsupported: "浏览器不支持查询权限",
};

function accuracyLabel(metres: number) {
  if (metres <= 15) return { label: "很好", hint: "适合测试较小的触发半径", tone: "text-emerald-700 bg-emerald-50" };
  if (metres <= 30) return { label: "可用", hint: "可测试 20–30 米触发范围", tone: "text-emerald-700 bg-emerald-50" };
  if (metres <= 100) return { label: "偏低", hint: "请等待读数稳定，并尽量到开阔处", tone: "text-amber-800 bg-amber-50" };
  return { label: "较差", hint: "暂时不要据此判断站点触发是否准确", tone: "text-red-700 bg-red-50" };
}

export default function GpsFieldTestPage() {
  const { fix, status, error, permission, isSimulated, start, retry } = useGps();

  useEffect(() => {
    start();
  }, [start]);

  const accuracy = fix ? accuracyLabel(fix.accuracy) : null;

  return (
    <Screen title="GPS 现场测试" subtitle="BSOP 实测准备 · 只读取本机定位">
      <section className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">定位状态</p>
            <h2 className="mt-1 text-xl font-bold">{STATUS_LABEL[status] ?? status}</h2>
          </div>
          <span className={`chip shrink-0 ${isSimulated ? "bg-violet-100 text-violet-800" : status === "watching" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {isSimulated ? "模拟位置" : status === "watching" ? "真实设备读数" : "等待真实读数"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[var(--surface)] p-3">
            <p className="text-xs text-[var(--muted)]">浏览器定位权限</p>
            <p className="mt-1 font-semibold">{PERMISSION_LABEL[permission] ?? permission}</p>
          </div>
          <div className="rounded-2xl bg-[var(--surface)] p-3">
            <p className="text-xs text-[var(--muted)]">定位精度（系统估算）</p>
            <p className="mt-1 text-xl font-extrabold">{fix ? `±${Math.round(fix.accuracy)} m` : "—"}</p>
          </div>
        </div>

        {error ? (
          <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-bold">{error.code}</p>
            <p className="mt-1">{error.userMessage}</p>
          </div>
        ) : null}

        {accuracy ? (
          <div className={`mt-3 rounded-xl p-3 ${accuracy.tone}`}>
            <p className="font-bold">精度判断：{accuracy.label}</p>
            <p className="mt-1 text-sm">{accuracy.hint}</p>
          </div>
        ) : null}

        <button type="button" className="btn btn-primary btn-block mt-4" onClick={retry}>
          重新获取定位
        </button>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          请在手机浏览器中打开并允许定位。首次读数可能需要一些时间；最好在室外开阔处停稳后测试。
        </p>
      </section>

      <section className="card mt-4 p-5">
        <h3 className="text-base font-bold">当前设备坐标</h3>
        {fix ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl bg-[var(--surface)] p-3">
              <p className="text-xs text-[var(--muted)]">纬度（Latitude）</p>
              <p className="mt-1 break-all font-mono text-sm">{fix.lat.toFixed(7)}</p>
            </div>
            <div className="rounded-xl bg-[var(--surface)] p-3">
              <p className="text-xs text-[var(--muted)]">经度（Longitude）</p>
              <p className="mt-1 break-all font-mono text-sm">{fix.lng.toFixed(7)}</p>
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              读数时间：{new Date(fix.timestamp).toLocaleString()}。这些坐标只显示在本页，不会自动写入游戏站点或上传保存。
            </p>
            {isSimulated ? (
              <p className="rounded-xl bg-violet-50 p-3 text-sm text-violet-800">
                当前读数来自模拟器，不可用于现场标定。请关闭开发模拟定位后再测。
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">尚未取得有效坐标。请检查系统定位服务与浏览器站点权限，然后重试。</p>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-bold text-amber-950">现场测试提醒</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-amber-950/85">
          <li>GPS 精度是手机的估算值，不代表真实误差保证。</li>
          <li>先记录站点坐标和精度，再测试触发半径；不要把示范坐标当成实测点。</li>
          <li>每个站点从安全、可通行的方向接近，并至少重复三次。</li>
          <li>不要为了触发游戏进入限制区域、道路或不安全位置。</li>
        </ul>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link href="/" className="btn btn-secondary text-center">返回首页</Link>
        <Link href="/select?game=bsop-eight-secrets" className="btn btn-primary text-center">开始 BSOP 实测</Link>
      </div>
    </Screen>
  );
}
