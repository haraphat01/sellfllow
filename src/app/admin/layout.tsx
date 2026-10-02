import Link from "next/link";

import { AdminNav } from "@/components/admin/admin-nav";
import { Logo } from "@/components/brand/logo";
import { requirePlatformAdmin } from "@/lib/auth/session";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requirePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 pt-4 pb-1">
          <div className="flex items-center gap-3">
            <Logo inverted />
            <span className="rounded bg-signal px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-signal-foreground uppercase">Admin</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-sidebar-foreground/70 sm:inline">{user.email}</span>
            <Link href="/dashboard" className="hover:text-white">
              Exit admin
            </Link>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
