"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "Business" },
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/ai", label: "AI assistant" },
  { href: "/settings/knowledge", label: "Q&A" },
  { href: "/settings/payments", label: "Payments" },
  { href: "/settings/automation", label: "Automation" },
  { href: "/settings/team", label: "Team" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-8 flex gap-6 border-b text-sm">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px border-b-2 pb-3", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
