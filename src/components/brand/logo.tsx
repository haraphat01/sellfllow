import { cn } from "@/lib/utils";

/** SellFlow mark: a speech bubble whose tail becomes an upward flow line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M9 21.5c-1.2-1.5-1.9-3.4-1.9-5.5C7.1 11 11.1 7.2 16 7.2S24.9 11 24.9 16"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
      <path
        d="M9.5 24.5 15 19l3.2 3.2L25 15.4"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-signal"
      />
    </svg>
  );
}

export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className={cn("text-[17px]", inverted ? "text-white" : "text-foreground")}>SellFlow</span>
    </span>
  );
}
