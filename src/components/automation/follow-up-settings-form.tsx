"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";

export type FollowUpDefaults = {
  enabled: boolean;
  delayValue: number;
  delayUnit: "minutes" | "hours" | "days";
  max: number;
  message: string;
  respectHours: boolean;
  windowStart: number;
  windowEnd: number;
  templateName: string;
  templateLanguage: string;
  attributionWindowHours: number;
};

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 border-t py-8 first-of-type:border-t-0 first-of-type:pt-0 md:grid-cols-[240px_1fr]">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}

const hourLabel = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

export function FollowUpSettingsForm({
  action,
  defaults,
  planAllows,
  timezone,
  defaultMessage,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  defaults: FollowUpDefaults;
  planAllows: boolean;
  timezone: string;
  defaultMessage: string;
}) {
  const { state, pending, formProps } = useFormAction(action);
  const fe = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form {...formProps} autoComplete="off">
      <Section title="Abandoned-lead recovery" description="Follow up with customers who showed buying intent but went quiet without paying.">
        <label className="flex items-start gap-3 rounded-lg border p-4">
          <Checkbox name="enabled" defaultChecked={defaults.enabled} className="mt-0.5" disabled={!planAllows && !defaults.enabled} />
          <span>
            <span className="block text-sm font-medium">Send automated follow-ups</span>
            <span className="block text-sm text-muted-foreground">
              {planAllows
                ? "Stops automatically when the customer pays, replies STOP, asks for a person, or your team takes over."
                : "Included from the Growth plan. Upgrade in Billing to turn this on."}
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
          <Field label="Wait after last message" name="delay_value" type="number" min={1} step={1} defaultValue={defaults.delayValue} errors={fe.delay_value} />
          <div className="grid gap-2">
            <Label htmlFor="f-delay_unit">Unit</Label>
            <NativeSelect id="f-delay_unit" name="delay_unit" defaultValue={defaults.delayUnit}>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="f-max">Max follow-ups per lead</Label>
            <NativeSelect id="f-max" name="max" defaultValue={String(defaults.max || 1)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="f-message">Message</Label>
          <Textarea id="f-message" name="message" rows={3} defaultValue={defaults.message} placeholder={defaultMessage} aria-invalid={fe.message ? true : undefined} />
          {fe.message ? (
            <p className="text-xs text-destructive">{fe.message[0]}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Use <code>{"{name}"}</code> and <code>{"{product}"}</code>. Leave empty for the default. It’s only sent while the product is in stock. Customers with an unpaid
              order get a payment reminder with their link instead.
            </p>
          )}
        </div>
      </Section>

      <Section title="Sending hours" description={`Follow-ups wait for this daily window (${timezone}). Replies from the AI aren’t affected.`}>
        <label className="flex items-center gap-3 text-sm">
          <Checkbox name="respect_hours" defaultChecked={defaults.respectHours} />
          Only send during these hours
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="f-window_start">From</Label>
            <NativeSelect id="f-window_start" name="window_start" defaultValue={String(defaults.windowStart)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="f-window_end">Until</Label>
            <NativeSelect id="f-window_end" name="window_end" defaultValue={String(defaults.windowEnd)} aria-invalid={fe.window_end ? true : undefined}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h === 24 ? "24:00" : hourLabel(h)}
                </option>
              ))}
            </NativeSelect>
            {fe.window_end && <p className="text-xs text-destructive">{fe.window_end[0]}</p>}
          </div>
        </div>
      </Section>

      <Section
        title="After 24 hours"
        description="WhatsApp only allows free-form messages within 24 hours of the customer’s last message. After that, SellFlow can send an approved template — or skip."
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field
            label="Approved template name (optional)"
            name="template_name"
            defaultValue={defaults.templateName}
            placeholder="cart_reminder"
            errors={fe.template_name}
            hint={<span className="text-xs text-muted-foreground">No variables</span>}
          />
          <Field label="Language" name="template_language" defaultValue={defaults.templateLanguage} placeholder="en" errors={fe.template_language} />
        </div>
        <p className="text-xs text-muted-foreground">Create and get the template approved in WhatsApp Manager (Marketing category). Without one, late follow-ups are skipped.</p>
      </Section>

      <Section title="Attribution" description="A paid order counts as a recovered sale if it’s paid within this window after a follow-up.">
        <div className="max-w-[200px]">
          <Field label="Window (hours)" name="attribution_window_hours" type="number" min={1} max={720} defaultValue={defaults.attributionWindowHours} errors={fe.attribution_window_hours} />
        </div>
      </Section>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save automation
        </Button>
      </div>
    </form>
  );
}
