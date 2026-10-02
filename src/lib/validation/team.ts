import { z } from "zod";

import { PERMISSIONS } from "@/lib/auth/permissions";

export const STAFF_PRESETS = {
  sales_agent: {
    label: "Sales agent",
    description: "Handles conversations and orders.",
    permissions: ["conversations.view", "conversations.reply", "customers.view", "orders.view", "orders.manage"],
  },
  catalogue_manager: {
    label: "Catalogue manager",
    description: "Manages products and stock.",
    permissions: ["products.manage", "orders.view"],
  },
  analyst: {
    label: "Analyst",
    description: "Read-only reporting.",
    permissions: ["analytics.view", "orders.view", "customers.view", "conversations.view"],
  },
} as const;

export const memberAccessSchema = z
  .object({
    role: z.enum(["admin", "staff"]),
    permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]),
  })
  .transform((v) => ({ ...v, permissions: v.role === "admin" ? [] : Array.from(new Set(v.permissions)) }))
  .refine((v) => v.role === "admin" || v.permissions.length > 0, {
    message: "Give staff at least one permission",
    path: ["permissions"],
  });

export const inviteSchema = z
  .object({ email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")) })
  .and(memberAccessSchema);

export function accessFromForm(form: FormData) {
  return {
    role: form.get("role"),
    permissions: form.getAll("permissions").filter((p): p is string => typeof p === "string"),
  };
}
