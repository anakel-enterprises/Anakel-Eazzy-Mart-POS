import type { PermissionMap } from "../lib/permissions";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "CASHIER" | "STOREKEEPER" | "ACCOUNTANT";
  storeId: string;
  permissions: PermissionMap;
}
