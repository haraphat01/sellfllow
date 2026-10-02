import type { Metadata } from "next";

import { SignupForm } from "@/components/auth/auth-forms";
import { safeNextPath } from "@/lib/security/redirect";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Start selling on autopilot</h1>
      <p className="mt-2 mb-8 text-sm text-muted-foreground">Create your SellFlow account. Setup takes about 10 minutes.</p>
      <SignupForm next={safeNextPath(next, "/onboarding")} />
    </>
  );
}
