"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { NAV_SECTIONS } from "./nav";

export function SidebarNav({ allowed, mobile = false }: { allowed: string[]; mobile?: boolean }) {
  const pathname = usePathname();
  if (mobile) {
    return (
      <nav aria-label="Primary navigation" className="flex min-w-max items-center gap-1 px-3 py-2">
        {NAV_SECTIONS.flatMap((section) => section.items)
          .filter((item) => allowed.includes(item.href))
          .map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 px-3 text-xs font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section, i) => {
        const items = section.items.filter((item) => allowed.includes(item.href));
        if (!items.length) return null;
        return (
          <div key={i}>
            {section.label && <div className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">{section.label}</div>}
            <ul className="grid gap-0.5">
              {items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active ? "bg-sidebar-accent font-medium text-white" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white",
                      )}
                    >
                      <Icon className={cn("size-4", active ? "text-signal" : "text-sidebar-muted")} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
