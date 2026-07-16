import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getCached } from "../lib/cachedFetch";
import { isApiReachable } from "../lib/api";
import { localDb, type CachedProduct } from "../db/localDb";
import { queueProductCreate, refreshProductCache } from "../lib/sync";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { ProductDetailModal } from "../components/ProductDetailModal";
import { ImportProductsModal } from "../components/ImportProductsModal";

interface Category {
  id: string;
  name: string;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

function slugifySku(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "ITEM";
}

function generateSku(name: string, existingSkus: Set<string>): string {
  const base = slugifySku(name);
  if (!existingSkus.has(base)) return base;
  let n = 2;
  while (existingSkus.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const emptyForm = {
  name: "",
  sku: "",
  barcode: "",
  categoryId: "",
  price: "",
  wholesalePrice: "",
  vipPrice: "",
  cost: "",
  stockQty: "",
  lowStockThreshold: "5",
};

export function Inventory() {
  // Reactive local cache, not a live API call — this is what makes Inventory
  // work offline at all. Every write (add, edit, stock adjustment) lands
  // here first (see lib/sync.ts), so this table always reflects this
  // device's most current view, synced or not, with no polling.
  const products = useLiveQuery(() => localDb.products.orderBy("name").toArray(), [], []);
  const pendingCreates = useLiveQuery(
    () => localDb.pendingProducts.where("syncStatus").anyOf("pending", "error").toArray(),
    [],
    []
  );
  const pendingEdits = useLiveQuery(
    () => localDb.pendingProductEdits.where("syncStatus").anyOf("pending", "error").toArray(),
    [],
    []
  );
  const pendingAdjustments = useLiveQuery(
    () => localDb.pendingStockAdjustments.where("syncStatus").anyOf("pending", "error").toArray(),
    [],
    []
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [detailProduct, setDetailProduct] = useState<CachedProduct | null>(null);
  // Tracks whether the user has hand-edited the SKU, so typing the name
  // keeps auto-generating it until they intentionally override it.
  const [skuTouched, setSkuTouched] = useState(false);

  function handleNameChange(name: string) {
    setForm((prev) => ({
      ...prev,
      name,
      sku: skuTouched || !name.trim() ? prev.sku : generateSku(name, new Set(products.map((p) => p.sku.toUpperCase()))),
    }));
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    void isApiReachable().then((reachable) => {
      if (reachable) void refreshProductCache();
    });
    // Categories are read-only from this screen (there's no "add category"
    // flow), so a simple cache-with-fallback is enough — no need for the
    // richer reactive queue the products themselves use.
    void getCached<Category[]>("/api/categories")
      .then((res) => setCategories(res.data))
      .catch(() => setCategories([]));
  }, []);

  const pendingProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of pendingCreates) ids.add(p.clientId);
    for (const e of pendingEdits) ids.add(e.productId);
    for (const a of pendingAdjustments) ids.add(a.productId);
    return ids;
  }, [pendingCreates, pendingEdits, pendingAdjustments]);

