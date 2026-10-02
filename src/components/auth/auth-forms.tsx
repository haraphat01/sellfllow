"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { signIn, signInWithGoogle, signUp, type AuthFormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

import { Field } from "./field";

function FormAlert({ state }: { state: AuthFormState }) {
  if (state?.error) return <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>;
  if (state?.message) return <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{state.message}</p>;
  return null;
}

function GoogleButton({ next }: { next?: string }) {
  return (
    <form action={signInWithGoogle}>
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      <Button type="submit" variant="outline" className="w-full">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
          <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3Z" />
          <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
        </svg>
        Continue with Google
      </Button>
    </form>
  );
}

function Divider() {
  return (
    <div className="relative my-6 text-center text-xs text-muted-foreground">
      <span className="relative z-10 bg-background px-2">or with email</span>
      <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
    </div>
  );
}

export function LoginForm({ next, error }: { next?: string; error?: string }) {
  const [state, action, pending] = useActionState(signIn, error ? { error } : undefined);
  return (
    <>
      <GoogleButton next={next} />
      <Divider />
      <form action={action} className="grid gap-4">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <FormAlert state={state} />
        <Field label="Email" name="email" type="email" autoComplete="email" required errors={state?.fieldErrors?.email} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required errors={state?.fieldErrors?.password} />
        <Button type="submit" disabled={pending} className="mt-2 w-full">
          {pending && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to SellFlow?{" "}
        <Link href={next && next !== "/dashboard" ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signUp, undefined);
  return (
    <>
      <GoogleButton next={next ?? "/onboarding"} />
      <Divider />
      <form action={action} className="grid gap-4">
        <input type="hidden" name="next" value={next ?? "/onboarding"} />
        <FormAlert state={state} />
        <Field label="Your name" name="fullName" autoComplete="name" required errors={state?.fieldErrors?.fullName} />
        <Field label="Work email" name="email" type="email" autoComplete="email" required errors={state?.fieldErrors?.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          errors={state?.fieldErrors?.password}
        />
        <Button type="submit" disabled={pending} className="mt-2 w-full">
          {pending && <Loader2 className="animate-spin" />} Create account
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">14-day free trial on the Starter plan. No card required.</p>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={next && next !== "/onboarding" ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
