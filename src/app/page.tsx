import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Check,
  ChevronRight,
  CreditCard,
  MessageCircle,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const messages = [
  { who: "customer", text: "Hi, is the black leather bag still available?" },
  { who: "agent", text: "It is, Sarah. It’s ₦45,000 and ready to ship. Want me to arrange delivery?" },
  { who: "customer", text: "Yes please, to Yaba" },
  { who: "agent", text: "Perfect. Your total is ₦48,000 with delivery. I’ve sent a secure payment link." },
];

const pillars = [
  { icon: PackageSearch, number: "01", title: "Grounded in your catalogue", body: "Current prices, stock and variants. The agent only recommends what you actually sell." },
  { icon: CreditCard, number: "02", title: "Orders that get paid", body: "Create an order in chat, send a Paystack link and confirm payment automatically." },
  { icon: BellRing, number: "03", title: "Follow-ups with good timing", body: "Bring interested buyers back with polite reminders that respect WhatsApp rules." },
  { icon: UserRoundCheck, number: "04", title: "Your team in control", body: "Step into any conversation. The agent pauses and your team takes it from there." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-[1320px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Logo />
        <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-3">
          <Link className="hidden px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground md:inline-flex" href="#platform">
            Platform
          </Link>
          <Link className="hidden px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground md:inline-flex" href="#how-it-works">
            How it works
          </Link>
          <Button variant="ghost" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button className="px-3 sm:px-4" asChild>
            <Link href="/signup">Get started <ArrowRight /></Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1320px] items-center gap-12 px-5 pt-10 pb-16 sm:px-8 sm:pt-16 sm:pb-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:px-12 lg:pt-14 lg:pb-24">
          <div className="landing-enter relative z-10 max-w-[550px]">
            <p className="mb-6 inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-signal text-signal-foreground">
                <ShieldCheck className="size-4" />
              </span>
              Official WhatsApp Business Platform
            </p>
            <h1 className="max-w-[620px] font-serif text-[46px] leading-[1.02] text-balance sm:text-[58px] lg:text-[68px]">
              Every chat can become a <span className="relative inline-block whitespace-nowrap text-primary">sale<span className="absolute right-0 -bottom-1 left-0 h-2 -rotate-1 bg-signal/80" /></span>
            </h1>
            <p className="mt-6 max-w-[490px] text-base leading-7 text-muted-foreground sm:text-lg">
              SellFlow gives your WhatsApp business a sales team that answers quickly, knows your products and follows through to payment.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button className="h-12 px-5" size="lg" asChild>
                <Link href="/signup">
                  Start your 14-day trial <ArrowRight />
                </Link>
              </Button>
              <Button className="h-12 px-4" size="lg" variant="ghost" asChild>
                <Link href="#how-it-works">See how it works <ChevronRight /></Link>
              </Button>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-primary" /> No card required</span>
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-primary" /> Set up at your pace</span>
            </div>
          </div>

          <div className="landing-enter landing-enter-delay relative min-w-0 lg:pl-3">
            <div className="absolute -top-7 right-5 z-10 hidden items-center gap-2 border border-border bg-background px-3 py-2 text-xs shadow-sm sm:flex">
              <span aria-hidden="true" className="status-pulse size-2 rounded-full bg-success" /> AI sales agent <span className="font-medium text-foreground">Online</span>
            </div>
            <div className="overflow-hidden border border-[#d6ddd5] bg-white shadow-[0_24px_70px_-40px_rgba(27,56,43,0.45)]">
              <div className="flex h-12 items-center justify-between border-b px-4 sm:px-5">
                <div className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
                  <MessageCircle className="size-4 text-primary" /> SellFlow inbox
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground sm:text-xs">
                  <span aria-hidden="true" className="status-pulse size-1.5 rounded-full bg-success" /> DEMO WORKSPACE
                </div>
              </div>
              <div className="grid min-h-[370px] sm:grid-cols-[0.72fr_1.28fr]">
                <aside className="hidden border-r bg-[#fbfcfa] sm:block">
                  <div className="flex h-12 items-center justify-between border-b px-4">
                    <span className="text-xs font-semibold">Conversations</span>
                    <span className="bg-[#e6f0e8] px-1.5 py-0.5 text-[10px] font-medium text-primary">12 new</span>
                  </div>
                  <div className="border-b bg-[#edf3ed] px-4 py-3">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold"><span>Sarah A.</span><span className="text-[10px] font-normal text-muted-foreground">now</span></div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">Payment link sent · AI active</p>
                  </div>
                  <div className="border-b px-4 py-3">
                    <div className="flex items-center justify-between gap-2 text-xs font-medium"><span>Chidi Okafor</span><span className="text-[10px] font-normal text-muted-foreground">2m</span></div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">Do you have this in blue?</p>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2 text-xs font-medium"><span>Amaka N.</span><span className="text-[10px] font-normal text-muted-foreground">8m</span></div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">Thanks, I’ll check out</p>
                  </div>
                </aside>

                <div className="flex min-w-0 flex-col">
                  <div className="flex h-12 items-center justify-between border-b px-4 sm:px-5">
                    <div>
                      <div className="text-xs font-semibold">Sarah A.</div>
                      <div className="text-[10px] text-muted-foreground">+234 803 ···· 091</div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 bg-[#e6f0e8] px-2 py-1 text-[10px] font-medium text-primary"><Sparkles className="size-3" /> AI handling</span>
                  </div>
                  <div className="flex-1 space-y-3 bg-[#f8faf7] px-4 py-4 sm:px-5 sm:py-5">
                    <p className="mb-4 text-center text-[10px] text-muted-foreground">TODAY · 10:42 AM</p>
                    {messages.map((message, index) => (
                      <div key={message.text} className={`landing-message landing-message-${index + 1} ${message.who === "customer" ? "max-w-[82%] border border-[#e4e8e2] bg-white px-3 py-2 text-xs leading-5" : "ml-auto max-w-[88%] bg-[#dff0df] px-3 py-2 text-xs leading-5 text-[#183d2d]"}`}>
                        {message.text}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground">ORDER SF-1042 · PAYSTACK</p>
                      <p className="tabular mt-0.5 text-sm font-semibold">₦48,000 <span className="font-normal text-muted-foreground">· payment pending</span></p>
                    </div>
                    <span className="shrink-0 border border-[#d8e4d7] bg-[#f5faf4] px-2 py-1 text-[10px] font-medium text-primary">Link sent</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-2 hidden items-center gap-3 border border-border bg-background px-4 py-3 shadow-sm sm:flex lg:-left-6">
              <span className="flex size-9 items-center justify-center bg-signal text-signal-foreground"><CreditCard className="size-4" /></span>
              <span><span className="block text-[10px] text-muted-foreground">Order created in chat</span><span className="block text-xs font-semibold">Payment verified by Paystack</span></span>
            </div>
          </div>
        </section>

        <section className="border-y bg-[#f1f4ee]" id="platform">
          <div className="mx-auto max-w-[1320px] px-5 py-14 sm:px-8 sm:py-16 lg:px-12">
            <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Built for the whole sale</p>
                <h2 className="max-w-xl font-serif text-3xl leading-tight sm:text-4xl">From first hello to paid order.</h2>
              </div>
              <Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href="/signup">Explore SellFlow <ArrowRight className="size-4" /></Link>
            </div>
            <div className="grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {pillars.map(({ icon: Icon, number, title, body }) => (
                <article key={title} className="border-t border-[#cbd5c9] pt-4">
                  <div className="mb-5 flex items-center justify-between">
                    <Icon className="size-5 text-primary" />
                    <span className="tabular text-xs text-muted-foreground">{number}</span>
                  </div>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1320px] items-center gap-7 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[1fr_auto] lg:px-12" id="how-it-works">
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Human-led, AI-assisted</p>
            <h2 className="font-serif text-3xl leading-tight sm:text-4xl">Your customers get an answer. Your team gets the final say.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">The agent works from your products and policies. Your people can step into any chat at any time, with automation pausing until they hand it back.</p>
          </div>
          <Button className="w-fit" size="lg" variant="outline" asChild>
            <Link href="/signup">Set up your workspace <ArrowRight /></Link>
          </Button>
        </section>
      </main>

      <footer className="border-t bg-[#f1f4ee]">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-5 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <span>© {new Date().getFullYear()} SellFlow</span>
          <span className="flex gap-4">
            <Link className="hover:text-foreground" href="/privacy">Privacy</Link>
            <Link className="hover:text-foreground" href="/terms">Terms</Link>
            <Link className="hover:text-foreground" href="/data-deletion">Data deletion</Link>
          </span>
          <Link className="font-medium text-foreground hover:text-primary" href="/login">Sign in <ArrowRight className="ml-1 inline size-3" /></Link>
        </div>
      </footer>
    </div>
  );
}
