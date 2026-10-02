"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border bg-card px-6 py-16 text-center">
      <AlertTriangle className="mb-4 size-8 text-destructive" />
      <h2 className="font-semibold">Something went wrong</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        We couldn’t load this page. {error.digest && <span className="font-mono text-xs">Ref: {error.digest}</span>}
      </p>
      <Button className="mt-6" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
