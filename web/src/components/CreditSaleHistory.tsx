import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { api, ApiError } from "../lib/api";
import { getCached } from "../lib/cachedFetch";
import { isLocalCustomerId, localDb } from "../db/localDb";
import { SALES_SYNCED_EVENT, undoLastSale } from "../lib/sync";
import type { SaleHistoryRow } from "../types/reports";
import { Card } from "./ui";

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

interface CreditSaleHistoryProps {
  customerId: string;
  customerName: string;
  onClose: () => void;
}

// The drill-down behind "click a sale to see what was sold" on the Credit
// Sales page — every credit sale ever made to this customer (that's what
// actually explains their outstanding balance, since credit is tracked as
// a running total rather than itemized per-sale debt), each expandable to
// its line items. Deliberately available to any role that can reach Credit
// Sales at all — see GET /api/customers/:id/sales, which isn't gated
// behind VIEW_REPORTS/MANAGE_CUSTOMERS for the same reason.
export function CreditSaleHistory({ customerId, customerName, onClose }: CreditSaleHistoryProps) {
  // A customer created inline during a credit sale that hasn't synced yet
  // only exists locally under this id — the server has never heard of it,
  // so there's nothing to fetch yet. The one sale that created it is still
  // shown below, via the unsynced-sales overlay.
  const isLocal = isLocalCustomerId(customerId);

  const [sales, setSales] = useState<SaleHistoryRow[]>([]);
  const [loading, setLoading] = useState(!isLocal);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [deletingSaleId, setDeletingSaleId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedSaleId(null);
    if (isLocal) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const path = `/api/customers/${customerId}/sales`;
    const load = () => {
      getCached<SaleHistoryRow[]>(path)
        .then((res) => {
          if (cancelled) return;
          setSales(res.data);
          setStale(res.stale);
          setCachedAt(res.cachedAt);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load this customer's sales");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    window.addEventListener("online", load);
    window.addEventListener(SALES_SYNCED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener("online", load);
      window.removeEventListener(SALES_SYNCED_EVENT, load);
    };
  }, [customerId, isLocal]);

  // Credit sales rung up on this device that haven't synced yet — every
  // sale is queued locally and synced in the background even while online
  // (see queueSale/flushPendingSales), so without this a just-completed
  // credit sale wouldn't show up here until that background sync lands.
  // Unlike My Sales, not scoped to "made by me" — this is scoped by
  // customer, so any pending sale for this customer made on this device
  // belongs here regardless of who rang it up.
  const unsyncedSales = useLiveQuery(
    () => localDb.pendingSales.where("syncStatus").anyOf("pending", "error").toArray(),
    [],
    []
  );

  const mergedSales = useMemo(() => {
    const overlay: SaleHistoryRow[] = unsyncedSales
      .filter((s) => s.paymentMethod === "CREDIT" && s.customerId === customerId)
      .map((s) => ({
        id: s.clientId,
        createdAt: s.createdAt,
        enteredAt: new Date().toISOString(),
        isBackdated: !!s.backdated,
        total: s.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
        paymentMethod: s.paymentMethod,
        status: "COMPLETED",
        items: s.items.map((i) => ({
          id: i.productId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.unitPrice * i.quantity,
        })),
        customer: { name: customerName },
      }));
    if (overlay.length === 0) return sales;
    return [...overlay, ...sales].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [sales, unsyncedSales, customerId, customerName]);

  // Sales still sitting in the overlay above have no server id yet, so
  // there's nothing for the void endpoint to act on until they sync — they
  // get their own delete path below (undoLastSale) instead. Keyed by
  // clientId -> syncStatus so a permanently failed sale (which will never
  // finish "syncing" on its own — see Topbar's retry button) can say so
  // instead of looking stuck forever under a generic "Syncing…".
  const unsyncedStatus = useMemo(
    () =>
      new Map(
        unsyncedSales
          .filter((s) => s.paymentMethod === "CREDIT" && s.customerId === customerId)
          .map((s) => [s.clientId, s.syncStatus] as const)
      ),
    [unsyncedSales, customerId]
  );

  const [deletingUnsyncedId, setDeletingUnsyncedId] = useState<string | null>(null);

  async function handleDeleteUnsynced(clientId: string, e: MouseEvent) {
    e.stopPropagation();
    if (
      !window.confirm(
        "Delete this sale? It hasn't synced to the server yet, so this just cancels it on this device — you can ring it up again from Checkout."
      )
    ) {
      return;
    }
    setDeletingUnsyncedId(clientId);
    const result = await undoLastSale(clientId);
    setDeletingUnsyncedId(null);
    if (!result.ok) {
      alert(result.message ?? "Couldn't delete this sale — try again.");
    }
  }

  async function handleDeleteSale(sale: SaleHistoryRow, e: MouseEvent) {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete this sale (${currencyFmt.format(Number(sale.total))})? This restores the stock and reduces ${customerName}'s balance by that amount. This can't be undone.`
      )
    ) {
      return;
    }
    setDeletingSaleId(sale.id);
    try {
      await api.post(`/api/sales/${sale.id}/void`, {});
      setSales((prev) => prev.filter((s) => s.id !== sale.id));
      if (expandedSaleId === sale.id) setExpandedSaleId(null);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't delete this sale — try again.");
    } finally {
      setDeletingSaleId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-display text-[15px] font-bold text-brand-ink">{customerName} — credit sales</div>
          <div className="text-xs text-brand-inkMuted">Tap a sale to see the items sold</div>
        </div>
        <button onClick={onClose} aria-label="Close credit sale history" className="text-sm text-brand-inkMuted hover:text-brand-ink">
          ✕
        </button>
      </div>

      {!error && stale && (
        <div className="rounded-lg bg-brand-warnBg px-3 py-2 text-sm font-medium text-brand-warn">
          Offline — showing sales from {cachedAt ? new Date(cachedAt).toLocaleString("en-KE") : "the last time this device was online"}.
          Will update automatically once you're back online.
        </div>
      )}

      {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
      {!error && loading && <div className="text-sm text-brand-inkMuted">Loading…</div>}
      {!error && !loading && mergedSales.length === 0 && (
        <div className="py-4 text-sm text-brand-inkMuted">No credit sales recorded for this customer yet.</div>
      )}
      {!error && !loading && mergedSales.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1.1fr_0.6fr_0.9fr_0.9fr_0.8fr] gap-2 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
              <span>DATE</span>
              <span>ITEMS</span>
              <span>TOTAL</span>
              <span>SOLD BY</span>
              <span>ACTION</span>
            </div>
            {mergedSales.map((s) => {
              const createdAt = new Date(s.createdAt);
              const expanded = expandedSaleId === s.id;
              const unsyncedState = unsyncedStatus.get(s.id);
              return (
                <div key={s.id} className="border-b border-brand-border/60">
                  <button
                    onClick={() => setExpandedSaleId(expanded ? null : s.id)}
                    aria-expanded={expanded}
                    className={`grid w-full grid-cols-[1.1fr_0.6fr_0.9fr_0.9fr_0.8fr] items-center gap-2 py-2.5 text-left text-sm hover:bg-brand-bg ${
                      expanded ? "bg-brand-bg" : ""
                    }`}
                  >
                    <span className="text-brand-inkMuted">
                      {createdAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                      {s.isBackdated && (
                        <span className="ml-1 rounded-full bg-brand-warnBg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-warn">
                          Backdated
                        </span>
                      )}
                    </span>
                    <span>{s.items.reduce((n, i) => n + i.quantity, 0)}</span>
                    <span className="font-semibold text-brand-ink">{currencyFmt.format(Number(s.total))}</span>
                    <span className="text-brand-inkMuted">{s.cashier?.name ?? "—"}</span>
                    {unsyncedState ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-brand-inkMuted">
                          {unsyncedState === "error" ? "Failed to sync" : "Syncing…"}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleDeleteUnsynced(s.id, e)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") handleDeleteUnsynced(s.id, e as unknown as MouseEvent);
                          }}
                          className="w-fit rounded-md px-2 py-1 text-xs font-semibold text-brand-warn hover:bg-brand-warnBg"
                          aria-disabled={deletingUnsyncedId === s.id}
                        >
                          {deletingUnsyncedId === s.id ? "Deleting…" : "Delete"}
                        </span>
                      </div>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleDeleteSale(s, e)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") handleDeleteSale(s, e as unknown as MouseEvent);
                        }}
                        className="w-fit rounded-md px-2 py-1 text-xs font-semibold text-brand-warn hover:bg-brand-warnBg disabled:opacity-50"
                        aria-disabled={deletingSaleId === s.id}
                      >
                        {deletingSaleId === s.id ? "Deleting…" : "Delete"}
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div className="mb-2 rounded-lg bg-brand-bg px-3 py-3 text-sm">
                      {s.isBackdated && (
                        <div className="mb-2 text-xs font-semibold text-brand-warn">
                          Dated to {createdAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })} — actually entered{" "}
                          {new Date(s.enteredAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      )}
                      <div className="grid grid-cols-[2fr_0.6fr_0.9fr_0.9fr] gap-2 border-b border-brand-border/60 pb-1.5 text-[11px] font-semibold text-brand-inkMuted">
                        <span>ITEM</span>
                        <span>QTY</span>
                        <span>UNIT PRICE</span>
                        <span>LINE TOTAL</span>
                      </div>
                      {s.items.map((item) => (
                        <div key={item.id} className="grid grid-cols-[2fr_0.6fr_0.9fr_0.9fr] gap-2 border-b border-brand-border/40 py-1.5 text-[13px]">
                          <span className="text-brand-ink">{item.name}</span>
                          <span className="text-brand-inkMuted">{item.quantity}</span>
                          <span className="text-brand-inkMuted">{currencyFmt.format(Number(item.unitPrice))}</span>
                          <span className="font-semibold text-brand-ink">{currencyFmt.format(Number(item.lineTotal))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
