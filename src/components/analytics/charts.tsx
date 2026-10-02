import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { percent } from "@/services/analytics/analytics.core";
import { cn } from "@/lib/utils";

export function RangeTabs({ active, ranges }: { active: string; ranges: readonly { key: string; label: string }[] }) {
  return (
    <nav className="inline-flex rounded-lg border bg-card p-0.5 text-sm" aria-label="Period">
      {ranges.map((r) => (
        <Link
          key={r.key}
          href={`?range=${r.key}`}
          aria-current={r.key === active ? "page" : undefined}
          className={cn("rounded-md px-3 py-1.5", r.key === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

export function Kpi({
  label,
  value,
  sub,
  delta,
  emphasis = false,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Relative change vs the previous period; undefined hides it. */
  delta?: number | null;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", emphasis && "border-primary/20 bg-accent/40")}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="tabular mt-2 text-[26px] leading-none font-semibold tracking-tight">{value}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {delta !== undefined &&
          (delta === null ? (
            <span>no prior data</span>
          ) : (
            <span className={cn("inline-flex items-center font-medium", delta >= 0 ? "text-success" : "text-destructive")}>
              {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {percent(Math.abs(delta), 0)}
            </span>
          ))}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

/** Daily bar chart; bars scale to the period's maximum. */
export function BarChart({
  data,
  format,
  label,
  tone = "primary",
}: {
  data: { key: string; label: string; value: number }[];
  format: (v: number) => string;
  label: string;
  tone?: "primary" | "signal";
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const every = Math.ceil(data.length / 8);
  return (
    <figure>
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={`${label}: total ${format(data.reduce((s, d) => s + d.value, 0))}`}>
        {data.map((d) => (
          <div key={d.key} className="group relative flex h-full flex-1 items-end" title={`${d.label}: ${format(d.value)}`}>
            <div
              className={cn("w-full rounded-t-sm transition-opacity group-hover:opacity-80", tone === "primary" ? "bg-primary" : "bg-signal", d.value === 0 && "bg-border")}
              style={{ height: max ? `${Math.max((d.value / max) * 100, d.value ? 2 : 1)}%` : "1%" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3px] text-[10px] text-muted-foreground">
        {data.map((d, i) => (
          <div key={d.key} className="flex-1 truncate text-center">
            {i % every === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Funnel({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const top = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <ol className="grid gap-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span>{s.label}</span>
              <span className="tabular font-medium">
                {s.value.toLocaleString()}
                {prev !== null && prev > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{percent(s.value / prev, 0)} of previous</span>}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min((s.value / top) * 100, 100)}%` }} />
            </div>
            {s.hint && <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>}
          </li>
        );
      })}
    </ol>
  );
}
