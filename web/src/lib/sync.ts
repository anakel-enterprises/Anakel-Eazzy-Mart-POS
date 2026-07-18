import { api, ApiError, getAuthToken, isApiReachable } from "./api";
import {
  localDb,
  isLocalProductId,
  newClientId,
  newLocalProductId,
  type CachedProduct,
  type PendingSale,
  type PendingProduct,
  type PendingStockAdjustment,
} from "../db/localDb";

interface ServerProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  price: string | number;
  cost: string | number | null;
  stockQty: number;
  lowStockThreshold: number;
  category: { name: string } | null;
}

// Pulls the current catalog down so checkout/inventory can search/price
// products with no connection. Called on login, whenever the app comes back
// online, and periodically while online (see startBackgroundSync) so
// prices/stock/new promotions don't go stale across a long open session.
// `cost` is cached too (unused by checkout itself) so the offline stats
// overlay can estimate COGS for the Profit/P&L/Analytics reports without a
// network round trip.
//
// Deliberately doesn't `clear()` the table first: a product created on this
// device while offline lives here under a local-only id (see
// isLocalProductId) until its own sync completes, and a refresh landing
// mid-flight must not make it vanish from Inventory/Checkout just because
// the server doesn't know about it yet. Only ids the server actually
// reports gone (genuinely deleted, or never local-only to begin with) get
// removed.
export async function refreshProductCache(): Promise<void> {
  const products = await api.get<ServerProduct[]>("/api/products");
  const cached: CachedProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    price: Number(p.price),
    cost: p.cost != null ? Number(p.cost) : null,
    stockQty: p.stockQty,
    lowStockThreshold: p.lowStockThreshold,
  }));
  const serverIds = new Set(cached.map((p) => p.id));

  await localDb.transaction("rw", localDb.products, async () => {
    const existingIds = (await localDb.products.toCollection().primaryKeys()) as string[];
    const staleIds = existingIds.filter((id) => !serverIds.has(id) && !isLocalProductId(id));
    if (staleIds.length > 0) await localDb.products.bulkDelete(staleIds);
    await localDb.products.bulkPut(cached);
  });
}

export async function queueSale(sale: Omit<PendingSale, "syncStatus" | "syncError" | "authToken">): Promise<void> {
  await localDb.pendingSales.put({ ...sale, authToken: getAuthToken() ?? undefined, syncStatus: "pending" });
  void flushPendingSales();
}

// Fired after a sync batch actually confirms at least one sale with the
// server. Dashboard/Reports listen for this in addition to the browser's own
// "online" event — "online" only means connectivity came back, not that any
// pending sale has actually finished syncing yet. A report's own "online"
// refetch can easily resolve *before* flushPendingSales' await chain (a
// reachability check, then each sale POSTed sequentially) finishes, which
// would otherwise cache a stale pre-sync number as if it were fresh, with no
// further trigger to correct it until the next real connectivity change.
export const SALES_SYNCED_EVENT = "pos:sales-synced";

let salesFlushInFlight: Promise<{ synced: number; failed: number }> | null = null;

// Idempotent via clientId server-side, so re-running this after a partial
// failure (e.g. network drops mid-flush) never double-books a sale. Checks
// real reachability first rather than trusting navigator.onLine, which only
// reports whether some network interface is up — a device can be "online"
// on a WiFi router with no actual internet, or mid-captive-portal.
//
// A second call made while one is already running returns *that* run's
// result instead of a stale no-op — several call sites (queueSale, the
// background timer, the "online" listener) can all fire this within
// milliseconds of each other, and none of them should silently skip a sale
// that was queued moments too late to make it into the batch already in
// flight.
export function flushPendingSales(): Promise<{ synced: number; failed: number }> {
  if (salesFlushInFlight) return salesFlushInFlight;
  salesFlushInFlight = doFlushPendingSales().finally(() => {
    salesFlushInFlight = null;
  });
  return salesFlushInFlight;
}

