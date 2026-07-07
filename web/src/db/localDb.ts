import Dexie, { type Table } from "dexie";

export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  price: number;
  stockQty: number;
  lowStockThreshold: number;
}

export interface PendingSaleItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export type SyncStatus = "pending" | "synced" | "error";

export interface PendingSale {
  clientId: string; // stable id generated on device, used as idempotency key on sync
  items: PendingSaleItem[];
  paymentMethod: "CASH" | "MPESA" | "CARD" | "BANK" | "SPLIT" | "CREDIT";
  amountTendered?: number;
  status: "HELD" | "COMPLETED";
  createdAt: string;
  syncStatus: SyncStatus;
  syncError?: string;
  customerId?: string;
  couponCode?: string;
}

class LocalDb extends Dexie {
  products!: Table<CachedProduct, string>;
  pendingSales!: Table<PendingSale, string>;

  constructor() {
    super("anakel-pos");
    this.version(1).stores({
      products: "id, name, sku, barcode",
      pendingSales: "clientId, syncStatus, createdAt",
    });
  }
}

export const localDb = new LocalDb();

export function newClientId(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}
