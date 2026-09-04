import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "../db/localDb";
import { flushPendingSales, undoLastSale } from "../lib/sync";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "../lib/paymentMethods";
import { Button, Card } from "./ui";

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

// Every sale on this device stuck in "error" sync status, across every
// cashier — not just the current user's own. Opened admin-only from the
// Topbar's "N sales failed to sync" pill (see Topbar.tsx), which used to
// just silently retry with zero feedback either way. A stuck sale can
// belong to a different cashier than whoever's currently logged in, and
// neither "My Sales" (scoped to your own) nor the Reports drill-down
// (which deliberately excludes another employee's still-unsynced sales —
// see SalesHistoryPanel) can show it, so this is the only place to
// actually find and fix one.
export function FailedSalesModal({ onClose }: { onClose: () => void }) {
  const failedSales = useLiveQuery(
    async () => {
      const rows = await localDb.pendingSales.where("syncStatus").equals("error").toArray();
      return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    [],
    []
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);

  async function handleRetry() {
    setRetrying(true);
    setRetryResult(null);
    const result = await flushPendingSales();
    setRetrying(false);
    setRetryResult(
      result.synced > 0
        ? `${result.synced} sale${result.synced === 1 ? "" : "s"} just synced.${
            result.failed > 0 ? ` ${result.failed} still failing — see below.` : ""
          }`
        : result.failed > 0
        ? "Still failing the same way — see the reason on each sale below."
        : "Nothing left to retry."
    );
  }

  async function handleDelete(clientId: string) {
    if (
      !window.confirm(
        "Delete this sale? It never reached the server, so this just cancels it on this device and restores the stock. You can ring it up again from Checkout."
      )
    ) {
      return;
    }
    setDeletingId(clientId);
    const result = await undoLastSale(clientId);
    setDeletingId(null);
    if (!result.ok) {
      alert(result.message ?? "Couldn't delete this sale — try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-[15px] font-bold text-brand-ink">Sales that failed to sync</div>
            <div className="text-xs text-brand-inkMuted">
              Every sale on this device the server has rejected on every retry so far, from any cashier.
            </div>
          </div>
          <button onClick={onClose} className="text-sm text-brand-inkMuted hover:text-brand-ink">
            ✕
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-brand-border pb-3">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void handleRetry()} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry sync now"}
          </Button>
          {retryResult && <span className="text-xs font-medium text-brand-inkMuted">{retryResult}</span>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {failedSales.length === 0 && (
            <div className="py-6 text-center text-sm text-brand-inkMuted">No failed sales — everything's synced.</div>
          )}
          <div className="flex flex-col gap-2">
            {failedSales.map((s) => {
              const total = s.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
              const itemCount = s.items.reduce((n, i) => n + i.quantity, 0);
              const expanded = expandedId === s.clientId;
              return (
                <div key={s.clientId} className="rounded-lg border border-brand-border">
                  <button
                    onClick={() => setExpandedId(expanded ? null : s.clientId)}
                    aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-brand-bg"
                  >
                    <div>
                      <div className="font-semibold text-brand-ink">
                        {new Date(s.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                      <div className="text-xs text-brand-inkMuted">
                        {s.cashierName ?? "Unknown cashier"} · {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
                        {PAYMENT_METHOD_LABELS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod}
                      </div>
                    </div>
                    <div className="font-bold text-brand-ink">{currencyFmt.format(total)}</div>
                  </button>
                  {expanded && (
                    <div className="border-t border-brand-border bg-brand-bg px-3 py-3 text-sm">
                      <div className="mb-2 rounded-lg bg-brand-warnBg px-3 py-2 text-xs font-medium text-brand-warn">
                        Rejected with: "{s.syncError ?? "Unknown error"}"
                      </div>
                      <div className="grid grid-cols-[2fr_0.6fr_0.9fr_0.9fr] gap-2 border-b border-brand-border/60 pb-1.5 text-[11px] font-semibold text-brand-inkMuted">
                        <span>ITEM</span>
                        <span>QTY</span>
                        <span>UNIT PRICE</span>
                        <span>LINE TOTAL</span>
                      </div>
                      {s.items.map((item, idx) => (
                        <div
                          key={`${item.productId}-${idx}`}
                          className="grid grid-cols-[2fr_0.6fr_0.9fr_0.9fr] gap-2 border-b border-brand-border/40 py-1.5 text-[13px]"
                        >
                          <span className="text-brand-ink">{item.name}</span>
                          <span className="text-brand-inkMuted">{item.quantity}</span>
                          <span className="text-brand-inkMuted">{currencyFmt.format(item.unitPrice)}</span>
                          <span className="font-semibold text-brand-ink">{currencyFmt.format(item.unitPrice * item.quantity)}</span>
                        </div>
                      ))}
                      <button
                        onClick={() => void handleDelete(s.clientId)}
                        disabled={deletingId === s.clientId}
                        className="mt-3 w-fit rounded-md bg-white px-2 py-1 text-xs font-semibold text-brand-warn hover:bg-brand-warnBg disabled:opacity-60"
                      >
                        {deletingId === s.clientId ? "Deleting…" : "Delete this sale (restores stock, ring it up again in Checkout)"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
