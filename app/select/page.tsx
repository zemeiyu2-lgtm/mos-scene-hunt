"use client";

/**
 * Hunt Select.
 *
 * V0.1 ships a single content pack, so this screen's real job is the pre-flight
 * briefing: what the hunt is, how long it takes, and what permission it needs.
 * It is also the gate that requests GPS - deliberately after the player has read
 * why.
 */

import { useRouter } from "next/navigation";
import { useHunt } from "@/components/hunt-provider";
import { useGps } from "@/components/gps-provider";
import { HUNT_MANIFEST } from "@/lib/content";
import { ErrorState, Screen } from "@/components/ui";
import { TabBar } from "@/components/tab-bar";

export default function SelectPage() {
  const router = useRouter();
  const { game, loadError, reloadContent, state, statuses, startHunt } = useHunt();
  const { start, status, permission } = useGps();

  const begin = () => {
    // Kick off GPS and the hunt together: the permission prompt appears while
    // the map is already loading, so the player is not staring at a blank screen.
    start();
    startHunt();
    router.push("/map");
  };

  const completedCount = statuses.filter((s) => s.status === "completed").length;
  const hasProgress = Boolean(state && state.inventory.length > 0);

  if (loadError) {
    return (
      <Screen title="选择寻宝" subtitle="加载失败">
        <ErrorState
          title="无法加载游戏内容"
          detail={loadError}
          onRetry={() => reloadContent(true)}
        />
      </Screen>
    );
  }

  if (!game) {
    return (
      <Screen title="选择寻宝">
        <div className="card h-40 animate-pulse" />
      </Screen>
    );
  }

  const manifest = HUNT_MANIFEST.find((h) => h.id === game.id);

  return (
    <>
    <Screen title="选择寻宝" subtitle="确认信息后开始">
      <section className="card overflow-hidden">
        <div className="bg-gradient-to-br from-[#1d2542] to-[#2a3459] px-5 py-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-signal-soft">
            {manifest?.difficulty === "easy" ? "入门" : "进阶"} · {game.language}
          </p>
          <h2 className="mt-1.5 text-[20px] font-bold leading-tight">{game.title}</h2>
        </div>

        <div className="p-5">
          <p className="text-[13.5px] leading-relaxed text-[var(--muted)]">{game.description}</p>

          <dl className="mt-4 grid grid-cols-3 gap-2">
            {[
              { k: "地点", v: `${game.scenes.length} 个` },
              { k: "预计", v: `${game.estimatedMinutes ?? 20} 分钟` },
              { k: "触发", v: "约 50 m" },
            ].map((item) => (
              <div key={item.k} className="rounded-xl bg-[var(--surface)] px-3 py-2">
                <dt className="text-[11px] text-[var(--muted)]">{item.k}</dt>
                <dd className="tabular mt-0.5 text-[13px] font-semibold">{item.v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 space-y-2">
            {game.scenes.map((scene, i) => (
              <div key={scene.id} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--line)] text-[11px] font-bold text-[var(--muted)]">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium leading-snug">{scene.title}</p>
                  <p className="text-[11.5px] text-[var(--muted)]">
                    {scene.challenge ? challengeLabel(scene.challenge.type) : "无任务"}
                    {scene.reward ? ` · 奖励：${scene.reward.title}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {hasProgress ? (
        <div className="card mt-4 p-4">
          <p className="text-[13px]">
            你已有进行中的进度：
            <span className="font-semibold">
              {" "}
              {completedCount} / {statuses.length} 个地点已完成
            </span>
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            继续寻宝不会清空已有进度。
          </p>
        </div>
      ) : null}

      <div className="card mt-4 p-4">
        <p className="text-[13px] font-semibold">开始前需要</p>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <li>· 允许浏览器使用你的位置（仅用于计算你与地点的距离）</li>
          <li>· 在户外开阔处，手机 GPS 精度通常为 ±5～20 米</li>
          <li>· 无需注册、无需登录，进度保存在本机</li>
        </ul>
        {permission === "denied" ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700">
            检测到定位权限已被拒绝。请在浏览器地址栏的站点设置中重新允许定位，否则无法开始。
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2">
        <button type="button" className="btn btn-primary btn-block" onClick={begin}>
          {hasProgress ? "继续寻宝" : "开始寻宝"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => router.back()}
        >
          返回
        </button>
      </div>

      {status === "unsupported" ? (
        <p className="mt-3 text-center text-[12px] text-red-700">
          当前浏览器不支持定位功能，游戏无法运行。
        </p>
      ) : null}
    </Screen>
      <TabBar />
    </>
  );
}

function challengeLabel(type: string): string {
  switch (type) {
    case "choice":
      return "选择题";
    case "keyword":
      return "关键词题";
    case "text":
      return "简答题";
    default:
      return "任务";
  }
}
