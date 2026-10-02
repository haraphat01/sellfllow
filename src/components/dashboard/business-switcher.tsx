"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";

import { switchBusiness } from "@/app/(app)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Membership = { businessId: string; name: string; role: string };

export function BusinessSwitcher({ current, memberships }: { current: { id: string; name: string }; memberships: Membership[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-signal/50">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-signal text-xs font-bold text-signal-foreground">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{current.name}</span>
        </span>
        <ChevronsUpDown className="size-4 text-sidebar-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Businesses</DropdownMenuLabel>
        {memberships.map((m) => (
          <form key={m.businessId} action={switchBusiness}>
            <input type="hidden" name="businessId" value={m.businessId} />
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full">
                <span className="flex-1 truncate text-left">{m.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
                {m.businessId === current.id && <Check className="!text-primary" />}
              </button>
            </DropdownMenuItem>
          </form>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding/new">
            <Plus /> New business
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
