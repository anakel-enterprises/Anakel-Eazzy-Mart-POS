import Dexie, { type Table } from "dexie";
import type { AuthUser } from "../types/auth";

export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: number;
  cost: number | null;
  stockQty: number;
  lowStockThreshold: number;
}

// Mirrors the customer fields Checkout actually needs to search, display,
// and (server-side, once synced) price a credit sale by tier — cached the
// same way products are, so credit sales work with zero connectivity.
export interface CachedCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  type: "RETAIL" | "WHOLESALE" | "VIP";
  creditLimit: number;
  creditBalance: number;
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
  // The JWT of whoever actually rang this sale up, captured at the moment
  // it's queued. A device shared across a shift can easily have a sale still
  // pending sync when a different employee (or the admin) logs in on it
  // before that sync fires — flushing with *that* person's token would
  // silently misattribute the sale to them in "sales by employee" reports.
  // Sent explicitly on sync instead of relying on whatever token happens to
  // be the active session's at the time. Optional only for rows queued
  // before this field existed.
  authToken?: string;
  // The real server-assigned Sale id, set once this row's POST actually
  // succeeds. Undoing a sale after it's synced needs this to call
  // POST /api/sales/:id/void — the clientId is only meaningful locally.
  serverId?: string;
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
  // True only when `createdAt` was deliberately set to an earlier date via
  // Checkout's backdate control (requires BACKDATE_SALES — see server's
  // POST /api/sales) — never set for the ordinary offline-sync case where
  // createdAt legitimately predates now just because the device was offline.
  backdated?: boolean;
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

// A product created offline, queued for POST /api/products. Its `clientId`
// doubles as the product's `id` in the `products` cache until it syncs (see
// newLocalProductId/isLocalProductId) — that's what lets it show up and be
// sellable at Checkout immediately, with no separate "unsynced products"
// overlay to merge in.
export interface PendingProduct {
  clientId: string;
  name: string;
  sku: string;
  barcode?: string;
  categoryId?: string;
  categoryName?: string | null;
  price: number;
  wholesalePrice?: number;
  vipPrice?: number;
  cost?: number;
  stockQty: number;
  lowStockThreshold: number;
  createdAt: string;
  syncStatus: SyncStatus;
  syncError?: string;
}

// A customer created offline — during a credit sale's inline "add customer"
// at Checkout, most commonly. Same shape as PendingProduct: `clientId`
// doubles as the customer's `id` in the `customers` cache until it syncs
// (see newLocalCustomerId/isLocalCustomerId), so it's immediately
// selectable for the credit sale being rung up right now, with no separate
// "unsynced customers" overlay to merge in.
export interface PendingCustomer {
  clientId: string;
  name: string;
  phone?: string;
  email?: string;
  type: "RETAIL" | "WHOLESALE" | "VIP";
  creditLimit: number;
  createdAt: string;
  syncStatus: SyncStatus;
  syncError?: string;
}

// An edit to a product that already has a real server id, queued for PUT
// /api/products/:id. Keyed by productId (not a generated clientId) so a
// second edit made before the first has synced simply overwrites this row —
// only the latest field values matter, same as the PUT itself. Editing a
// product that's still only a PendingProduct (no server id yet) never
// creates one of these — it patches that PendingProduct row directly
// instead, since there's nothing to PUT against until it exists server-side.
export interface PendingProductEdit {
  productId: string;
  name?: string;
  categoryId?: string | null;
  price?: number;
  cost?: number;
  lowStockThreshold?: number;
  updatedAt: string;
  syncStatus: SyncStatus;
  syncError?: string;
}

