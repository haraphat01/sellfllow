import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireBusinessContext } from "@/lib/auth/session";
import { displayName, timeAgo } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_STATUSES, listCustomers, listTags } from "@/services/customers/customers.service";

export const metadata: Metadata = { title: "Customers" };

const STATUS_LABEL: Record<string, string> = { lead: "Lead", interested: "Interested", customer: "Customer", repeat_customer: "Repeat", inactive: "Inactive" };
const STATUS_VARIANT: Record<string, "secondary" | "success" | "signal" | "warning" | "outline"> = {
  lead: "outline",
  interested: "warning",
  customer: "success",
  repeat_customer: "signal",
  inactive: "secondary",
};

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const ctx = await requireBusinessContext();
  if (!ctx.can("customers.view")) redirect("/dashboard");
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 80) || undefined;
  const status = (CUSTOMER_STATUSES as readonly string[]).includes(one(sp.status) ?? "") ? (one(sp.status) as (typeof CUSTOMER_STATUSES)[number]) : undefined;
  const tag = one(sp.tag)?.slice(0, 40) || undefined;
  const page = Number(one(sp.page)) || 1;

  const db = await createClient();
  const [{ items, total, pageCount }, tags] = await Promise.all([listCustomers(db, ctx.business.id, { q, status, tag, page }), listTags(db, ctx.business.id)]);
  const filtered = Boolean(q || status || tag);
  const now = new Date();

  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (tag) params.set("tag", tag);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/customers?${s}` : "/customers";
  };

  return (
    <>
      <PageHeader title="Customers" description="Everyone who has messaged your business on WhatsApp, with their orders and spend." />

      {total === 0 && !filtered ? (
        <EmptyState icon={Users} title="No customers yet" description="Customers are created automatically when they message your WhatsApp number." />
      ) : (
        <>
          <form action="/customers" className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Search name, phone or email" className="pl-8" />
            </div>
            <NativeSelect name="status" defaultValue={status ?? ""} className="w-40" aria-label="Status">
              <option value="">All statuses</option>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
            {tags.length > 0 && (
              <NativeSelect name="tag" defaultValue={tag ?? ""} className="w-36" aria-label="Tag">
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            )}
            <Button type="submit" variant="secondary">
              Filter
            </Button>
            {filtered && (
              <Button variant="ghost" asChild>
                <Link href="/customers">Clear</Link>
              </Button>
            )}
          </form>

          {items.length === 0 ? (
            <EmptyState icon={Search} title="No customers match" description="Try a different search or clear the filters." />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Tags</th>
                    <th className="px-4 py-3 text-right font-medium">Orders</th>
                    <th className="px-4 py-3 text-right font-medium">Spend</th>
                    <th className="px-4 py-3 text-right font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((c) => (
                    <tr key={c.id} className="group hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/customers/${c.id}`} className="block">
                          <span className="font-medium group-hover:underline">{displayName(c)}</span>
                          <span className="block text-xs text-muted-foreground">{c.phone}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                              {t}
                            </span>
                          ))}
                          {c.tags.length > 3 && <span className="text-xs text-muted-foreground">+{c.tags.length - 3}</span>}
                        </span>
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">{c.total_orders}</td>
                      <td className="tabular px-4 py-2.5 text-right">{formatMoney(c.total_spend_minor, ctx.business.currency)}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{timeAgo(c.last_interaction_at, now) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total.toLocaleString()} customers · page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={href(page - 1)}>
                      <ChevronLeft /> Previous
                    </Link>
                  </Button>
                )}
                {page < pageCount && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={href(page + 1)}>
                      Next <ChevronRight />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