async function doFlushPendingSales(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  if (!(await isApiReachable())) return { synced: 0, failed: 0 };

  // A sale can reference a product that was itself created on this device
  // and hasn't synced yet (its id is still local-only) — make sure any such
  // create (and the id remap that follows it) has landed before attempting
  // to POST the sale, or the server will reject it as an unknown product.
  await flushPendingProducts();

  const pending = await localDb.pendingSales.where("syncStatus").anyOf("pending", "error").toArray();
  for (const sale of pending) {
    try {
      const payload = {
        clientId: sale.clientId,
        items: sale.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        paymentMethod: sale.paymentMethod,
        amountTendered: sale.amountTendered,
        status: sale.status,
        createdAt: sale.createdAt,
        customerId: sale.customerId,
        couponCode: sale.couponCode,
        splitPayments: sale.splitPayments,
        mpesaCheckoutRequestId: sale.mpesaCheckoutRequestId,
      };
      // Sync as whoever actually rang this up, not whoever happens to be
      // logged in on this device right now — see PendingSale.authToken.
      // Only rows queued before that field existed fall back to the
      // ambient session's token.
      if (sale.authToken) {
        await api.postAsUser("/api/sales", payload, sale.authToken);
      } else {
        await api.post("/api/sales", payload);
      }
      await localDb.pendingSales.update(sale.clientId, { syncStatus: "synced" });
      synced++;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Network error";
      await localDb.pendingSales.update(sale.clientId, { syncStatus: "error", syncError: message });
      failed++;
    }
  }

  if (synced > 0) {
    void refreshProductCache();
    window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
  }

  return { synced, failed };
}

export interface NewProductInput {
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
}

// Adding a product always goes through this queue, online or offline — it's
// the same "write locally first, sync after" shape as queueSale. The new
// product is immediately visible (and sellable at Checkout) under a
// local-only id (see newLocalProductId); once its create actually reaches
// the server, remapLocalProductId swaps every reference to it — the cached
// row itself, plus any not-yet-synced sale that already rang it up — over to
// the real server id.
export async function queueProductCreate(input: NewProductInput): Promise<string> {
  const clientId = newLocalProductId();
  const createdAt = new Date().toISOString();

  await localDb.transaction("rw", localDb.pendingProducts, localDb.products, async () => {
    await localDb.pendingProducts.put({ ...input, clientId, createdAt, syncStatus: "pending" });
    await localDb.products.put({
      id: clientId,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode ?? null,
      categoryId: input.categoryId ?? null,
      categoryName: input.categoryName ?? null,
      price: input.price,
      cost: input.cost ?? null,
      stockQty: input.stockQty,
      lowStockThreshold: input.lowStockThreshold,
    });
  });

  void flushPendingProducts();
  return clientId;
}

// Edits a product that's still only a queued PendingProduct (its create
// hasn't synced yet) by patching that row directly, rather than layering a
// separate PendingProductEdit on top of a create the server hasn't seen.
// There's nothing to PUT against until the create itself lands, so the next
// flush just sends the updated create payload.
export async function patchPendingProduct(
  clientId: string,
  patch: Partial<Omit<PendingProduct, "clientId" | "createdAt" | "syncStatus" | "syncError">>
): Promise<void> {
  await localDb.transaction("rw", localDb.pendingProducts, localDb.products, async () => {
    const existing = await localDb.pendingProducts.get(clientId);
    if (!existing) return;
    const updated: PendingProduct = { ...existing, ...patch };
    await localDb.pendingProducts.put(updated);
    await localDb.products.put({
      id: clientId,
      name: updated.name,
      sku: updated.sku,
      barcode: updated.barcode ?? null,
      categoryId: updated.categoryId ?? null,
      categoryName: updated.categoryName ?? null,
      price: updated.price,
      cost: updated.cost ?? null,
      stockQty: updated.stockQty,
      lowStockThreshold: updated.lowStockThreshold,
    });
  });

  void flushPendingProducts();
}

// Rewrites every local reference to a just-synced product from its
// temporary local id to the real id the server assigned. Runs as part of
// the same flush pass that confirmed the create, to keep the window where
// something could still be pointing at the old id as short as possible.
async function remapLocalProductId(oldId: string, newId: string): Promise<void> {
  await localDb.transaction("rw", localDb.products, localDb.pendingSales, async () => {
    const row = await localDb.products.get(oldId);
    if (row) {
      await localDb.products.put({ ...row, id: newId });
      await localDb.products.delete(oldId);
    }

    const affectedSales = await localDb.pendingSales.where("syncStatus").anyOf("pending", "error").toArray();
    for (const sale of affectedSales) {
      if (!sale.items.some((i) => i.productId === oldId)) continue;
      await localDb.pendingSales.update(sale.clientId, {
        items: sale.items.map((i) => (i.productId === oldId ? { ...i, productId: newId } : i)),
      });
    }
  });
}

let productsFlushInFlight: Promise<{ synced: number; failed: number }> | null = null;

// Same shared-in-flight-promise shape as flushPendingSales — a concurrent
// call (e.g. from doFlushPendingSales making sure creates land first, at
// the same moment the background timer also fires) awaits the run already
// in progress instead of getting a stale empty result back.
export function flushPendingProducts(): Promise<{ synced: number; failed: number }> {
  if (productsFlushInFlight) return productsFlushInFlight;
  productsFlushInFlight = doFlushPendingProducts().finally(() => {
    productsFlushInFlight = null;
  });
  return productsFlushInFlight;
}

