import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/auth-forms";
import { safeNextPath } from "@/lib/security/redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-2 mb-8 text-sm text-muted-foreground">Sign in to your SellFlow dashboard.</p>
      <LoginForm next={safeNextPath(next)} error={typeof error === "string" ? error : undefined} />
    </>
  );
}
