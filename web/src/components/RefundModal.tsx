import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "../db/localDb";
import { queueRefund } from "../lib/sync";
import type { SaleHistoryRow } from "../types/reports";
import { Button, Card } from "./ui";

export type RefundMethod = "CASH" | "MPESA_MANUAL" | "CREDIT";

const METHOD_LABELS: Record<RefundMethod, string> = {
  CASH: "Cash",
  MPESA_MANUAL: "M-Pesa",
  CREDIT: "Knock off balance",
};

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

interface RefundModalProps {
  sale: SaleHistoryRow;
  onClose: () => void;
  // Called after a successful refund so the caller can refetch/update its
  // own list — the modal doesn't know how its parent stores sales.
  onRefunded: () => void;
}

// Lets a cashier bring back some (or all) of what a customer bought on an
// already-completed sale — a customer changing their mind after they've
// left, not a moments-ago ring-up mistake (that's what Void is for). Each
// item can only be refunded up to what hasn't already come back on an
// earlier visit (see `remaining` below), and money can go back as cash,
// M-Pesa, or — only when this sale actually has a customer — knocked
// straight off their credit balance instead of handed over. Submits via
// queueRefund (write-locally-first, same as ringing up a sale), so this
// works with zero connectivity — stock is restored on this device
// immediately, and the server-side record follows once it can sync.
export function RefundModal({ sale, onClose, onRefunded }: RefundModalProps) {
  // Refunds already queued against this exact sale on this device but not
  // yet confirmed synced — without this, closing and reopening the modal
  // before sync lands would let the same items be refunded twice.
  const pendingRefunds = useLiveQuery(
    () => localDb.pendingRefunds.where("saleId").equals(sale.id).and((r) => r.syncStatus !== "synced").toArray(),
    [sale.id],
    []
  );

  const alreadyRefundedByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of sale.refunds ?? []) {
      for (const ri of r.items) {
        map.set(ri.saleItemId, (map.get(ri.saleItemId) ?? 0) + ri.quantity);
      }
    }
    for (const r of pendingRefunds) {
      for (const ri of r.items) {
        map.set(ri.saleItemId, (map.get(ri.saleItemId) ?? 0) + ri.quantity);
      }
    }
    return map;
  }, [sale.refunds, pendingRefunds]);

  const refundableItems = useMemo(
    () =>
      sale.items
        .map((item) => ({ ...item, remaining: item.quantity - (alreadyRefundedByItem.get(item.id) ?? 0) }))
        .filter((item) => item.remaining > 0),
    [sale.items, alreadyRefundedByItem]
  );

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<RefundMethod>(
    sale.paymentMethod === "CREDIT" ? "CREDIT" : sale.paymentMethod === "MPESA" || sale.paymentMethod === "MPESA_MANUAL" ? "MPESA_MANUAL" : "CASH"
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCustomer = !!sale.customer;
  const total = refundableItems.reduce((sum, item) => sum + (quantities[item.id] ?? 0) * Number(item.unitPrice), 0);
  const canSubmit = total > 0 && (method !== "CREDIT" || hasCustomer);

  function setQuantity(itemId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(max, Math.floor(value) || 0));
    setQuantities((prev) => ({ ...prev, [itemId]: clamped }));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const items = refundableItems
      .filter((item) => (quantities[item.id] ?? 0) > 0)
      .map((item) => ({
        saleItemId: item.id,
        productId: item.productId ?? item.id,
        quantity: quantities[item.id],
        unitPrice: Number(item.unitPrice),
      }));
    if (items.length === 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await queueRefund({
        saleId: sale.id,
        customerId: sale.customerId ?? undefined,
        items,
        method,
        reason: reason.trim() || undefined,
      });
      onRefunded();
      onClose();
    } catch {
      setError("Couldn't save this refund on this device — try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-1 font-display text-lg font-bold text-brand-ink">Refund items</div>
        <div className="mb-4 text-sm text-brand-inkMuted">
          {sale.customer?.name ?? "Walk-in customer"} · {new Date(sale.createdAt).toLocaleDateString("en-KE", { dateStyle: "medium" })}
        </div>

        {refundableItems.length === 0 ? (
          <div className="mb-4 text-sm text-brand-inkMuted">Everything on this sale has already been refunded.</div>
        ) : (
          <div className="mb-4 flex flex-col gap-2.5">
            {refundableItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-brand-ink">{item.name}</div>
                  <div className="text-xs text-brand-inkMuted">
                    {currencyFmt.format(Number(item.unitPrice))} each · {item.remaining} of {item.quantity} still returnable
                  </div>
                </div>
                <input
                  type="number"
                  min={0}
                  max={item.remaining}
                  value={quantities[item.id] ?? 0}
                  onChange={(e) => setQuantity(item.id, Number(e.target.value), item.remaining)}
                  className="w-16 rounded-lg border border-brand-border px-2 py-1.5 text-right"
                />
              </div>
            ))}
          </div>
        )}

        {refundableItems.length > 0 && (
          <>
            <div className="mb-3">
              <span className="mb-1 block text-sm font-medium text-brand-ink">Give the money back via</span>
              <div className="flex gap-2">
                {(Object.keys(METHOD_LABELS) as RefundMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={m === "CREDIT" && !hasCustomer}
                    onClick={() => setMethod(m)}
                    title={m === "CREDIT" && !hasCustomer ? "This sale has no customer to credit" : undefined}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                      method === m ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"
                    }`}
                  >
                    {METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <label className="mb-4 block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Reason (optional)</span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. changed their mind, wrong size"
                className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
              />
            </label>

            <div className="mb-4 flex items-baseline justify-between text-sm">
              <span className="font-medium text-brand-ink">Refund total</span>
              <span className="font-display text-lg font-bold text-brand-ink">{currencyFmt.format(total)}</span>
            </div>
          </>
        )}

        {error && <div className="mb-3 text-xs font-medium text-brand-warn">{error}</div>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {refundableItems.length > 0 && (
            <Button className="flex-1" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}>
              {submitting ? "Processing…" : "Refund"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