async function doFlushPendingProducts(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  if (!(await isApiReachable())) return { synced: 0, failed: 0 };

  const pending = await localDb.pendingProducts.where("syncStatus").anyOf("pending", "error").toArray();
  for (const p of pending) {
    try {
      const created = await api.post<{ id: string }>("/api/products", {
        clientId: p.clientId,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        categoryId: p.categoryId,
        price: p.price,
        wholesalePrice: p.wholesalePrice,
        vipPrice: p.vipPrice,
        cost: p.cost,
        stockQty: p.stockQty,
        lowStockThreshold: p.lowStockThreshold,
      });
      await remapLocalProductId(p.clientId, created.id);
      await localDb.pendingProducts.update(p.clientId, { syncStatus: "synced" });
      synced++;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Network error";
      await localDb.pendingProducts.update(p.clientId, { syncStatus: "error", syncError: message });
      failed++;
    }
  }

  if (synced > 0) void refreshProductCache();

  return { synced, failed };
}

// Queues an edit to a product that already has a real server id. Applies
// optimistically to the cached row immediately so Inventory/Checkout reflect
// it right away, then overwrites any earlier not-yet-synced edit for the
// same product — only the latest values matter, same as the PUT it becomes.
export async function queueProductEdit(
  productId: string,
  patch: { name?: string; categoryId?: string | null; categoryName?: string | null; price?: number; cost?: number; lowStockThreshold?: number }
): Promise<void> {
  const { categoryName, ...serverPatch } = patch;

  await localDb.transaction("rw", localDb.pendingProductEdits, localDb.products, async () => {
    await localDb.pendingProductEdits.put({
      productId,
      ...serverPatch,
      updatedAt: new Date().toISOString(),
      syncStatus: "pending",
    });
    const existing = await localDb.products.get(productId);
    if (existing) {
      await localDb.products.put({
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
        ...(categoryName !== undefined ? { categoryName } : {}),
        ...(patch.price !== undefined ? { price: patch.price } : {}),
        ...(patch.cost !== undefined ? { cost: patch.cost } : {}),
        ...(patch.lowStockThreshold !== undefined ? { lowStockThreshold: patch.lowStockThreshold } : {}),
      });
    }
  });

  void flushPendingProductEdits();
}

let productEditsFlushInFlight: Promise<{ synced: number; failed: number }> | null = null;

export function flushPendingProductEdits(): Promise<{ synced: number; failed: number }> {
  if (productEditsFlushInFlight) return productEditsFlushInFlight;
  productEditsFlushInFlight = doFlushPendingProductEdits().finally(() => {
    productEditsFlushInFlight = null;
  });
  return productEditsFlushInFlight;
}

async function doFlushPendingProductEdits(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  if (!(await isApiReachable())) return { synced: 0, failed: 0 };

  const pending = await localDb.pendingProductEdits.where("syncStatus").anyOf("pending", "error").toArray();
  for (const e of pending) {
    try {
      await api.put(`/api/products/${e.productId}`, {
        name: e.name,
        categoryId: e.categoryId,
        price: e.price,
        cost: e.cost,
        lowStockThreshold: e.lowStockThreshold,
      });
      await localDb.pendingProductEdits.update(e.productId, { syncStatus: "synced" });
      synced++;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Network error";
      await localDb.pendingProductEdits.update(e.productId, { syncStatus: "error", syncError: message });
      failed++;
    }
  }

  if (synced > 0) void refreshProductCache();

  return { synced, failed };
}

// Queues a stock adjustment against a product that already has a real
// server id. Applies to the cached row's stockQty optimistically so the new
// count shows immediately, same as an edit.
export async function queueStockAdjustment(
  productId: string,
  quantityDelta: number,
  reason: PendingStockAdjustment["reason"],
  notes?: string
): Promise<void> {
  const clientId = newClientId();
  const createdAt = new Date().toISOString();

  await localDb.transaction("rw", localDb.pendingStockAdjustments, localDb.products, async () => {
    await localDb.pendingStockAdjustments.put({
      clientId,
      productId,
      quantityDelta,
      reason,
      notes,
      createdAt,
      syncStatus: "pending",
    });
    const existing = await localDb.products.get(productId);
    if (existing) {
      await localDb.products.put({ ...existing, stockQty: existing.stockQty + quantityDelta });
    }
  });

  void flushPendingStockAdjustments();
}

