import type { Role } from "@prisma/client";

export const PERMISSION_KEYS = [
  "MAKE_SALES",
  "MANAGE_CUSTOMERS",
  "VIEW_REPORTS",
  "MANAGE_PRODUCTS",
  "MANAGE_SUPPLIERS",
  "MANAGE_EXPENSES",
  "MANAGE_PROMOTIONS",
  "BACKDATE_SALES",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;

export const PERMISSION_CATALOG: { category: string; key: PermissionKey; label: string }[] = [
  { category: "Sales", key: "MAKE_SALES", label: "Can make sales & manage the cash register" },
  { category: "Sales", key: "MANAGE_CUSTOMERS", label: "Can view & manage customers / credit sales" },
  { category: "Sales", key: "VIEW_REPORTS", label: "Can view reports & sales totals" },
  { category: "Sales", key: "BACKDATE_SALES", label: "Can backdate a sale to an earlier date/time at checkout" },
  { category: "Stock", key: "MANAGE_PRODUCTS", label: "Can add/edit products, categories & stock" },
  { category: "Stock", key: "MANAGE_SUPPLIERS", label: "Can manage suppliers & purchases" },
  { category: "Finance", key: "MANAGE_EXPENSES", label: "Can approve expenses & record income" },
  { category: "Marketing", key: "MANAGE_PROMOTIONS", label: "Can create promotions & coupons" },
];

const allTrue: PermissionMap = {
  MAKE_SALES: true,
  MANAGE_CUSTOMERS: true,
  VIEW_REPORTS: true,
  MANAGE_PRODUCTS: true,
  MANAGE_SUPPLIERS: true,
  MANAGE_EXPENSES: true,
  MANAGE_PROMOTIONS: true,
  BACKDATE_SALES: true,
};

const allFalse: PermissionMap = {
  MAKE_SALES: false,
  MANAGE_CUSTOMERS: false,
  VIEW_REPORTS: false,
  MANAGE_PRODUCTS: false,
  MANAGE_SUPPLIERS: false,
  MANAGE_EXPENSES: false,
  MANAGE_PROMOTIONS: false,
  BACKDATE_SALES: false,
};

// Defaults applied when an employee's `permissions` column is null, i.e.
// they've never been individually customized. These mirror what each role
// could already do via the old fixed requireRole() checks.
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, PermissionMap> = {
  ADMIN: allTrue,
  MANAGER: allTrue,
  CASHIER: { ...allFalse, MAKE_SALES: true, MANAGE_CUSTOMERS: true },
  STOREKEEPER: { ...allFalse, MANAGE_PRODUCTS: true, MANAGE_SUPPLIERS: true },
  ACCOUNTANT: { ...allFalse, MANAGE_EXPENSES: true, MANAGE_SUPPLIERS: true, MANAGE_CUSTOMERS: true, VIEW_REPORTS: true },
};

export function resolvePermissions(role: Role, overrides: unknown): PermissionMap {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role];
  if (!overrides || typeof overrides !== "object") return defaults;
  const merged = { ...defaults };
  for (const key of PERMISSION_KEYS) {
    const value = (overrides as Record<string, unknown>)[key];
    if (typeof value === "boolean") merged[key] = value;
  }
  return merged;
}
