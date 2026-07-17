import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getCached } from "../lib/cachedFetch";
import { ApiError } from "../lib/api";
import { SALES_SYNCED_EVENT } from "../lib/sync";
import { overlayDashboard } from "../lib/offlineStats";
import { localDb } from "../db/localDb";
import { useAuth } from "../context/AuthContext";
import type { DashboardData } from "../types/reports";
import { Topbar } from "../components/Topbar";
import { Card, StatCard } from "../components/ui";

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { weekday: "short" });

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [stale, setStale] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sales rung up on this device that the server doesn't know about yet —
  // reactively re-queried by Dexie the instant a sale is queued or its sync
  // status changes, which is what makes the stats below update the moment a
  // cashier completes a sale, with no polling and no network round trip.
  const unsyncedSales = useLiveQuery(
    () => localDb.pendingSales.where("syncStatus").anyOf("pending", "error").toArray(),
    [],
    []
  );

  const displayData = useMemo(
    () => (data ? overlayDashboard(data, unsyncedSales, { id: user?.id ?? "", name: user?.name ?? "You" }) : null),
    [data, unsyncedSales, user]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await getCached<DashboardData>("/api/reports/dashboard");
        if (cancelled) return;
        setData(res.data);
        setStale(res.stale);
        setCachedAt(res.cachedAt);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Routing normally keeps a user without VIEW_REPORTS off this page
        // entirely (see App.tsx), but permissions can change mid-session —
        // a 403 here means the request reached the server and was actually
        // rejected, which is a different problem than no connection at all.
        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view the dashboard — ask an admin to grant Reports access.");
        } else {
          setError("Couldn't load the dashboard — you're offline and no cached data is available on this device yet.");
        }
      }
    }

    void load();
    // Re-fetch the moment connectivity returns, so a dashboard left open
    // through an outage catches up without needing a manual refresh. Also
    // re-fetch once a sync batch actually confirms — "online" alone can fire
    // (and this refetch can resolve) before flushPendingSales finishes
    // syncing, which would otherwise cache a stale pre-sync snapshot with no
    // further trigger to correct it.
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    window.addEventListener(SALES_SYNCED_EVENT, onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener(SALES_SYNCED_EVENT, onOnline);
    };
  }, []);

  const maxWeekly = displayData ? Math.max(...displayData.weeklySales.map((d) => d.total), 1) : 1;
  const unsyncedCount = unsyncedSales?.length ?? 0;

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={new Date().toLocaleDateString("en-KE", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-4 sm:p-6 lg:p-8">
        {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
        {!error && stale && (
          <div className="rounded-lg bg-brand-warnBg px-3 py-2 text-sm font-medium text-brand-warn">
            Offline — showing figures from {cachedAt ? new Date(cachedAt).toLocaleString("en-KE") : "the last time this device was online"}.
            Will update automatically once you're back online.
          </div>
        )}
        {!error && unsyncedCount > 0 && (
          <div className="rounded-lg bg-brand-accent/10 px-3 py-2 text-sm font-medium text-brand-accentText">
            Includes {unsyncedCount} sale{unsyncedCount === 1 ? "" : "s"} made on this device that {unsyncedCount === 1 ? "hasn't" : "haven't"}{" "}
            synced yet — figures are estimates until they do.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="Today's Sales" value={displayData ? currencyFmt.format(displayData.todaysSalesTotal) : "—"} delta="Updated live" />
          <StatCard label="Transactions" value={displayData ? String(displayData.todaysTransactionCount) : "—"} />
          <StatCard
            label="Low Stock Items"
            value={displayData ? String(displayData.lowStock.length) : "—"}
            delta={displayData && displayData.lowStock.length > 0 ? "Needs attention" : undefined}
            deltaTone="warning"
          />
          <StatCard
            label="Weekly Total"
            value={displayData ? currencyFmt.format(displayData.weeklySales.reduce((s, d) => s + d.total, 0)) : "—"}
          />
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card className="flex flex-col">
            <div className="mb-4 font-display text-[15px] font-bold text-brand-ink">Weekly Sales</div>
            <div className="flex flex-1 items-end gap-2 px-2 pb-2 sm:gap-4">
              {displayData?.weeklySales.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full max-w-[34px] rounded-t-lg rounded-b-[3px] bg-gradient-to-b from-brand-accent to-brand-accentDeep"
                    style={{ height: `${Math.max((d.total / maxWeekly) * 180, 4)}px` }}
                  />
                  <span className="text-[11px] text-brand-inkMuted">{dayLabel(d.date)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex min-h-0 flex-col">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-[15px] font-bold text-brand-ink">Low Stock Alerts</span>
              <span className="rounded-full bg-brand-warn px-2.5 py-0.5 text-xs font-bold text-white">
                {displayData?.lowStock.length ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-2.5 overflow-auto">
              {displayData?.lowStock.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-[10px] bg-brand-bg px-3 py-2.5">
                  <div>
                    <div className="text-[13px] font-semibold text-brand-ink">{p.name}</div>
                    <div className="text-[11.5px] text-brand-inkMuted">{p.sku}</div>
                  </div>
                  <span className="text-[12.5px] font-bold text-brand-warn">
                    {p.stockQty > 0 ? `${p.stockQty} left` : p.stockQty === 0 ? "Out of stock" : `${-p.stockQty} on backorder`}
                  </span>
                </div>
              ))}
              {displayData && displayData.lowStock.length === 0 && (
                <div className="text-sm text-brand-inkMuted">Everything is well stocked.</div>
              )}
            </div>
          </Card>
        </div>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-[15px] font-bold text-brand-ink">Recent Orders</span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[1fr_1.6fr_0.9fr_0.9fr_1fr_0.9fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                <span>ORDER</span>
                <span>CASHIER</span>
                <span>ITEMS</span>
                <span>TOTAL</span>
                <span>PAYMENT</span>
                <span>STATUS</span>
              </div>
              {displayData?.recentSales.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[1fr_1.6fr_0.9fr_0.9fr_1fr_0.9fr] items-center border-b border-brand-border/60 py-2.5 text-[13px] text-brand-ink"
                >
                  <span className="font-semibold">{s.id.slice(0, 8)}</span>
                  <span>{s.cashier.name}</span>
                  <span>{s.items.reduce((n, i) => n + i.quantity, 0)}</span>
                  <span className="font-semibold">{currencyFmt.format(s.total)}</span>
                  <span>{s.paymentMethod}</span>
                  <span className="w-fit rounded-full bg-brand-accent/20 px-2.5 py-1 text-[11.5px] font-bold text-brand-accentText">
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