  const pendingCount = pendingCreates.length + pendingEdits.length + pendingAdjustments.length;

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode?.toLowerCase().includes(q) ?? false) ||
        (p.categoryName?.toLowerCase().includes(q) ?? false)
    );
  }, [products, query]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const priceNum = Number(form.price);
    if (!form.name.trim() || !form.sku.trim() || !Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Enter a product name, SKU, and a valid selling price.");
      return;
    }

    const categoryName = form.categoryId ? categories.find((c) => c.id === form.categoryId)?.name ?? null : null;

    await queueProductCreate({
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || undefined,
      categoryId: form.categoryId || undefined,
      categoryName,
      price: priceNum,
      wholesalePrice: form.wholesalePrice ? Number(form.wholesalePrice) : undefined,
      vipPrice: form.vipPrice ? Number(form.vipPrice) : undefined,
      cost: form.cost ? Number(form.cost) : undefined,
      stockQty: Number(form.stockQty) || 0,
      lowStockThreshold: Number(form.lowStockThreshold) || 5,
    });
    setForm(emptyForm);
    setSkuTouched(false);
    setShowForm(false);
  }

  return (
    <>
      <Topbar title="Inventory" subtitle={`${products.length} products`} />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:p-8">
        {pendingCount > 0 && (
          <div className="rounded-lg bg-brand-accent/10 px-3 py-2 text-sm font-medium text-brand-accentText">
            Includes {pendingCount} product change{pendingCount === 1 ? "" : "s"} made on this device that {pendingCount === 1 ? "hasn't" : "haven't"}{" "}
            synced yet — they'll finish syncing automatically once you're back online.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, SKU, barcode, or category"
            className="min-w-[220px] flex-1 rounded-[10px] border border-brand-border bg-white px-4 py-3 text-sm outline-none focus:border-brand-accentDeep"
          />
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              Import products
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowLabels((v) => !v)}
              disabled={selectedIds.size === 0}
            >
              Print barcodes ({selectedIds.size})
            </Button>
            <Button
              onClick={() => {
                if (showForm) {
                  setForm(emptyForm);
                  setSkuTouched(false);
                }
                setShowForm((v) => !v);
              }}
            >
              {showForm ? "Cancel" : "Add product"}
            </Button>
          </div>
        </div>

        {showForm && (
          <Card>
            <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <input required placeholder="Name" value={form.name} onChange={(e) => handleNameChange(e.target.value)} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input
                required
                placeholder="SKU (auto-generated — edit if needed)"
                value={form.sku}
                onChange={(e) => {
                  setSkuTouched(true);
                  setForm({ ...form, sku: e.target.value });
                }}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm"
              />
              <input placeholder="Barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm">
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input required type="number" min="0" step="0.01" placeholder="Retail price (KSh)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input type="number" min="0" step="0.01" placeholder="Wholesale price (optional)" value={form.wholesalePrice} onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input type="number" min="0" step="0.01" placeholder="VIP price (optional)" value={form.vipPrice} onChange={(e) => setForm({ ...form, vipPrice: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input type="number" min="0" step="0.01" placeholder="Buying price / cost (KSh)" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input type="number" min="0" placeholder="Starting stock" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              {error && <div className="col-span-full text-sm font-medium text-brand-warn">{error}</div>}
              <div className="col-span-full">
                <Button type="submit">Save product</Button>
              </div>
            </form>
          </Card>
        )}

        <Card>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[0.3fr_2fr_1fr_1fr_1fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                <span></span>
                <span>PRODUCT</span>
                <span>SKU</span>
                <span>CATEGORY</span>
                <span>PRICE</span>
                <span>COST</span>
                <span>STOCK</span>
              </div>
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setDetailProduct(p)}
                  className="grid cursor-pointer grid-cols-[0.3fr_2fr_1fr_1fr_1fr_1fr_1fr] items-center border-b border-brand-border/60 py-2.5 text-sm hover:bg-brand-bg"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(p.id)}
                    className="h-4 w-4"
                  />
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold text-brand-ink">
                    <span className="truncate">{p.name}</span>
                    {pendingProductIds.has(p.id) && (
                      <span
                        title="Not yet synced to the server"
                        className="shrink-0 rounded-full bg-brand-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-brand-accentText"
                      >
                        SYNCING
                      </span>
                    )}
                  </span>
                  <span className="text-brand-inkMuted">{p.sku}</span>
                  <span className="text-brand-inkMuted">{p.categoryName ?? "—"}</span>
                  <span>{currencyFmt.format(p.price)}</span>
                  <span className="text-brand-inkMuted">{p.cost != null ? currencyFmt.format(p.cost) : "—"}</span>
                  <span className={p.stockQty <= p.lowStockThreshold ? "font-bold text-brand-warn" : ""}>
                    {p.stockQty < 0 ? `${p.stockQty} (backorder)` : p.stockQty}
                  </span>
                </div>
              ))}
              {filteredProducts.length === 0 && (
                <div className="py-6 text-sm text-brand-inkMuted">
                  {products.length === 0 ? "No products yet." : "No products match your search."}
                </div>
              )}
            </div>
          </div>
          <div className="pt-3 text-xs text-brand-inkMuted">Tap a product to edit its details, price, or stock.</div>
        </Card>

        {showLabels && (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[15px] font-bold text-brand-ink">Barcode labels</span>
              <Button onClick={() => window.print()}>Print</Button>
            </div>
            <div id="barcode-print-area" className="flex flex-wrap gap-3">
              {products
                .filter((p) => selectedIds.has(p.id))
                .map((p) => (
                  <BarcodeLabel key={p.id} value={p.barcode || p.sku} name={p.name} price={currencyFmt.format(p.price)} />
                ))}
            </div>
          </Card>
        )}
      </div>

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          categories={categories}
          onClose={() => setDetailProduct(null)}
          onSaved={() => {}}
        />
      )}

      {showImport && (
        <ImportProductsModal onClose={() => setShowImport(false)} onImported={() => void refreshProductCache()} />
      )}
    </>
  );
}
