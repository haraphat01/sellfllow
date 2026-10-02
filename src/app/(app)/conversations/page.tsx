import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";

import { InboxShell } from "@/components/conversations/inbox-shell";
import { Button } from "@/components/ui/button";
import type { BusinessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Conversations" };

async function EmptyInbox({ ctx }: { ctx: BusinessContext }) {
  const { count } = await (await createClient())
    .from("whatsapp_accounts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", ctx.business.id)
    .eq("status", "connected");

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent">
        <MessagesSquare className="size-5 text-accent-foreground" />
      </div>
      {count ? (
        <>
          <h2 className="font-semibold">Select a conversation</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">New WhatsApp messages appear on the left in real time. Your AI agent replies automatically unless you take over.</p>
        </>
      ) : (
        <>
          <h2 className="font-semibold">Connect WhatsApp to start receiving messages</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Once your number is connected, every customer conversation shows up here.</p>
          {ctx.can("settings.manage") && (
            <Button className="mt-5" asChild>
              <Link href="/settings/whatsapp">Connect WhatsApp</Link>
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default async function ConversationsPage({ searchParams }: PageProps<"/conversations">) {
  return <InboxShell searchParams={await searchParams}>{(ctx) => <EmptyInbox ctx={ctx} />}</InboxShell>;
}
