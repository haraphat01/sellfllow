import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { publicEnv } from "@/lib/env/public";

export const LEGAL_UPDATED = "1 October 2026";

/** Contact details for legal pages, from NEXT_PUBLIC_* env (never hard-coded). */
export function legalContact() {
  return {
    name: publicEnv.NEXT_PUBLIC_LEGAL_NAME,
    email: publicEnv.NEXT_PUBLIC_SUPPORT_EMAIL ?? null,
    address: publicEnv.NEXT_PUBLIC_COMPANY_ADDRESS ?? null,
    site: publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""),
  };
}

export function ContactEmail({ subject }: { subject?: string }) {
  const { email } = legalContact();
  if (!email) return <span className="rounded bg-destructive/10 px-1 text-destructive">[support email not configured]</span>;
  return (
    <a className="font-medium text-primary underline-offset-2 hover:underline" href={`mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}>
      {email}
    </a>
  );
}

export function LegalShell({ title, intro, sections, children }: { title: string; intro: React.ReactNode; sections: { id: string; title: string }[]; children: React.ReactNode }) {
  const { email } = legalContact();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" aria-label="SellFlow home">
            <Logo />
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/data-deletion" className="hover:text-foreground">
              Data deletion
            </Link>
          </nav>
        </div>
      </header>

      {!email && process.env.NODE_ENV !== "production" && (
        <p className="mx-auto mt-6 max-w-5xl rounded-lg border border-destructive/40 bg-destructive/10 px-5 py-3 text-sm text-destructive sm:mx-8 lg:mx-auto">
          Set <code>NEXT_PUBLIC_SUPPORT_EMAIL</code> (and ideally <code>NEXT_PUBLIC_COMPANY_ADDRESS</code>) before publishing these pages — Meta checks that they contain real contact details.
        </p>
      )}

      <main className="mx-auto grid max-w-5xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-8 grid gap-2 text-sm" aria-label="On this page">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">On this page</span>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">
                {s.title}
              </a>
            ))}
          </nav>
        </aside>
        <article className="legal max-w-none">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <div className="mt-6 text-[15px] leading-7 text-muted-foreground">{intro}</div>
          <div className="mt-8 grid gap-10 text-[15px] leading-7 [&_a]:text-primary [&_h2]:mb-3 [&_h2]:scroll-mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-medium [&_h3]:text-foreground [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </article>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-3 px-5 py-6 text-xs text-muted-foreground sm:px-8">
          <span>
            © {new Date().getFullYear()} {legalContact().name}
          </span>
          <span className="flex gap-4">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
