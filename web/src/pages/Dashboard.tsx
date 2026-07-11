import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Card, StatCard } from "../components/ui";

interface DashboardData {
  todaysSalesTotal: number;
  todaysTransactionCount: number;
  weeklySales: { date: string; total: number }[];
  lowStock: { id: string; name: string; sku: string; stockQty: number; lowStockThreshold: number }[];
  recentSales: {
    id: string;
    total: number;
    paymentMethod: string;
    status: string;
    items: { quantity: number }[];
    cashier: { name: string };
    createdAt: string;
  }[];
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { weekday: "short" });

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardData>("/api/reports/dashboard")
      .then(setData)
      .catch(() => setError("Couldn't load dashboard — showing cached view may be unavailable offline."));
  }, []);

  const maxWeekly = data ? Math.max(...data.weeklySales.map((d) => d.total), 1) : 1;

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={new Date().toLocaleDateString("en-KE", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-4 sm:p-6 lg:p-8">
        {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="Today's Sales" value={data ? currencyFmt.format(data.todaysSalesTotal) : "—"} delta="Updated live" />
          <StatCard label="Transactions" value={data ? String(data.todaysTransactionCount) : "—"} />
          <StatCard
            label="Low Stock Items"
            value={data ? String(data.lowStock.length) : "—"}
            delta={data && data.lowStock.length > 0 ? "Needs attention" : undefined}
            deltaTone="warning"
          />
          <StatCard label="Weekly Total" value={data ? currencyFmt.format(data.weeklySales.reduce((s, d) => s + d.total, 0)) : "—"} />
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card className="flex flex-col">
            <div className="mb-4 font-display text-[15px] font-bold text-brand-ink">Weekly Sales</div>
            <div className="flex flex-1 items-end gap-2 px-2 pb-2 sm:gap-4">
              {data?.weeklySales.map((d) => (
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
                {data?.lowStock.length ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-2.5 overflow-auto">
              {data?.lowStock.map((p) => (
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
              {data && data.lowStock.length === 0 && (
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
              {data?.recentSales.map((s) => (
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
