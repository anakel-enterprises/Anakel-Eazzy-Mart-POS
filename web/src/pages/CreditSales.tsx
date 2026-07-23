import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { api, ApiError } from "../lib/api";
import { getCached } from "../lib/cachedFetch";
import { isLocalCustomerId, localDb, type CachedCustomer } from "../db/localDb";
import { SALES_SYNCED_EVENT } from "../lib/sync";
import { overlayCreditSales } from "../lib/offlineStats";
import type { CreditCustomer } from "../types/reports";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";
import { CreditSaleHistory } from "../components/CreditSaleHistory";
import { RecordPaymentModal, type CreditPaymentSubmission } from "../components/RecordPaymentModal";

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

function isOverdue(dueDate: string | null) {
  return !!dueDate && new Date(dueDate) < new Date();
}

export function CreditSales() {
  const [customers, setCustomers] = useState<CreditCustomer[]>([]);
  const [stale, setStale] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Which customer the "Record payment" modal is open for — carries their
  // current balance too, so the modal can default the amount field to it.
  const [payingCustomer, setPayingCustomer] = useState<{ id: string; name: string; balance: number } | null>(null);
  // Which customer's credit-sale-by-credit-sale history (with line items)
  // is on screen below the table — at most one at a time.
  const [expandedCustomer, setExpandedCustomer] = useState<{ id: string; name: string } | null>(null);

  // Sales rung up on this device the server doesn't know about yet — every
  // sale, even while online, is queued locally and synced in the background
  // (see queueSale/flushPendingSales in lib/sync.ts), so the list below can
  // otherwise lag a freshly completed credit sale until that background sync
  // happens to land. Reactively re-queried the instant a sale is queued or
  // its sync status changes.
  const unsyncedSales = useLiveQuery(
    () => localDb.pendingSales.where("syncStatus").anyOf("pending", "error").toArray(),
    [],
    []
  );
  // Only needed to fill in name/phone/creditLimit for a customer created
  // inline during a credit sale that hasn't synced yet — see overlayCreditSales.
  const customerCache = useLiveQuery(
    async () => new Map((await localDb.customers.toArray()).map((c) => [c.id, c])),
    [],
    new Map<string, CachedCustomer>()
  );

  const displayCustomers = useMemo(
    () => overlayCreditSales(customers, unsyncedSales, customerCache),
    [customers, unsyncedSales, customerCache]
  );
  const creditSaleCount = unsyncedSales.filter((s) => s.paymentMethod === "CREDIT").length;

  async function load() {
    try {
      const res = await getCached<CreditCustomer[]>("/api/customers/credit");
      setCustomers(res.data);
      setStale(res.stale);
      setCachedAt(res.cachedAt);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void load();
    // Re-fetch the moment connectivity returns, and once a sync batch
    // actually confirms — see the matching comment in Dashboard.tsx for why
    // "online" alone isn't enough to trust a fresh fetch.
    window.addEventListener("online", load);
    window.addEventListener(SALES_SYNCED_EVENT, load);
    return () => {
      window.removeEventListener("online", load);
      window.removeEventListener(SALES_SYNCED_EVENT, load);
    };
  }, []);

  async function recordPayment(customerId: string, data: CreditPaymentSubmission) {
    try {
      await api.post(`/api/customers/${customerId}/payments`, data);
      setPayingCustomer(null);
      await load();
    } catch (err) {
      // Re-thrown so the modal itself shows the error and stays open,
      // rather than it silently closing on a failed save.
      throw err instanceof ApiError ? new Error(err.message) : err;
    }
  }

  async function deleteCustomer(c: CreditCustomer) {
    const balance = Number(c.creditBalance);
    const warning =
      balance > 0
        ? `Delete "${c.name}"? They still owe ${currencyFmt.format(balance)} — deleting them removes this debt from Credit Sales tracking. Their sale history is kept, but they'll no longer show up here or be selectable at Checkout.`
        : `Delete "${c.name}"? They'll no longer show up in Credit Sales or be selectable at Checkout.`;
    if (!window.confirm(warning)) return;
    try {
      await api.delete(`/api/customers/${c.id}`);
      if (expandedCustomer?.id === c.id) setExpandedCustomer(null);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't delete this customer — try again.");
    }
  }

  const totalOutstanding = displayCustomers.reduce((sum, c) => sum + Number(c.creditBalance), 0);

  return (
    <>
      <Topbar
        title="Credit Sales"
        subtitle={`${currencyFmt.format(totalOutstanding)} outstanding across ${displayCustomers.length} customers`}
      />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:p-8">
        {loadError && (
          <div className="text-sm font-medium text-brand-warn">
            Couldn't load credit sales — you're offline and no cached data is available on this device yet.
          </div>
        )}
        {!loadError && stale && (
          <div className="rounded-lg bg-brand-warnBg px-3 py-2 text-sm font-medium text-brand-warn">
            Offline — showing figures from {cachedAt ? new Date(cachedAt).toLocaleString("en-KE") : "the last time this device was online"}.
            Will update automatically once you're back online.
          </div>
        )}
        {!loadError && creditSaleCount > 0 && (
          <div className="rounded-lg bg-brand-accent/10 px-3 py-2 text-sm font-medium text-brand-accentText">
            Includes {creditSaleCount} credit sale{creditSaleCount === 1 ? "" : "s"} made on this device that{" "}
            {creditSaleCount === 1 ? "hasn't" : "haven't"} synced yet — balances are estimates until they do.
          </div>
        )}
        <Card>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-5 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                <span>CUSTOMER</span>
                <span>PHONE</span>
                <span>OWES</span>
                <span>DUE DATE</span>
                <span>ACTION</span>
              </div>
              {displayCustomers.map((c) => {
                const overdue = isOverdue(c.oldestDueDate);
                return (
                  <div key={c.id} className="grid grid-cols-5 items-center border-b border-brand-border/60 py-2.5 text-sm">
                    <button
                      onClick={() => setExpandedCustomer(expandedCustomer?.id === c.id ? null : { id: c.id, name: c.name })}
                      className={`w-fit text-left font-semibold hover:underline ${
                        expandedCustomer?.id === c.id ? "text-brand-accentDeep" : "text-brand-ink"
                      }`}
                    >
                      {c.name}
                    </button>
                    <span className="text-brand-inkMuted">{c.phone ?? "—"}</span>
                    <span className="font-bold text-brand-warn">{currencyFmt.format(Number(c.creditBalance))}</span>
                    <span className={overdue ? "font-bold text-brand-warn" : "text-brand-inkMuted"}>
                      {c.oldestDueDate ? new Date(c.oldestDueDate).toLocaleDateString("en-KE") : "—"}
                      {overdue && " (overdue)"}
                    </span>
                    {isLocalCustomerId(c.id) ? (
                      // This customer was created inline during a credit sale
                      // on some device and hasn't synced yet — the server
                      // doesn't know this id, so there's nothing to record a
                      // payment against until it does.
                      <span className="text-xs text-brand-inkMuted">Syncing…</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          className="w-fit px-3 py-1.5 text-xs"
                          onClick={() => setPayingCustomer({ id: c.id, name: c.name, balance: Number(c.creditBalance) })}
                        >
                          Record payment
                        </Button>
                        <button
                          onClick={() => deleteCustomer(c)}
                          className="w-fit rounded-md px-2 py-1.5 text-xs font-semibold text-brand-warn hover:bg-brand-warnBg"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {displayCustomers.length === 0 && !loadError && (
                <div className="py-6 text-sm text-brand-inkMuted">No outstanding credit balances.</div>
              )}
            </div>
          </div>
        </Card>

        {expandedCustomer && (
          <CreditSaleHistory
            customerId={expandedCustomer.id}
            customerName={expandedCustomer.name}
            onClose={() => setExpandedCustomer(null)}
          />
        )}
      </div>

      {payingCustomer && (
        <RecordPaymentModal
          customerName={payingCustomer.name}
          outstanding={payingCustomer.balance}
          onClose={() => setPayingCustomer(null)}
          onSubmit={(data) => recordPayment(payingCustomer.id, data)}
        />
      )}
    </>
  );
}
