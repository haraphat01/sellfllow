import type { Metadata } from "next";

import { FaqManager } from "@/components/knowledge/faq-manager";
import { requireBusinessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listFaqs } from "@/services/knowledge/faqs.service";

export const metadata: Metadata = { title: "Q&A" };

export default async function KnowledgePage() {
  const ctx = await requireBusinessContext();
  const faqs = await listFaqs(await createClient(), ctx.business.id);
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-semibold">Questions & answers</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The questions your customers ask, answered in your words. Your AI assistant searches these before replying, so it knows your business — no training needed,
          and changes apply immediately.
        </p>
      </div>
      <FaqManager faqs={faqs} canManage={ctx.can("settings.manage")} />
    </div>
  );
}
