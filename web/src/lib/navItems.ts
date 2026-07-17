import type { AuthUser } from "../types/auth";
import type { PermissionKey } from "./permissions";

export interface NavItem {
  to: string;
  label: string;
  letter: string;
  // Gated by a specific permission (ADMIN always bypasses), or by
  // adminOnly for the couple of screens that stay hard-locked to ADMIN
  // regardless of any permission toggle (employee & store management).
  permission?: PermissionKey;
  adminOnly?: boolean;
}

// Single source of truth for both the sidebar (which links to show) and
// routing (where to send someone who lands on a page they can't use) —
// Dashboard is gated by VIEW_REPORTS because its data actually is (see
// GET /api/reports/dashboard), even though it's every role's default
// landing route; keeping that requirement here instead of only on the
// server is what lets the frontend route around it instead of just
// failing the request.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", letter: "D", permission: "VIEW_REPORTS" },
  { to: "/checkout", label: "Checkout", letter: "C", permission: "MAKE_SALES" },
  { to: "/inventory", label: "Inventory", letter: "I", permission: "MANAGE_PRODUCTS" },
  { to: "/register", label: "Cash Register", letter: "R", permission: "MAKE_SALES" },
  { to: "/suppliers", label: "Suppliers", letter: "SU", permission: "MANAGE_SUPPLIERS" },
  { to: "/credit-sales", label: "Credit Sales", letter: "CR", permission: "MANAGE_CUSTOMERS" },
  { to: "/expenses", label: "Expenses & Income", letter: "E", permission: "MANAGE_EXPENSES" },
  { to: "/promotions", label: "Promotions", letter: "PR", permission: "MANAGE_PROMOTIONS" },
  { to: "/reports", label: "Reports", letter: "RP", permission: "VIEW_REPORTS" },
  { to: "/employees", label: "Employees", letter: "U", adminOnly: true },
  { to: "/settings", label: "Settings", letter: "S", adminOnly: true },
];

export function canAccess(item: NavItem, user: Pick<AuthUser, "role" | "permissions"> | null): boolean {
  if (!user) return false;
  const isAdmin = user.role === "ADMIN";
  if (item.adminOnly) return isAdmin;
  if (item.permission) return isAdmin || !!user.permissions?.[item.permission];
  return true;
}

// Where to send someone who can't use the page they're currently on (most
// commonly: landed on "/" without VIEW_REPORTS). Picks the first nav
// destination — in the order above — this user's actual permissions allow,
// skipping "/" itself since that's the page they're being routed away from.
// Returns null in the (unlikely) case a logged-in user has no accessible
// destination at all — e.g. every permission explicitly revoked.
export function firstAccessiblePath(user: Pick<AuthUser, "role" | "permissions"> | null): string | null {
  const candidate = NAV_ITEMS.find((item) => item.to !== "/" && canAccess(item, user));
  return candidate?.to ?? null;
}