// A stock adjustment against a product that already has a real server id,
// queued for POST /api/products/:id/adjustments. Unlike PendingProductEdit,
// each one is its own row (not coalesced by productId) — the server keeps a
// StockAdjustment audit trail of individual events, so two offline restocks
// of +50 and -3 need to arrive as two rows, not a single net +47.
export interface PendingStockAdjustment {
  clientId: string;
  productId: string;
  quantityDelta: number;
  reason: "RECEIVED_STOCK" | "DAMAGE" | "THEFT_LOSS" | "RECOUNT" | "MANUAL_CORRECTION";
  notes?: string;
  createdAt: string;
  syncStatus: SyncStatus;
  syncError?: string;
  // Same reasoning as PendingSale.authToken — a shared device can sync this
  // under a different, currently-logged-in user otherwise, misattributing
  // who actually made the stock change.
  authToken?: string;
}

// A delete of a product that already has a real server id, queued for
// DELETE /api/products/:id (a soft delete server-side). Keyed by productId —
// there's only ever one meaningful delete per product. A product that's
// still only a PendingProduct never creates one of these: deleting it just
// cancels the pending create locally (see queueProductDelete), since the
// server has never heard of it.
export interface PendingProductDelete {
  productId: string;
  createdAt: string;
  syncStatus: SyncStatus;
  syncError?: string;
}

class LocalDb extends Dexie {
  products!: Table<CachedProduct, string>;
  pendingSales!: Table<PendingSale, string>;
  heldSales!: Table<HeldSale, string>;
  apiCache!: Table<CachedApiResponse, string>;
  offlineCredentials!: Table<OfflineCredential, string>;
  pendingProducts!: Table<PendingProduct, string>;
  pendingProductEdits!: Table<PendingProductEdit, string>;
  pendingStockAdjustments!: Table<PendingStockAdjustment, string>;
  pendingProductDeletes!: Table<PendingProductDelete, string>;
  customers!: Table<CachedCustomer, string>;
  pendingCustomers!: Table<PendingCustomer, string>;

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
    this.version(5).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
      heldSales: "id, createdAt",
      apiCache: "url",
      offlineCredentials: "email",
      pendingProducts: "clientId, syncStatus, createdAt",
      pendingProductEdits: "productId, syncStatus, updatedAt",
      pendingStockAdjustments: "clientId, productId, syncStatus, createdAt",
    });
    this.version(6).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
      heldSales: "id, createdAt",
      apiCache: "url",
      offlineCredentials: "email",
      pendingProducts: "clientId, syncStatus, createdAt",
      pendingProductEdits: "productId, syncStatus, updatedAt",
      pendingStockAdjustments: "clientId, productId, syncStatus, createdAt",
      pendingProductDeletes: "productId, syncStatus, createdAt",
    });
    this.version(7).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
      heldSales: "id, createdAt",
      apiCache: "url",
      offlineCredentials: "email",
      pendingProducts: "clientId, syncStatus, createdAt",
      pendingProductEdits: "productId, syncStatus, updatedAt",
      pendingStockAdjustments: "clientId, productId, syncStatus, createdAt",
      pendingProductDeletes: "productId, syncStatus, createdAt",
      customers: "id, name, phone",
      pendingCustomers: "clientId, syncStatus, createdAt",
    });
  }
}

export const localDb = new LocalDb();

export function newClientId(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

// Prefix marks an id as not-yet-synced to the server — a product created
// offline is stored (and sold, and edited) under this id from the moment
// it's added until its create actually reaches the server, at which point
// every reference to it is rewritten to the real server id (see
// remapLocalProductId in lib/sync.ts).
const LOCAL_PRODUCT_ID_PREFIX = "local_";

export function newLocalProductId(): string {
  return `${LOCAL_PRODUCT_ID_PREFIX}${newClientId()}`;
}

export function isLocalProductId(id: string): boolean {
  return id.startsWith(LOCAL_PRODUCT_ID_PREFIX);
}

// Same local-id-until-synced scheme as products, for a customer created
// offline (see remapLocalCustomerId in lib/sync.ts).
const LOCAL_CUSTOMER_ID_PREFIX = "localcust_";

export function newLocalCustomerId(): string {
  return `${LOCAL_CUSTOMER_ID_PREFIX}${newClientId()}`;
}

export function isLocalCustomerId(id: string): boolean {
  return id.startsWith(LOCAL_CUSTOMER_ID_PREFIX);
}
