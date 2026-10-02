"use client";

import { useState, useTransition } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { removeMemberAction, revokeInvitationAction, updateMemberAccessAction } from "@/app/(app)/settings/team/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Permission } from "@/lib/auth/permissions";

import { AccessFields, PERMISSION_LABELS, type Access } from "./access-fields";

function notify(res: { ok: boolean; error?: string; message?: string }) {
  if (res.ok) toast.success(res.message ?? "Done");
  else toast.error(res.error);
}

function Summary({ role, permissions }: { role: string; permissions: string[] }) {
  if (role === "owner") return <span>Full access · owns the business</span>;
  if (role === "admin") return <span>Full access</span>;
  return <span>{permissions.map((p) => PERMISSION_LABELS[p as Permission] ?? p).join(" · ") || "No permissions"}</span>;
}

export function MemberRow({
  member,
  isSelf,
  canManage,
  viewerIsOwner,
}: {
  member: { id: string; name: string | null; email: string | null; role: "owner" | "admin" | "staff"; permissions: string[] };
  isSelf: boolean;
  canManage: boolean;
  viewerIsOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<Access>({ role: member.role === "admin" ? "admin" : "staff", permissions: member.permissions });
  const [pending, startTransition] = useTransition();
  const editable = canManage && !isSelf && member.role !== "owner" && (member.role === "staff" || viewerIsOwner);

  return (
    <li className="flex flex-wrap items-center gap-4 px-6 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
        {(member.name ?? member.email ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {member.name ?? member.email ?? "Team member"} {isSelf && <span className="font-normal text-muted-foreground">(you)</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {member.email} · <Summary role={member.role} permissions={member.permissions} />
        </div>
      </div>
      <Badge variant={member.role === "owner" ? "default" : "secondary"} className="capitalize">
        {member.role}
      </Badge>
      {editable && (
        <div className="flex gap-1">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <Settings2 /> Access
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Access for {member.name ?? member.email}</DialogTitle>
                <DialogDescription>Changes apply immediately.</DialogDescription>
              </DialogHeader>
              <AccessFields value={access} onChange={setAccess} canGrantAdmin={viewerIsOwner} />
              <DialogFooter>
                <Button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await updateMemberAccessAction(member.id, access);
                      notify(res);
                      if (res.ok) setOpen(false);
                    })
                  }
                >
                  {pending && <Loader2 className="animate-spin" />} Save access
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ConfirmButton
            variant="ghost"
            size="sm"
            destructive
            title={`Remove ${member.name ?? member.email}?`}
            description="They’ll immediately lose access to this business. Conversations assigned to them stay in the inbox."
            confirmLabel="Remove"
            onConfirm={async () => notify(await removeMemberAction(member.id))}
          >
            Remove
          </ConfirmButton>
        </div>
      )}
    </li>
  );
}

export function InvitationRow({ invitation }: { invitation: { id: string; email: string; role: string; expired: boolean; expiresAt: string } }) {
  return (
    <li className="flex flex-wrap items-center gap-4 px-6 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{invitation.email}</div>
        <div className="text-xs text-muted-foreground">
          <span className="capitalize">{invitation.role}</span> ·{" "}
          {invitation.expired ? "expired — invite again to send a new link" : `expires ${new Date(invitation.expiresAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}`}
        </div>
      </div>
      <Badge variant={invitation.expired ? "destructive" : "warning"}>{invitation.expired ? "Expired" : "Pending"}</Badge>
      <ConfirmButton
        variant="ghost"
        size="sm"
        title="Revoke invitation?"
        description={`The link sent to ${invitation.email} will stop working.`}
        confirmLabel="Revoke"
        onConfirm={async () => notify(await revokeInvitationAction(invitation.id))}
      >
        Revoke
      </ConfirmButton>
    </li>
  );
}
