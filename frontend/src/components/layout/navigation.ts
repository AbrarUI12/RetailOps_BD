import {
  Bell,
  Boxes,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  Settings,
  ShoppingBag,
  Truck,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";

import type { WorkspaceCounts } from "../../lib/api";
import type { Permission } from "../../lib/permissions";

export interface NavItem {
  label: string;
  shortLabel?: string;
  to: string;
  icon: LucideIcon;
  /** The role must hold this to see the item; the route guard checks the same permission. */
  permission: Permission;
  badge?: keyof WorkspaceCounts;
  /** Badge tone: alerts (conflicts) are red, workload counts are neutral. */
  alert?: boolean;
}

export const primaryNavigation: NavItem[] = [
  { label: "Overview", to: "/dashboard", icon: LayoutDashboard, permission: "product:read" },
  { label: "Point of sale", shortLabel: "POS", to: "/pos", icon: CircleDollarSign, permission: "sale:create" },
  { label: "Orders", to: "/orders", icon: ClipboardList, permission: "order:read", badge: "orders_to_action" },
  { label: "Products", to: "/products", icon: ShoppingBag, permission: "product:read" },
  { label: "Inventory", shortLabel: "Stock", to: "/inventory", icon: Boxes, permission: "inventory:read", badge: "low_stock" },
  { label: "Purchases", to: "/purchases", icon: Truck, permission: "purchase:write" },
  { label: "Customers", to: "/customers", icon: Users, permission: "customer:read" },
  { label: "Reports", to: "/reports", icon: ChartNoAxesCombined, permission: "report:read" },
];

export const systemNavigation: NavItem[] = [
  { label: "Sync Center", to: "/sync", icon: Wifi, permission: "sale:create", badge: "open_conflicts", alert: true },
  { label: "Activity", to: "/activity", icon: Bell, permission: "product:read" },
  { label: "Settings", to: "/settings", icon: Settings, permission: "settings:manage" },
];

export const allNavigation = [...primaryNavigation, ...systemNavigation];

/** Mobile bottom bar: the four most-used destinations the role can open, POS in the middle. */
export function mobileNavigation(visible: NavItem[]) {
  const preferred = ["/dashboard", "/orders", "/pos", "/inventory"];
  const picks = preferred.map((to) => visible.find((item) => item.to === to)).filter((item): item is NavItem => Boolean(item));
  for (const item of visible) {
    if (picks.length >= 4) break;
    if (!picks.includes(item)) picks.push(item);
  }
  return picks;
}
