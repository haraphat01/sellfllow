import { cn } from "@/lib/utils";

export function StatCard({ label, value, hint, emphasis = false }: { label: string; value: string; hint?: string; emphasis?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", emphasis && "border-primary/20 bg-accent/40")}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="tabular mt-2 text-[28px] leading-none font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
