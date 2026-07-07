import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";
import { BarcodeLabel } from "../components/BarcodeLabel";

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string | number;
  stockQty: number;
  lowStockThreshold: number;
  category: { name: string } | null;
}

interface Category {
  id: string;
  name: string;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

const emptyForm = {
  name: "",
  sku: "",
  barcode: "",
  categoryId: "",
  price: "",
  wholesalePrice: "",
  vipPrice: "",
  stockQty: "",
  lowStockThreshold: "5",
};

export function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(false);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function load() {
    const [p, c] = await Promise.all([api.get<Product[]>("/api/products"), api.get<Category[]>("/api/categories")]);
    setProducts(p);
    setCategories(c);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/products", {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode || undefined,
        categoryId: form.categoryId || undefined,
        price: Number(form.price),
        wholesalePrice: form.wholesalePrice ? Number(form.wholesalePrice) : undefined,
        vipPrice: form.vipPrice ? Number(form.vipPrice) : undefined,
        stockQty: Number(form.stockQty) || 0,
        lowStockThreshold: Number(form.lowStockThreshold) || 5,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch {
      setError("Couldn't save product — check the fields and try again.");
    }
  }

  async function adjustStock(productId: string, delta: number) {
    await api.post(`/api/products/${productId}/adjustments`, {
      quantityDelta: delta,
      reason: "MANUAL_CORRECTION",
    });
    await load();
  }

  return (
    <>
      <Topbar title="Inventory" subtitle={`${products.length} products`} />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-8">
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setShowLabels((v) => !v)}
            disabled={selectedIds.size === 0}
          >
            Print barcodes ({selectedIds.size})
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add product"}</Button>
        </div>

        {showForm && (
          <Card>
            <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-3">
              <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input required placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
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
              <input type="number" min="0" placeholder="Starting stock" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              {error && <div className="col-span-3 text-sm font-medium text-brand-warn">{error}</div>}
              <div className="col-span-3">
                <Button type="submit">Save product</Button>
              </div>
            </form>
          </Card>
        )}

        <Card>
          <div className="grid grid-cols-[0.3fr_2fr_1fr_1fr_1fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
            <span></span>
            <span>PRODUCT</span>
            <span>SKU</span>
            <span>CATEGORY</span>
            <span>PRICE</span>
            <span>STOCK</span>
            <span>ADJUST</span>
          </div>
          {products.map((p) => (
            <div key={p.id} className="grid grid-cols-[0.3fr_2fr_1fr_1fr_1fr_1fr_1fr] items-center border-b border-brand-border/60 py-2.5 text-sm">
              <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelected(p.id)} className="h-4 w-4" />
              <span className="font-semibold text-brand-ink">{p.name}</span>
              <span className="text-brand-inkMuted">{p.sku}</span>
              <span className="text-brand-inkMuted">{p.category?.name ?? "—"}</span>
              <span>{currencyFmt.format(Number(p.price))}</span>
              <span className={p.stockQty <= p.lowStockThreshold ? "font-bold text-brand-warn" : ""}>{p.stockQty}</span>
              <div className="flex gap-1.5">
                <button onClick={() => void adjustStock(p.id, -1)} className="h-7 w-7 rounded-md bg-brand-bg text-brand-ink">
                  −
                </button>
                <button onClick={() => void adjustStock(p.id, 1)} className="h-7 w-7 rounded-md bg-brand-bg text-brand-ink">
                  +
                </button>
              </div>
            </div>
          ))}
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
                  <BarcodeLabel key={p.id} value={p.barcode || p.sku} name={p.name} price={currencyFmt.format(Number(p.price))} />
                ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
