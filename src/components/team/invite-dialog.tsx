"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { inviteMemberAction } from "@/app/(app)/settings/team/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AccessFields, type Access } from "./access-fields";

export function InviteDialog({ businessName, canGrantAdmin }: { businessName: string; canGrantAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [access, setAccess] = useState<Access>({ role: "staff", permissions: ["conversations.view", "conversations.reply", "customers.view", "orders.view"] });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setEmail("");
    setInviteUrl(null);
    setCopied(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await inviteMemberAction({ email, ...access });
      if (!res.ok) toast.error(res.error);
      else setInviteUrl(res.inviteUrl);
    });
  };

  const shareText = inviteUrl ? `You've been invited to join ${businessName} on SellFlow: ${inviteUrl}` : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        {inviteUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation created</DialogTitle>
              <DialogDescription>
                Send this link to <span className="font-medium text-foreground">{email.trim().toLowerCase()}</span>. It works once, for that email address, and expires in 7 days. We
                won’t show it again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" asChild>
                <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
                  Share on WhatsApp
                </a>
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form method="post" onSubmit={submit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Invite a team member</DialogTitle>
              <DialogDescription>They’ll join {businessName} with the access you choose.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" autoFocus />
            </div>
            <AccessFields value={access} onChange={setAccess} canGrantAdmin={canGrantAdmin} />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Create invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
