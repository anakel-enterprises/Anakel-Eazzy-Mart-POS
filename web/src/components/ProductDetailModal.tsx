import { useState } from "react";
import { isLocalProductId } from "../db/localDb";
import { patchPendingProduct, queueProductDelete, queueProductEdit, queueStockAdjustment } from "../lib/sync";
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
  // The amount to add (or, if negative, remove) on top of the current stock
  // — not the new absolute total. Starts at 0 so Save is a no-op by default.
  const [delta, setDelta] = useState("0");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deltaNum = Math.trunc(Number(delta)) || 0;
  const newStockQty = product.stockQty + deltaNum;

  function step(amount: number) {
    setDelta((prev) => String((Math.trunc(Number(prev)) || 0) + amount));
  }

  async function handleSave() {
    setError(null);
    const priceNum = Number(price);
    if (!name.trim() || Number.isNaN(priceNum) || priceNum <= 0) {
      setError("Enter a product name and a valid selling price.");
      return;
    }
    if (Number.isNaN(Number(delta))) {
      setError("Enter a valid stock adjustment.");
      return;
    }
    setSaving(true);

    const costNum = cost.trim() === "" ? undefined : Number(cost);
    const categoryName = categoryId ? categories.find((c) => c.id === categoryId)?.name ?? null : null;

    // Every write below queues locally and syncs in the background — same
    // write-through-the-offline-queue shape as the rest of the app, so this
    // never has to branch on connectivity.
    if (isLocalProductId(product.id)) {
      // This product's own create hasn't synced yet — there's nothing to PUT
      // against, so fold the edit straight into the still-pending create.
      await patchPendingProduct(product.id, {
        name: name.trim(),
        categoryId: categoryId || undefined,
        categoryName,
        price: priceNum,
        cost: costNum,
        lowStockThreshold: Number(lowStockThreshold) || 0,
        stockQty: newStockQty,
      });
    } else {
      await queueProductEdit(product.id, {
        name: name.trim(),
        categoryId: categoryId || null,
        categoryName,
        price: priceNum,
        cost: costNum,
        lowStockThreshold: Number(lowStockThreshold) || 0,
      });
      if (deltaNum !== 0) {
        await queueStockAdjustment(product.id, deltaNum, "MANUAL_CORRECTION");
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${product.name}"? It will no longer show up in Inventory or be sellable at Checkout.`)) {
      return;
    }
    setDeleting(true);
    await queueProductDelete(product.id);
    setDeleting(false);
    onSaved();
    onClose();
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
            <span className="mb-1 block text-sm font-medium text-brand-ink">
              Adjust stock (currently {product.stockQty < 0 ? `${-product.stockQty} on backorder` : product.stockQty})
            </span>
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
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
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
            <div className={`mt-1 text-xs ${newStockQty < 0 ? "font-semibold text-brand-warn" : "text-brand-inkMuted"}`}>
              {deltaNum === 0
                ? "No change to stock"
                : newStockQty < 0
                ? `Still ${-newStockQty} on backorder after this restock (${deltaNum > 0 ? "+" : ""}${deltaNum})`
                : `New stock will be ${newStockQty} (${deltaNum > 0 ? "+" : ""}${deltaNum})`}
            </div>
          </div>

          {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}

          <div className="mt-1 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving || deleting}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => void handleSave()} disabled={saving || deleting}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>

          <div className="mt-1 border-t border-brand-border pt-3">
            <Button
              variant="danger"
              className="w-full"
              onClick={() => void handleDelete()}
              disabled={saving || deleting}
            >
              {deleting ? "Deleting…" : "Delete product"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
