"use client";

import { useEffect, useRef } from "react";

/** Keeps the thread scrolled to the newest message when it changes. */
export function ScrollAnchor({ signature }: { signature: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [signature]);
  return <div ref={ref} />;
}
