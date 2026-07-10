import { api, ApiError, isApiReachable } from "./api";
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
// no connection. Called on login, whenever the app comes back online, and
// periodically while online (see startBackgroundSync) so prices/stock/new
// promotions don't go stale across a long open session.
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
  void flushPendingSales();
}

let flushing = false;

// Idempotent via clientId server-side, so re-running this after a partial
// failure (e.g. network drops mid-flush) never double-books a sale. Checks
// real reachability first rather than trusting navigator.onLine, which only
// reports whether some network interface is up — a device can be "online"
// on a WiFi router with no actual internet, or mid-captive-portal.
export async function flushPendingSales(): Promise<{ synced: number; failed: number }> {
  if (flushing) return { synced: 0, failed: 0 };
  flushing = true;
  let synced = 0;
  let failed = 0;

  try {
    if (!(await isApiReachable())) return { synced: 0, failed: 0 };

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
          splitPayments: sale.splitPayments,
        });
        await localDb.pendingSales.update(sale.clientId, { syncStatus: "synced" });
        synced++;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Network error";
        await localDb.pendingSales.update(sale.clientId, { syncStatus: "error", syncError: message });
        failed++;
      }
    }

    if (synced > 0) void refreshProductCache();
  } finally {
    flushing = false;
  }

  return { synced, failed };
}

const RETRY_INTERVAL_MS = 25_000;
const CACHE_REFRESH_INTERVAL_MS = 5 * 60_000;

// Two things browser 'online'/'offline' events don't cover: connectivity
// that flickers back without a fresh event firing (the tab was already
// "online" per navigator.onLine the whole time), and a stock/price catalog
// that quietly drifts stale over a long open session. Both are handled by
// polling on a timer instead of relying solely on events.
export function startBackgroundSync(): () => void {
  const onlineHandler = () => void flushPendingSales();
  window.addEventListener("online", onlineHandler);

  let lastCacheRefresh = 0;
  const interval = setInterval(() => {
    void flushPendingSales();
    const now = Date.now();
    if (now - lastCacheRefresh > CACHE_REFRESH_INTERVAL_MS) {
      lastCacheRefresh = now;
      void isApiReachable().then((reachable) => {
        if (reachable) {
          void refreshProductCache();
        }
      });
    }
  }, RETRY_INTERVAL_MS);

  return () => {
    window.removeEventListener("online", onlineHandler);
    clearInterval(interval);
  };
}
