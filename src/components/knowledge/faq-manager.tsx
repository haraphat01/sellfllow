"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { deleteFaqAction, saveFaqAction, testFaqSearchAction } from "@/app/(app)/settings/knowledge/actions";
import { Field } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/lib/use-form-action";

export type Faq = { id: string; question: string; answer: string; keywords: string[]; is_active: boolean; updated_at: string };

/** Questions most WhatsApp shops get — one click pre-fills the question. */
const STARTERS = [
  "Do you deliver outside our city?",
  "Can I pick up my order?",
  "What are your opening hours?",
  "How long does delivery take?",
  "Do you accept payment on delivery?",
  "Can I return or exchange an item?",
  "Do you do custom or bulk orders?",
  "Where is your shop located?",
];

function FaqForm({ faq, onDone, prefill }: { faq?: Faq; onDone: () => void; prefill?: string }) {
  const { state, pending, formProps } = useFormAction(saveFaqAction);
  const fe = state?.fieldErrors ?? {};
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Saved");
      onDone();
    } else if (state?.error) toast.error(state.error);
  }, [state, onDone]);

  return (
    <form {...formProps} className="grid gap-3 rounded-lg border bg-muted/30 p-4">
      {faq && <input type="hidden" name="id" value={faq.id} />}
      <Field label="Question (as a customer would ask it)" name="question" defaultValue={faq?.question ?? prefill ?? ""} placeholder="Do you deliver to Ibadan?" errors={fe.question} />
      <div className="grid gap-2">
        <Label htmlFor={`a-${faq?.id ?? "new"}`}>Answer</Label>
        <Textarea
          id={`a-${faq?.id ?? "new"}`}
          name="answer"
          rows={3}
          defaultValue={faq?.answer ?? ""}
          placeholder="Yes — we deliver to Ibadan for ₦2,500 within 2–3 days via GIG."
          aria-invalid={fe.answer ? true : undefined}
        />
        {fe.answer && <p className="text-xs text-destructive">{fe.answer[0]}</p>}
      </div>
      <Field
        label="Other words customers use (optional, comma-separated)"
        name="keywords"
        defaultValue={faq?.keywords.join(", ") ?? ""}
        placeholder="waybill, send to Ibadan, park"
        errors={fe.keywords}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="isActive" defaultChecked={faq?.is_active ?? true} /> AI can use this answer
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {faq ? "Save" : "Add Q&A"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function TryIt() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ question: string; answer: string }[] | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2 font-medium">
        <Sparkles className="size-4 text-primary" /> Try it
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Type a question the way a customer would. This is what the AI finds.</p>
      <form
        method="post"
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await testFaqSearchAction(q);
            if (res.ok) setHits(res.data?.hits ?? []);
            else toast.error(res.error);
          });
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="abeg una dey deliver for ilorin?" />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />} Search
        </Button>
      </form>
      {hits && (
        <div className="mt-3 grid gap-2 text-sm">
          {hits.length === 0 ? (
            <p className="text-muted-foreground">Nothing found — the AI would say it isn’t sure and offer your team. Add a Q&A for this question.</p>
          ) : (
            hits.map((h, i) => (
              <div key={i} className="rounded-md bg-muted/50 p-3">
                <div className="font-medium">{h.question}</div>
                <div className="text-muted-foreground">{h.answer}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function FaqManager({ faqs, canManage }: { faqs: Faq[]; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | false>(false);
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? faqs.filter((x) => `${x.question} ${x.answer} ${x.keywords.join(" ")}`.toLowerCase().includes(f)) : faqs;
  }, [faqs, filter]);
  const existing = new Set(faqs.map((f) => f.question.toLowerCase()));

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_360px]">
      <section className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${faqs.length} Q&As…`} className="max-w-xs" />
          {canManage && !adding && (
            <Button onClick={() => setAdding("")}>
              <Plus /> Add Q&A
            </Button>
          )}
        </div>

        {canManage && adding !== false && <FaqForm prefill={adding} onDone={() => setAdding(false)} />}

        {faqs.length === 0 && adding === false && (
          <div className="rounded-xl border border-dashed bg-card p-6 text-sm">
            <p className="font-medium">Teach your AI the questions customers really ask</p>
            <p className="mt-1 text-muted-foreground">Start with these — click one, write your answer, save.</p>
            {canManage && (
              <div className="mt-4 flex flex-wrap gap-2">
                {STARTERS.map((q) => (
                  <Button key={q} variant="outline" size="sm" onClick={() => setAdding(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        <ul className="grid gap-3">
          {shown.map((f) =>
            editing === f.id ? (
              <li key={f.id}>
                <FaqForm faq={f} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={f.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {f.question}
                      {!f.is_active && <Badge variant="outline">Hidden from AI</Badge>}
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{f.answer}</p>
                    {f.keywords.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Also matches: {f.keywords.join(", ")}</p>}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(f.id)}>
                        <Pencil />
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        destructive
                        title="Delete this Q&A?"
                        description="The AI will stop using this answer."
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          const res = await deleteFaqAction(f.id);
                          if (res.ok) toast.success(res.message ?? "Deleted");
                          else toast.error(res.error);
                        }}
                      >
                        Delete
                      </ConfirmButton>
                    </div>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>

        {faqs.length > 0 && canManage && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Ideas:
            {STARTERS.filter((q) => !existing.has(q.toLowerCase()))
              .slice(0, 4)
              .map((q) => (
                <button key={q} type="button" className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted" onClick={() => setAdding(q)}>
                  {q}
                </button>
              ))}
          </div>
        )}
      </section>

      <aside className="grid gap-4 xl:sticky xl:top-20">
        <TryIt />
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How the AI uses this</p>
          <ul className="mt-2 grid list-disc gap-1 pl-4">
            <li>It searches these answers whenever a customer asks how your business works.</li>
            <li>It only repeats what you wrote — it won’t add details.</li>
            <li>Prices and stock still come from Products, and delivery fees from Settings → AI assistant.</li>
            <li>If nothing matches, it says it isn’t sure and offers your team.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
