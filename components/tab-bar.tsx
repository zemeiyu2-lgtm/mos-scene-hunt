"use client";

/**
 * Bottom tab bar - the game's only navigation.
 *
 * Spec section 12 caps this at three destinations: 地图 / 任务 / 背包. Contextual
 * actions (answer, advance) live inside the screens, never here.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHunt } from "./hunt-provider";

interface TabDef {
  href: string;
  label: string;
  icon: string;
  /** Badge count, or null for none. */
  badge?: number | null;
}

export function TabBar() {
  const pathname = usePathname();
  const { state, complete } = useHunt();

  const newItems = state?.inventory.length ?? 0;

  const tabs: TabDef[] = [
    { href: "/map", label: "地图", icon: "◎" },
    {
      href: "/quest",
      label: "任务",
      icon: "◆",
      // A dot on 任务 when there is something new to do, not a count: a number
      // here would compete with the distance readout for attention.
      badge: complete ? null : 1,
    },
    { href: "/bag", label: "背包", icon: "▤", badge: newItems || null },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--card)]"
      style={{ paddingBottom: "var(--safe-bottom)" }}
      aria-label="主导航"
    >
      <ul className="mx-auto flex w-full max-w-[480px]">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-[var(--tabbar-h)] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  active ? "text-[var(--accent-deep)]" : "text-[var(--muted)]"
                }`}
              >
                <span className="relative text-[17px] leading-none" aria-hidden>
                  {tab.icon}
                  {tab.badge ? (
                    <span
                      className="absolute -right-2 -top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
                      aria-hidden
                    />
                  ) : null}
                </span>
                <span>{tab.label}</span>
                {active ? (
                  <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-[var(--accent)]" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
