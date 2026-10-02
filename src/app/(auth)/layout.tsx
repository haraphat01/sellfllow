import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="w-fit">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-12">{children}</div>
        </div>
        <p className="text-xs text-muted-foreground">
          By using SellFlow you agree to our{" "}
          <Link href="/terms" className="underline-offset-2 hover:text-foreground hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline-offset-2 hover:text-foreground hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-end">
        <div className="absolute top-12 right-12 left-12 grid grid-cols-2 gap-3 text-sm">
          {[
            ["Recovered this month", "₦384,500"],
            ["Conversion", "20.4%"],
            ["AI-assisted orders", "61"],
            ["Avg. reply time", "4s"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-4">
              <div className="text-sidebar-muted">{k}</div>
              <div className="tabular mt-1 text-2xl font-semibold text-white">{v}</div>
            </div>
          ))}
        </div>
        <blockquote className="max-w-md text-2xl leading-snug font-medium text-white">
          “Customers used to ask the price and disappear. Now they get an answer in seconds — and a reminder the next
          day.”
        </blockquote>
        <p className="mt-4 text-sm text-sidebar-muted">Illustrative example of a SellFlow merchant dashboard.</p>
      </aside>
    </div>
  );
}
