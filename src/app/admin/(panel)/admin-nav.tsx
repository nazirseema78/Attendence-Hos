"use client";

import { BarChart3, CalendarCheck, Settings, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const NAV: { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: "/admin", label: "Today", icon: CalendarCheck, match: (p) => p === "/admin" || p.startsWith("/admin/attendance") },
  { href: "/admin/students", label: "Students", icon: Users, match: (p) => p.startsWith("/admin/students") },
  { href: "/admin/history", label: "History", icon: BarChart3, match: (p) => p.startsWith("/admin/history") },
  { href: "/admin/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/admin/settings") },
];

/** Desktop sidebar links (dark navy background). Pass a pathname for the static fallback. */
export function SidebarNav() {
  return <SidebarLinks pathname={usePathname()} />;
}

export function SidebarLinks({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-navy-foreground/70 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon aria-hidden className={cx("h-4 w-4", active && "text-primary-soft")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile/tablet bottom tab bar. */
export function BottomNav() {
  return <BottomLinks pathname={usePathname()} />;
}

export function BottomLinks({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
              active ? "text-primary" : "text-muted hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
