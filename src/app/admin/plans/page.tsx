import type { Metadata } from "next";

import { PlanForm } from "@/components/admin/plan-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPlans } from "@/services/admin/admin.service";

import { savePlanAction } from "../actions";

export const metadata: Metadata = { title: "Plans · Admin" };

export default async function AdminPlansPage() {
  await requirePlatformAdmin();
  const plans = await listPlans(createAdminClient());

  return (
    <>
      <PageHeader
        title="Plans & pricing"
        description="Prices apply to new checkouts, upgrades and the next renewal — existing invoices keep their amount. Plans in use can be hidden or retired, never deleted."
      />
      <div className="grid gap-6">
        {plans.map((p) => (
          <section key={p.id} className="rounded-xl border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="font-semibold">{p.name}</h2>
              {!p.is_active && <Badge variant="secondary">Retired</Badge>}
              {p.is_active && !p.is_public && <Badge variant="outline">Hidden</Badge>}
            </div>
            <PlanForm
              action={savePlanAction}
              subscribers={p.subscribers}
              plan={{
                id: p.id,
                code: p.code,
                name: p.name,
                description: p.description ?? "",
                price: String(p.price_minor / 100),
                interval: p.interval,
                sort_order: p.sort_order,
                is_active: p.is_active,
                is_public: p.is_public,
                limits: p.limits as Record<string, number | null>,
                features: p.features as Record<string, boolean>,
              }}
            />
          </section>
        ))}
        <section className="rounded-xl border border-dashed bg-card p-6">
          <h2 className="mb-4 font-semibold">New plan</h2>
          <PlanForm
            action={savePlanAction}
            subscribers={0}
            plan={{ id: null, code: "", name: "", description: "", price: "", interval: "monthly", sort_order: plans.length + 1, is_active: true, is_public: false, limits: {}, features: {} }}
          />
        </section>
      </div>
    </>
  );
}
