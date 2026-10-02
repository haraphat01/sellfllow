import type { Metadata } from "next";

import { InviteDialog } from "@/components/team/invite-dialog";
import { InvitationRow, MemberRow } from "@/components/team/member-row";
import { requireBusinessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPlan } from "@/services/billing/limits";
import { listTeam } from "@/services/team/team.service";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireBusinessContext();
  const canManage = ctx.can("staff.manage");
  const db = await createClient();
  const [{ members, invitations }, plan] = await Promise.all([listTeam(db, ctx.business.id, canManage), getPlan(db, ctx.business.id)]);

  const seatLimit = plan?.limits.staff ?? null;
  const seatsUsed = members.length + invitations.filter((i) => !i.expired).length;
  const atLimit = seatLimit !== null && seatsUsed >= seatLimit;

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
          <div>
            <h2 className="font-semibold">Members</h2>
            <p className="text-sm text-muted-foreground">
              {seatLimit === null ? `${seatsUsed} seats used` : `${seatsUsed} of ${seatLimit} seats used on ${plan?.name}`}
              {atLimit && " — upgrade to add more people"}
            </p>
          </div>
          {canManage && !atLimit && <InviteDialog businessName={ctx.business.name} canGrantAdmin={ctx.role === "owner"} />}
        </div>
        <ul className="divide-y">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} isSelf={m.userId === ctx.user.id} canManage={canManage} viewerIsOwner={ctx.role === "owner"} />
          ))}
        </ul>
      </section>

      {canManage && invitations.length > 0 && (
        <section className="rounded-xl border bg-card">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold">Invitations</h2>
          </div>
          <ul className="divide-y">
            {invitations.map((i) => (
              <InvitationRow key={i.id} invitation={i} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
