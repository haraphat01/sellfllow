/** Mirrors public.permissions. Owners and admins implicitly hold all of them. */
export const PERMISSIONS = [
  "conversations.view",
  "conversations.reply",
  "customers.view",
  "customers.manage",
  "orders.view",
  "orders.manage",
  "products.manage",
  "analytics.view",
  "campaigns.manage",
  "settings.manage",
  "staff.manage",
  "billing.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type MemberRole = "owner" | "admin" | "staff";

export function hasPermission(role: MemberRole, granted: readonly string[], perm: Permission) {
  return role === "owner" || role === "admin" || granted.includes(perm);
}
