import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { BusinessSwitcher } from "@/components/dashboard/business-switcher";
import { NAV_SECTIONS } from "@/components/dashboard/nav";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { SubscriptionBanner } from "@/components/billing/subscription-banner";
import { requireBusinessContext } from "@/lib/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireBusinessContext();
  const allowed = NAV_SECTIONS.flatMap((s) => s.items)
    .filter((item) => !item.perm || ctx.can(item.perm))
    .map((item) => item.href);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Link href="/dashboard" className="mb-7 px-3">
          <Logo inverted />
        </Link>
        <div className="mb-6">
          <BusinessSwitcher current={{ id: ctx.business.id, name: ctx.business.name }} memberships={ctx.memberships} />
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav allowed={allowed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <Logo />
          </div>
          <div className="hidden text-sm text-muted-foreground lg:block">
            <span className="capitalize">{ctx.role}</span> · {ctx.business.name}
          </div>
          <UserMenu name={ctx.user.fullName} email={ctx.user.email} isPlatformAdmin={ctx.user.isPlatformAdmin} />
        </header>

        <SubscriptionBanner businessId={ctx.business.id} canManage={ctx.can("billing.manage")} />

        {ctx.business.status === "suspended" && (
          <div className="flex items-center gap-2 border-b bg-destructive/10 px-6 py-2.5 text-sm text-destructive">
            <AlertTriangle className="size-4" /> This business is suspended. Automations are paused. Contact support.
          </div>
        )}

        <nav className="sticky top-14 z-10 overflow-x-auto border-b bg-background/95 backdrop-blur lg:hidden">
          <SidebarNav allowed={allowed} mobile />
        </nav>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
