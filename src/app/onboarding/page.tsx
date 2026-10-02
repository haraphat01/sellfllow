import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { BusinessProfileForm } from "@/components/business/business-profile-form";
import { getBusinessContext, requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

import { createBusinessAction } from "./actions";

export const metadata: Metadata = { title: "Set up your business" };

const STEPS = ["Account", "Business", "WhatsApp", "Products", "AI agent", "Payments", "Test"];

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await getBusinessContext()) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Logo />
          <form action="/auth/signout" method="post">
            <button className="text-sm text-muted-foreground hover:text-foreground">Sign out</button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <ol className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
          {STEPS.map((step, i) => {
            const done = i === 0;
            const current = i === 1;
            return (
              <li key={step} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                    done && "border-primary bg-primary text-primary-foreground",
                    current && "border-primary text-primary",
                    !done && !current && "text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={cn(current ? "font-medium" : "text-muted-foreground")}>{step}</span>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
              </li>
            );
          })}
        </ol>

        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome{user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}. Tell us about your business.
          </h1>
          <p className="mt-2 text-muted-foreground">
            This is what your AI sales agent will know about you. You can change it any time in Settings.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 sm:p-8">
          <BusinessProfileForm action={createBusinessAction} submitLabel="Create business" />
        </div>
      </main>
    </div>
  );
}
