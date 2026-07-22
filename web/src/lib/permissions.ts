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

export interface PermissionCatalogEntry {
  category: string;
  key: PermissionKey;
  label: string;
}
