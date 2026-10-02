import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Join team" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await requireUser();
  const db = await createClient();
  const { data } = await db.rpc("get_invitation", { p_token: token });
  const inv = data?.[0];

  let body: React.ReactNode;
  if (!inv) {
    body = <p className="text-muted-foreground">This invitation link is invalid. Ask the person who invited you for a new one.</p>;
  } else if (inv.accepted) {
    body = <p className="text-muted-foreground">This invitation has already been used.</p>;
  } else if (inv.expired) {
    body = <p className="text-muted-foreground">This invitation expired. Ask {inv.business_name} to send a new one.</p>;
  } else if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    body = (
      <div className="grid gap-4">
        <p className="text-muted-foreground">
          This invitation is for <span className="font-medium text-foreground">{inv.email}</span>, but you’re signed in as{" "}
          <span className="font-medium text-foreground">{user.email}</span>.
        </p>
        <form action="/auth/signout" method="post">
          <Button variant="outline" type="submit" className="w-full">
            Sign out and switch account
          </Button>
        </form>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-6">
        <p className="text-muted-foreground">
          You’ve been invited to join <span className="font-medium text-foreground">{inv.business_name}</span> as{" "}
          <span className="font-medium text-foreground">{inv.role === "admin" ? "an admin" : "a team member"}</span>.
        </p>
        <AcceptButton token={token} />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <Link href="/" className="mb-8">
        <Logo />
      </Link>
      <div className="w-full max-w-md rounded-xl border bg-card p-8">
        <h1 className="mb-3 text-xl font-semibold">{inv ? `Join ${inv.business_name}` : "Team invitation"}</h1>
        {body}
      </div>
    </main>
  );
}
