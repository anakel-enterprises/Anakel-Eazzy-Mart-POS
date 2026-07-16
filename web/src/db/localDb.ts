import Dexie, { type Table } from "dexie";
import type { AuthUser } from "../types/auth";

export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  price: number;
  cost: number | null;
  stockQty: number;
  lowStockThreshold: number;
}

export interface PendingSaleItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface SplitPaymentEntry {
  method: "CASH" | "MPESA" | "CARD" | "BANK";
  amount: number;
}

export type SyncStatus = "pending" | "synced" | "error";

export interface PendingSale {
  clientId: string; // stable id generated on device, used as idempotency key on sync
  items: PendingSaleItem[];
  paymentMethod: "CASH" | "MPESA_MANUAL" | "MPESA" | "CARD" | "BANK" | "SPLIT" | "CREDIT";
  amountTendered?: number;
  status: "COMPLETED";
  createdAt: string;
  syncStatus: SyncStatus;
  syncError?: string;
  customerId?: string;
  // Local-only — never sent to the server (which already knows the name via
  // the customerId relation). Kept here purely so the offline stats overlay
  // can show a customer's name in the Reports "Customers" tab before this
  // sale has synced, without needing a second lookup.
  customerName?: string;
  couponCode?: string;
  splitPayments?: SplitPaymentEntry[];
  // Only set for a standalone MPESA (STK push) sale — proves the STK push
  // for this amount already succeeded before the sale is allowed to
  // complete. Not used for MPESA_MANUAL, which is cashier-asserted.
  mpesaCheckoutRequestId?: string;
}

// Held sales never touch the server — a "hold" is a local pause-and-resume on
// this device, so it needs to work with zero connectivity.
export interface HeldSale {
  id: string;
  items: PendingSaleItem[];
  note?: string;
  createdAt: string;
}

// Last-known-good snapshot of a read-only GET response (dashboard/report
// stats), keyed by the exact request path including its query string —
// e.g. "/api/reports/finance?from=...&to=...". Lets Dashboard/Reports show
// something meaningful offline instead of an empty state, and is what
// distinguishes "no data yet" from "here's what we had last time we could
// reach the server."
export interface CachedApiResponse {
  url: string;
  data: unknown;
  cachedAt: string;
}

// Lets this device verify a login without contacting the server — written
// on every successful *online* login, so an idle-timeout, an explicit
// logout, or just reopening the app while offline never fully locks a
// cashier out of an offline-first POS. Never holds the plaintext password —
// only a salted PBKDF2 hash of it (see lib/offlineAuth.ts) — plus the most
// recently issued JWT for that user, which is what actually authenticates
// API calls once "logged in" this way.
export interface OfflineCredential {
  email: string; // lowercased, primary key
  salt: string; // hex
  hash: string; // hex, PBKDF2-SHA256
  iterations: number;
  token: string;
  user: AuthUser;
  updatedAt: string;
}

class LocalDb extends Dexie {
  products!: Table<CachedProduct, string>;
  pendingSales!: Table<PendingSale, string>;
  heldSales!: Table<HeldSale, string>;
  apiCache!: Table<CachedApiResponse, string>;
  offlineCredentials!: Table<OfflineCredential, string>;

  constructor() {
    super("anakel-pos");
    this.version(1).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
    });
    this.version(2).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
      heldSales: "id, createdAt",
    });
    this.version(3).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
      heldSales: "id, createdAt",
      apiCache: "url",
    });
    this.version(4).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
      heldSales: "id, createdAt",
      apiCache: "url",
      offlineCredentials: "email",
    });
  }
}

export const localDb = new LocalDb();

export function newClientId(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}
