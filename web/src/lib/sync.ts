import { api, ApiError } from "./api";
import { localDb, type CachedProduct, type PendingSale } from "../db/localDb";

interface ServerProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string | number;
  stockQty: number;
  lowStockThreshold: number;
  category: { name: string } | null;
}

// Pulls the current catalog down so checkout can search/price products with
// no connection. Called on login and whenever the app comes back online.
export async function refreshProductCache(): Promise<void> {
  const products = await api.get<ServerProduct[]>("/api/products");
  const cached: CachedProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    categoryName: p.category?.name ?? null,
    price: Number(p.price),
    stockQty: p.stockQty,
    lowStockThreshold: p.lowStockThreshold,
  }));

  await localDb.transaction("rw", localDb.products, async () => {
    await localDb.products.clear();
    await localDb.products.bulkPut(cached);
  });
}

export async function queueSale(sale: Omit<PendingSale, "syncStatus" | "syncError">): Promise<void> {
  await localDb.pendingSales.put({ ...sale, syncStatus: "pending" });
  if (navigator.onLine) {
    void flushPendingSales();
  }
}

let flushing = false;

// Idempotent via clientId server-side, so re-running this after a partial
// failure (e.g. network drops mid-flush) never double-books a sale.
export async function flushPendingSales(): Promise<{ synced: number; failed: number }> {
  if (flushing) return { synced: 0, failed: 0 };
  flushing = true;
  let synced = 0;
  let failed = 0;

  try {
    const pending = await localDb.pendingSales.where("syncStatus").anyOf("pending", "error").toArray();
    for (const sale of pending) {
      try {
        await api.post("/api/sales", {
          clientId: sale.clientId,
          items: sale.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          paymentMethod: sale.paymentMethod,
          amountTendered: sale.amountTendered,
          status: sale.status,
          createdAt: sale.createdAt,
          customerId: sale.customerId,
          couponCode: sale.couponCode,
        });
        await localDb.pendingSales.update(sale.clientId, { syncStatus: "synced" });
        synced++;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Network error";
        await localDb.pendingSales.update(sale.clientId, { syncStatus: "error", syncError: message });
        failed++;
      }
    }
  } finally {
    flushing = false;
  }

  return { synced, failed };
}

export function registerSyncListeners(): () => void {
  const handler = () => void flushPendingSales();
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}
