"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/registry/types";

interface NavItem {
  href: string;
  label: string;
  /** Minimum role that may see this entry. */
  min: Role;
}

const ITEMS: NavItem[] = [
  { href: "/admin", label: "概览", min: "creator" },
  { href: "/admin/queue", label: "审核队列", min: "reviewer" },
  { href: "/admin/works", label: "作品", min: "creator" },
  { href: "/admin/users", label: "用户与角色", min: "admin" },
  { href: "/admin/audit", label: "审计日志", min: "admin" },
];

const RANK: Record<Role, number> = { creator: 1, reviewer: 2, admin: 3 };

export function AdminNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((item) => RANK[role] >= RANK[item.min]);

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {visible.map((item) => {
        const active =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-[var(--text)] font-medium text-white"
                : "text-[var(--muted)] hover:bg-white hover:text-[var(--text)]",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
