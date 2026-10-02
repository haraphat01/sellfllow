"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/action-types";
import { useFormAction } from "@/lib/use-form-action";
import { INDUSTRIES } from "@/lib/validation/business";

export type BusinessProfileDefaults = Partial<{
  name: string;
  description: string | null;
  industry: string | null;
  country: string;
  currency: string;
  timezone: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  instagram: string;
  facebook: string;
  tiktok: string;
}>;

const TIMEZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Europe/London", "UTC"];
const COUNTRIES = [
  ["NG", "Nigeria"],
  ["GH", "Ghana"],
  ["KE", "Kenya"],
  ["ZA", "South Africa"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
];

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 border-t py-8 first:border-t-0 first:pt-0 md:grid-cols-[220px_1fr]">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}

export function BusinessProfileForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaults?: BusinessProfileDefaults;
  submitLabel: string;
}) {
  const { state, pending, formProps } = useFormAction(action);
  const fe = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Saved");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form {...formProps}>
      <Section title="Business" description="How customers know you. The AI agent introduces itself on behalf of this business.">
        <Field label="Business name" name="name" defaultValue={defaults.name} placeholder="Aisha Fashion" required errors={fe.name} />
        <div className="grid gap-2">
          <Label htmlFor="f-description">What do you sell?</Label>
          <Textarea
            id="f-description"
            name="description"
            defaultValue={defaults.description ?? ""}
            placeholder="Handmade leather bags and accessories, delivered across Lagos."
            rows={3}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="f-industry">Industry</Label>
          <NativeSelect id="f-industry" name="industry" defaultValue={defaults.industry ?? ""} required aria-invalid={fe.industry ? true : undefined}>
            <option value="" disabled>
              Choose an industry
            </option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </NativeSelect>
          {fe.industry && <p className="text-xs text-destructive">{fe.industry[0]}</p>}
        </div>
      </Section>

      <Section title="Region" description="Used for prices, payment currency and when automated follow-ups are allowed to send.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="f-country">Country</Label>
            <NativeSelect id="f-country" name="country" defaultValue={defaults.country ?? "NG"}>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="f-currency">Currency</Label>
            <NativeSelect id="f-currency" name="currency" defaultValue={defaults.currency ?? "NGN"}>
              {["NGN", "GHS", "KES", "ZAR", "USD"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="f-timezone">Timezone</Label>
            <NativeSelect id="f-timezone" name="timezone" defaultValue={defaults.timezone ?? "Africa/Lagos"}>
              {TIMEZONES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </Section>

      <Section title="Contact" description="Shown to customers when they ask how to reach you or where you are.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business phone" name="phone" type="tel" defaultValue={defaults.phone ?? ""} placeholder="+234 803 000 0000" errors={fe.phone} />
          <Field label="Website" name="website" type="url" defaultValue={defaults.website ?? ""} placeholder="https://" errors={fe.website} />
        </div>
        <Field label="Address" name="address" defaultValue={defaults.address ?? ""} placeholder="12 Herbert Macaulay Way, Yaba, Lagos" errors={fe.address} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Instagram" name="instagram" defaultValue={defaults.instagram ?? ""} placeholder="@aishafashion" />
          <Field label="Facebook" name="facebook" defaultValue={defaults.facebook ?? ""} placeholder="aishafashion" />
          <Field label="TikTok" name="tiktok" defaultValue={defaults.tiktok ?? ""} placeholder="@aishafashion" />
        </div>
      </Section>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" disabled={pending} size="lg">
          {pending && <Loader2 className="animate-spin" />} {submitLabel}
        </Button>
      </div>
    </form>
  );
}
