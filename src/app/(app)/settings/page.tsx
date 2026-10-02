import type { Metadata } from "next";

import { BusinessProfileForm } from "@/components/business/business-profile-form";
import { requireBusinessContext } from "@/lib/auth/session";

import { updateBusinessAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireBusinessContext();
  const b = ctx.business;
  const social = (b.social_links ?? {}) as Record<string, string>;

  return (
    <section className="rounded-xl border bg-card p-6 sm:p-8">
      {ctx.can("settings.manage") ? (
        <BusinessProfileForm
          action={updateBusinessAction}
          submitLabel="Save changes"
          defaults={{
            name: b.name,
            description: b.description,
            industry: b.industry,
            country: b.country,
            currency: b.currency,
            timezone: b.timezone,
            phone: b.phone,
            address: b.address,
            website: b.website,
            instagram: social.instagram,
            facebook: social.facebook,
            tiktok: social.tiktok,
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">You don’t have permission to change business settings.</p>
      )}
    </section>
  );
}
