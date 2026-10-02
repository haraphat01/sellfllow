import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, MessageCircle, ShieldCheck, UserRoundCheck, Zap } from "lucide-react";

import { EmbeddedSignupButton } from "@/components/whatsapp/embedded-signup-button";
import { DisconnectButton, ManualConnectForm, RegisterNumberForm, TestMessageForm } from "@/components/whatsapp/account-panels";
import { Badge } from "@/components/ui/badge";
import { requireBusinessContext } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import { listWhatsAppAccounts } from "@/services/whatsapp/accounts.service";

export const metadata: Metadata = { title: "WhatsApp" };

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  connected: { label: "Connected", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  error: { label: "Needs attention", variant: "destructive" },
  disconnected: { label: "Disconnected", variant: "secondary" },
};

export default async function WhatsAppSettingsPage() {
  const ctx = await requireBusinessContext();
  const accounts = await listWhatsAppAccounts(await createClient(), ctx.business.id);
  const env = serverEnv();
  const canManage = ctx.can("settings.manage");
  const signupReady = Boolean(env.META_APP_ID && env.META_CONFIG_ID && env.META_APP_SECRET);
  const platformReady = Boolean(env.META_APP_SECRET && env.META_VERIFY_TOKEN && env.CREDENTIALS_ENCRYPTION_KEY);
  const active = accounts.filter((a) => a.status !== "disconnected");

  return (
    <div className="grid gap-6">
      {!platformReady && (
        <div className="flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-[oklch(0.5_0.12_70)]" />
          <div>
            <div className="font-medium">WhatsApp isn’t configured on this SellFlow installation</div>
            <p className="mt-1 text-muted-foreground">
              The platform operator needs to set <code>META_APP_SECRET</code>, <code>META_VERIFY_TOKEN</code> and <code>CREDENTIALS_ENCRYPTION_KEY</code> (and{" "}
              <code>META_APP_ID</code> / <code>META_CONFIG_ID</code> for Embedded Signup). See WHATSAPP.md.
            </p>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <section className="rounded-xl border bg-card">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold">Connected numbers</h2>
          </div>
          <ul className="divide-y">
            {active.map((a) => {
              const s = STATUS[a.status] ?? STATUS.pending;
              return (
                <li key={a.id} className="grid gap-4 px-6 py-5">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex size-10 items-center justify-center rounded-full bg-[#25D366]/15">
                      <MessageCircle className="size-5 text-[#128C7E]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{a.display_phone_number ?? a.phone_number_id}</div>
                      <div className="text-sm text-muted-foreground">
                        {a.verified_name ?? "—"} · Quality {a.quality_rating?.toLowerCase() ?? "unknown"} · Phone number ID {a.phone_number_id}
                      </div>
                    </div>
                    <Badge variant={s.variant}>{s.label}</Badge>
                    {canManage && <DisconnectButton accountId={a.id} number={a.display_phone_number ?? a.phone_number_id} />}
                  </div>
                  {a.last_error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{a.last_error}</p>}
                  {canManage && a.status === "error" && /registration/i.test(a.last_error ?? "") && <RegisterNumberForm accountId={a.id} />}
                  {canManage && a.status === "connected" && (
                    <div className="rounded-lg bg-muted/60 p-4">
                      <div className="mb-2 text-sm font-medium">Test the connection</div>
                      <p className="mb-3 text-sm text-muted-foreground">
                        We’ll send Meta’s pre-approved <code>hello_world</code> template. Reply from your phone and the message will appear in Conversations.
                      </p>
                      <TestMessageForm accountId={a.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {canManage && (
        <section className="rounded-xl border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold">{active.length ? "Connect another number" : "Connect your WhatsApp Business account"}</h2>
          <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <li className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>SellFlow receives customer messages through Meta’s official WhatsApp Business Platform.</span>
            </li>
            <li className="flex gap-2.5">
              <Zap className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>Your AI sales agent can respond automatically, day and night.</span>
            </li>
            <li className="flex gap-2.5">
              <UserRoundCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>You can take over any conversation at any time.</span>
            </li>
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            {signupReady ? (
              <EmbeddedSignupButton appId={env.META_APP_ID!} configId={env.META_CONFIG_ID!} graphVersion={env.META_GRAPH_API_VERSION} />
            ) : (
              <p className="text-sm text-muted-foreground">Embedded Signup becomes available once the platform’s Meta app is configured.</p>
            )}
            {signupReady && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5" /> You’ll log in with Facebook and choose or create a WhatsApp Business number.
              </span>
            )}
          </div>
        </section>
      )}

      {canManage && (ctx.role === "owner" || ctx.role === "admin") && <ManualConnectForm />}

      {!canManage && active.length === 0 && (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No WhatsApp number is connected yet. Ask an owner or admin to connect one.</p>
      )}
    </div>
  );
}
