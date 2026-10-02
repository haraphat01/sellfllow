import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchBusinesses } from "@/services/admin/admin.service";

export const metadata: Metadata = { title: "Businesses · Admin" };

const SUB_VARIANT: Record<string, "success" | "signal" | "warning" | "destructive" | "secondary"> = {
  active: "success",
  trialing: "signal",
  past_due: "warning",
  cancelled: "secondary",
  expired: "destructive",
};

export default async function AdminBusinessesPage({ searchParams }: PageProps<"/admin/businesses">) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const page = Number(sp.page ?? 1) || 1;
  const { rows, total, pageSize } = await searchBusinesses(createAdminClient(), { q, status, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Businesses" description={`${total.toLocaleString()} matching`} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Name, slug, member email or business ID" className="pl-9" />
        </div>
        <NativeSelect name="status" defaultValue={status} aria-label="Status" className="w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="closed">Closed</option>
        </NativeSelect>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Subscription</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No businesses match.
                </td>
              </tr>
            )}
            {rows.map((b) => {
              const sub = b.subscriptions as unknown as { status: string; is_complimentary: boolean; current_period_end: string; plan: { name: string } | null } | null;
              return (
                <tr key={b.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/businesses/${b.id}`} className="font-medium hover:underline">
                      {b.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {b.slug} · {b.country}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {sub?.plan?.name ?? "—"}
                    {sub?.is_complimentary && <span className="ml-1 text-xs text-muted-foreground">(complimentary)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {sub ? (
                      <span className="flex items-center gap-2">
                        <Badge variant={SUB_VARIANT[sub.status] ?? "secondary"} className="capitalize">
                          {sub.status.replace("_", " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">to {formatDate(sub.current_period_end)}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={b.status === "active" ? "success" : "destructive"} className="capitalize">
                      {b.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(b.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={link(page - 1)}>Previous</Link>
            </Button>
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Button asChild variant="outline" size="sm">
              <Link href={link(page + 1)}>Next</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
