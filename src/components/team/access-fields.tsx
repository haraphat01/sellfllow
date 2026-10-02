"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { STAFF_PRESETS } from "@/lib/validation/team";
import { cn } from "@/lib/utils";

export const PERMISSION_LABELS: Record<Permission, string> = {
  "conversations.view": "View conversations",
  "conversations.reply": "Reply & take over from AI",
  "customers.view": "View customers",
  "customers.manage": "Edit customers & tags",
  "orders.view": "View orders & payments",
  "orders.manage": "Manage orders",
  "products.manage": "Manage products & stock",
  "analytics.view": "View analytics",
  "campaigns.manage": "Campaigns & follow-ups",
  "settings.manage": "Business, WhatsApp & AI settings",
  "staff.manage": "Manage team",
  "billing.manage": "Billing",
};

export type Access = { role: "admin" | "staff"; permissions: string[] };

export function AccessFields({ value, onChange, canGrantAdmin }: { value: Access; onChange: (v: Access) => void; canGrantAdmin: boolean }) {
  const toggle = (perm: string) =>
    onChange({ ...value, permissions: value.permissions.includes(perm) ? value.permissions.filter((p) => p !== perm) : [...value.permissions, perm] });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {(["staff", "admin"] as const).map((role) => (
          <button
            key={role}
            type="button"
            disabled={role === "admin" && !canGrantAdmin}
            onClick={() => onChange({ ...value, role })}
            className={cn(
              "rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              value.role === role ? "border-primary bg-accent/50 ring-1 ring-primary" : "hover:bg-muted",
            )}
          >
            <div className="font-medium capitalize">{role}</div>
            <div className="text-xs text-muted-foreground">{role === "admin" ? "Full access except ownership" : "Only the permissions you choose"}</div>
          </button>
        ))}
      </div>

      {value.role === "staff" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(STAFF_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => onChange({ ...value, permissions: [...preset.permissions] })}
                className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.map((perm) => (
              <label key={perm} className="flex items-center gap-2 text-sm">
                <Checkbox checked={value.permissions.includes(perm)} onChange={() => toggle(perm)} />
                {PERMISSION_LABELS[perm]}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
