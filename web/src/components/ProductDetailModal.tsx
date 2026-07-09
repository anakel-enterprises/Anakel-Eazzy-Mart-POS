import { useState } from "react";
import { api } from "../lib/api";
import { Button, Card } from "./ui";

export interface ProductDetail {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string | number;
  cost: string | number | null;
  stockQty: number;
  lowStockThreshold: number;
  categoryId?: string | null;
  category: { name: string } | null;
}

interface Category {
  id: string;
  name: string;
}

export function ProductDetailModal({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: ProductDetail;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.categoryId ?? "");
  const [price, setPrice] = useState(String(product.price));
  const [cost, setCost] = useState(product.cost != null ? String(product.cost) : "");
  const [lowStockThreshold, setLowStockThreshold] = useState(String(product.lowStockThreshold));
  const [qty, setQty] = useState(String(product.stockQty));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function step(delta: number) {
    setQty((prev) => String(Math.max(0, Math.trunc(Number(prev) || 0) + delta)));
  }

  async function handleSave() {
    setError(null);
    const priceNum = Number(price);
    const qtyNum = Math.max(0, Math.trunc(Number(qty)));
    if (!name.trim() || Number.isNaN(priceNum) || priceNum <= 0) {
      setError("Enter a product name and a valid selling price.");
      return;
    }
    if (Number.isNaN(qtyNum)) {
      setError("Enter a valid stock quantity.");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/api/products/${product.id}`, {
        name: name.trim(),
        categoryId: categoryId || null,
        price: priceNum,
        cost: cost.trim() === "" ? undefined : Number(cost),
        lowStockThreshold: Number(lowStockThreshold) || 0,
      });

      const delta = qtyNum - product.stockQty;
      if (delta !== 0) {
        await api.post(`/api/products/${product.id}/adjustments`, {
          quantityDelta: delta,
          reason: "MANUAL_CORRECTION",
        });
      }

      onSaved();
      onClose();
    } catch {
      setError("Couldn't save changes — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-[15px] font-bold text-brand-ink">Product details</span>
          <button onClick={onClose} className="text-sm text-brand-inkMuted hover:text-brand-ink">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-brand-ink">Product name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-brand-border px-3 py-2" />
          </label>

          <div className="text-xs text-brand-inkMuted">SKU: {product.sku}</div>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-brand-ink">Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-lg border border-brand-border px-3 py-2">
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Buying price (KSh)</span>
              <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full rounded-lg border border-brand-border px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Selling price (KSh)</span>
              <input required type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-lg border border-brand-border px-3 py-2" />
            </label>
          </div>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-brand-ink">Re-order level (low stock alert)</span>
            <input type="number" min="0" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} className="w-full rounded-lg border border-brand-border px-3 py-2" />
          </label>

          <div>
            <span className="mb-1 block text-sm font-medium text-brand-ink">Stock quantity</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                className="h-10 w-10 shrink-0 rounded-lg bg-brand-bg text-lg font-semibold text-brand-ink"
              >
                −
              </button>
              <input
                type="number"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-lg border border-brand-border px-3 py-2 text-center"
              />
              <button
                type="button"
                onClick={() => step(1)}
                className="h-10 w-10 shrink-0 rounded-lg bg-brand-bg text-lg font-semibold text-brand-ink"
              >
                +
              </button>
            </div>
            <div className="mt-1 text-xs text-brand-inkMuted">Currently {product.stockQty} in stock</div>
          </div>

          {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}

          <div className="mt-1 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