let stockAdjustmentsFlushInFlight: Promise<{ synced: number; failed: number }> | null = null;

export function flushPendingStockAdjustments(): Promise<{ synced: number; failed: number }> {
  if (stockAdjustmentsFlushInFlight) return stockAdjustmentsFlushInFlight;
  stockAdjustmentsFlushInFlight = doFlushPendingStockAdjustments().finally(() => {
    stockAdjustmentsFlushInFlight = null;
  });
  return stockAdjustmentsFlushInFlight;
}

async function doFlushPendingStockAdjustments(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  if (!(await isApiReachable())) return { synced: 0, failed: 0 };

  const pending = await localDb.pendingStockAdjustments.where("syncStatus").anyOf("pending", "error").toArray();
  for (const a of pending) {
    try {
      await api.post(`/api/products/${a.productId}/adjustments`, {
        quantityDelta: a.quantityDelta,
        reason: a.reason,
        notes: a.notes,
        clientId: a.clientId,
      });
      await localDb.pendingStockAdjustments.update(a.clientId, { syncStatus: "synced" });
      synced++;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Network error";
      await localDb.pendingStockAdjustments.update(a.clientId, { syncStatus: "error", syncError: message });
      failed++;
    }
  }

  if (synced > 0) void refreshProductCache();

  return { synced, failed };
}

// Deleting a product goes through this queue, online or offline, same as
// every other Inventory write. A product that's still only a
// PendingProduct (its own create hasn't synced yet) is simply cancelled —
// there's nothing server-side to delete yet — along with any edit or stock
// adjustment still queued against it. A product that already has a real
// server id is removed from the local cache immediately (so it disappears
// from Inventory/Checkout right away) and queues a DELETE, which the server
// applies as a soft delete; any not-yet-synced edit or adjustment for it is
// dropped too, since there's no point syncing a change to a product that's
// about to be deleted.
export async function queueProductDelete(productId: string): Promise<void> {
  if (isLocalProductId(productId)) {
    await localDb.transaction(
      "rw",
      localDb.products,
      localDb.pendingProducts,
      localDb.pendingProductEdits,
      localDb.pendingStockAdjustments,
      async () => {
        await localDb.products.delete(productId);
        await localDb.pendingProducts.delete(productId);
        await localDb.pendingProductEdits.delete(productId);
        await localDb.pendingStockAdjustments.where("productId").equals(productId).delete();
      }
    );
    return;
  }

  await localDb.transaction(
    "rw",
    localDb.products,
    localDb.pendingProductEdits,
    localDb.pendingStockAdjustments,
    localDb.pendingProductDeletes,
    async () => {
      await localDb.products.delete(productId);
      await localDb.pendingProductEdits.delete(productId);
      await localDb.pendingStockAdjustments.where("productId").equals(productId).delete();
      await localDb.pendingProductDeletes.put({ productId, createdAt: new Date().toISOString(), syncStatus: "pending" });
    }
  );

  void flushPendingProductDeletes();
}

let productDeletesFlushInFlight: Promise<{ synced: number; failed: number }> | null = null;

export function flushPendingProductDeletes(): Promise<{ synced: number; failed: number }> {
  if (productDeletesFlushInFlight) return productDeletesFlushInFlight;
  productDeletesFlushInFlight = doFlushPendingProductDeletes().finally(() => {
    productDeletesFlushInFlight = null;
  });
  return productDeletesFlushInFlight;
}

// No idempotency key needed here — DELETE /api/products/:id sets
// Product.active = false, which is already safe to apply twice.
async function doFlushPendingProductDeletes(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  if (!(await isApiReachable())) return { synced: 0, failed: 0 };

  const pending = await localDb.pendingProductDeletes.where("syncStatus").anyOf("pending", "error").toArray();
  for (const d of pending) {
    try {
      await api.delete(`/api/products/${d.productId}`);
      await localDb.pendingProductDeletes.update(d.productId, { syncStatus: "synced" });
      synced++;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Network error";
      await localDb.pendingProductDeletes.update(d.productId, { syncStatus: "error", syncError: message });
      failed++;
    }
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
  const onlineHandler = () => {
    void flushPendingSales();
    void flushPendingProducts();
    void flushPendingProductEdits();
    void flushPendingStockAdjustments();
    void flushPendingProductDeletes();
  };
  window.addEventListener("online", onlineHandler);

  let lastCacheRefresh = 0;
  const interval = setInterval(() => {
    void flushPendingSales();
    void flushPendingProducts();
    void flushPendingProductEdits();
    void flushPendingStockAdjustments();
    void flushPendingProductDeletes();
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
