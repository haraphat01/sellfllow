import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Package,
  Settings,
  ShoppingBag,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/lib/auth/permissions";

export type NavItem = { href: string; label: string; icon: LucideIcon; perm?: Permission };

export const NAV_SECTIONS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/conversations", label: "Conversations", icon: MessagesSquare, perm: "conversations.view" },
      { href: "/orders", label: "Orders", icon: ShoppingBag, perm: "orders.view" },
    ],
  },
  {
    label: "Sell",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/customers", label: "Customers", icon: Users, perm: "customers.view" },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, perm: "campaigns.manage" },
      { href: "/analytics", label: "Analytics", icon: BarChart3, perm: "analytics.view" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/billing", label: "Billing", icon: CreditCard, perm: "billing.manage" },
    ],
  },
];
