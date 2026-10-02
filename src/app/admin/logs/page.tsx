import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { listAuditLogs, listFailures } from "@/services/admin/admin.service";

export const metadata: Metadata = { title: "Logs · Admin" };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function AdminLogsPage({ searchParams }: PageProps<"/admin/logs">) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const tab = sp.tab === "failures" ? "failures" : "audit";
  const actor = typeof sp.actor === "string" ? sp.actor : "";
  const action = typeof sp.action === "string" ? sp.action.slice(0, 60) : "";
  const page = Number(sp.page ?? 1) || 1;
  const admin = createAdminClient();

  const tabs = (
    <nav className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
      {[
        ["audit", "Audit log"],
        ["failures", "Failures (7 days)"],
      ].map(([k, label]) => (
        <Link key={k} href={`?tab=${k}`} className={cn("rounded-md px-3 py-1.5", tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
          {label}
        </Link>
      ))}
    </nav>
  );

  if (tab === "failures") {
    const rows = await listFailures(admin, 7);
    return (
      <>
        <PageHeader title="System logs" description="Processing failures across all businesses." actions={tabs} />
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Detail</th>
                <th className="px-4 py-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No failures in the last 7 days.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={`${r.source}-${r.id}`}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{when(r.at)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{r.source}</td>
                  <td className="px-4 py-2.5">
                    {r.businessId ? (
                      <Link href={`/admin/businesses/${r.businessId}`} className="hover:underline">
                        {r.businessName ?? r.businessId.slice(0, 8)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.detail}</td>
                  <td className="max-w-md truncate px-4 py-2.5 text-destructive" title={r.error ?? ""}>
                    {r.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  const { rows, total, pageSize } = await listAuditLogs(admin, { actor, action, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (p: number) => `?${new URLSearchParams({ tab: "audit", ...(actor ? { actor } : {}), ...(action ? { action } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="System logs" description="Everything important that changed, by whom." actions={tabs} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="tab" value="audit" />
        <NativeSelect name="actor" defaultValue={actor} aria-label="Actor" className="w-40">
          <option value="">All actors</option>
          {["admin", "user", "system", "webhook", "ai"].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
        <Input name="action" defaultValue={action} placeholder="Action starts with… e.g. billing." className="max-w-xs" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{when(r.created_at)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2.5">{r.actor_type}</td>
                <td className="px-4 py-2.5">
                  {r.business_id ? (
                    <Link href={`/admin/businesses/${r.business_id}`} className="hover:underline">
                      {(r.businesses as unknown as { name: string } | null)?.name ?? r.business_id.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Platform</span>
                  )}
                </td>
                <td className="max-w-md truncate px-4 py-2.5 font-mono text-xs text-muted-foreground" title={JSON.stringify(r.metadata)}>
                  {JSON.stringify(r.metadata) === "{}" ? "" : JSON.stringify(r.metadata)}
                </td>
              </tr>
            ))}
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
