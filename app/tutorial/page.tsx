"use client";

import Link from "next/link";
import { Screen } from "@/components/ui";

export default function TutorialPage() {
  return (
    <Screen title="探索演示">
      <section className="card p-5">
        <p className="text-xs font-semibold tracking-wider text-[var(--muted)]">MOS SCENE HUNT</p>
        <h1 className="mt-2 text-2xl font-extrabold">在真实地图上认识寻宝</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">演示入口已合并到首页地图。首页展示真实地图、站点标记和寻宝路线样式；开始实际游戏后，位置与距离才会使用手机 GPS。</p>
        <Link href="/" className="btn btn-primary mt-4 w-full">返回首页查看地图</Link>
      </section>
    </Screen>
  );
}
