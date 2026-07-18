import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getCached } from "../lib/cachedFetch";
import { api, ApiError } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import { SALES_SYNCED_EVENT } from "../lib/sync";
import { localDb } from "../db/localDb";
import { useAuth } from "../context/AuthContext";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "../lib/paymentMethods";
import {
  filterSalesByRange,
  overlayAnalytics,
  overlayCustomers,
  overlayEmployeePerformance,
  overlayFinance,
  overlayInventory,
  overlayProfit,
  overlayProfitLoss,
  overlaySalesSummary,
} from "../lib/offlineStats";
import type {
  AnalyticsReport,
  CustomersReport,
  EmployeeRow,
  FinanceReport,
  InventoryReport,
  ProfitLossReport,
  ProfitReport,
  SaleHistoryRow,
  SalesSummary,
  SuppliersReport,
  TimeseriesPoint,
} from "../types/reports";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });
const compactCurrencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", notation: "compact", maximumFractionDigits: 1 });

// Fixed categorical hues (validated for lightness/chroma/CVD separation) — used
// consistently across every chart on this page, never reassigned per-series.
const CHART_COLORS = { sales: "#3b6fd6", expenses: "#e08a2c", profit: "#2e9e52" };
const INK = "#181611";
const INK_MUTED = "#65635d";
const SURFACE = "#f9f8f5";
const GRID = "#e9e8e4";
const AVG_LINE = "#c9c6bd";

// Calendar-day key in the viewer's local timezone (not UTC), so a sale made
// at 11pm and one made just after midnight land in different day groups
// exactly when a human would expect, not when UTC happens to roll over.
function dayKeyFor(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Renders a "YYYY-MM-DD" day key as a full local date label — used for the
// empty state when a date picked on the calendar has no sales. Parsed as
// y/m/d components (not `new Date(dayKey)`) so it's built from the same
// local-calendar-day meaning as dayKeyFor, not reinterpreted as UTC midnight.
function formatDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatBucketLabel(label: string, granularity: "day" | "month"): string {
  if (granularity === "month") {
    const [year, month] = label.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-KE", { month: "short", year: "2-digit" });
  }
  const [year, month, day] = label.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}

const TABS = ["P&L", "Sales", "Profit", "Inventory", "Finance", "Customers", "Suppliers", "Employees"] as const;
type Tab = (typeof TABS)[number];

const STANDARD_PERIODS = ["Today", "This Week", "This Month", "All Time"] as const;
const PERIODS = [...STANDARD_PERIODS, "Custom"] as const;
type Period = (typeof PERIODS)[number];

function periodRange(period: Period, customFrom: string, customTo: string): { from?: Date; to?: Date } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "Today":
      return { from: startOfToday, to: now };
    case "This Week": {
      const from = new Date(startOfToday);
      from.setDate(from.getDate() - 6);
      return { from, to: now };
    }
    case "This Month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    case "All Time":
      return {};
    case "Custom":
      return {
        from: customFrom ? new Date(`${customFrom}T00:00:00`) : undefined,
        to: customTo ? new Date(`${customTo}T23:59:59.999`) : undefined,
      };
  }
}

function periodLabel(period: Period, customFrom: string, customTo: string): string {
  if (period !== "Custom") return period;
  if (customFrom && customTo) return `${customFrom} to ${customTo}`;
  if (customFrom) return `From ${customFrom}`;
  if (customTo) return `Until ${customTo}`;
  return "Custom range";
}

export function Reports() {
  const [tab, setTab] = useState<Tab>("P&L");
  const [period, setPeriod] = useState<Period>("Today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [profitLoss, setProfitLoss] = useState<ProfitLossReport | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [inventory, setInventory] = useState<InventoryReport | null>(null);
  const [finance, setFinance] = useState<FinanceReport | null>(null);
  const [customers, setCustomers] = useState<CustomersReport | null>(null);
  const [suppliers, setSuppliers] = useState<SuppliersReport | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  // Shared across tabs since only one is visible at a time — reflects
  // whichever tab's data is currently on screen.
  const [stale, setStale] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [permissionError, setPermissionError] = useState(false);

  // Drill-down for the Employees tab: clicking a row in "Sales by employee"
  // below selects a cashierId and shows their complete sale-by-sale history
  // (not scoped to the period selector above, unlike the summary it's
  // attached to — the whole point of a history is to see everything).
  const [selectedEmployee, setSelectedEmployee] = useState<{ cashierId: string; name: string } | null>(null);
  const [employeeSales, setEmployeeSales] = useState<SaleHistoryRow[]>([]);
  const [employeeSalesLoading, setEmployeeSalesLoading] = useState(false);
  const [employeeSalesError, setEmployeeSalesError] = useState<string | null>(null);
  const [employeePaymentFilter, setEmployeePaymentFilter] = useState<PaymentMethod | "">("");
  // Which row in the sales-history table (below) is expanded to show its
  // line items + customer — at most one at a time, collapsed by default so
  // the table stays scannable.
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  // Groups the (already newest-first) sales history into per-day sections
  // instead of one long mixed list, so e.g. a busy Saturday isn't scattered
  // across the same continuous scroll as last Tuesday.
  const salesByDay = useMemo(() => {
    const todayKey = dayKeyFor(new Date());
    const yesterdayKey = dayKeyFor(new Date(Date.now() - 86_400_000));
    const groups = new Map<string, SaleHistoryRow[]>();
    for (const s of employeeSales) {
      const key = dayKeyFor(new Date(s.createdAt));
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
    }
    return Array.from(groups.entries()).map(([dayKey, sales]) => ({
      dayKey,
      dayLabel:
        dayKey === todayKey
          ? "Today"
          : dayKey === yesterdayKey
            ? "Yesterday"
            : new Date(sales[0].createdAt).toLocaleDateString("en-KE", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
      sales,
    }));
  }, [employeeSales]);

  // Which day's sales are on screen — a dropdown jump instead of scrolling
  // through every day at once, since a long-tenured employee's "complete
  // history" can span months. Snaps to the most recent day whenever the
  // underlying sales change (a different employee selected, or the payment
  // filter changes what's in range).
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDayKey(salesByDay[0]?.dayKey ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeSales]);
  const activeDay = salesByDay.find((g) => g.dayKey === selectedDayKey) ?? null;

  const { user } = useAuth();
  const currentUser = useMemo(() => ({ id: user?.id ?? "", name: user?.name ?? "You" }), [user]);

  // Sales rung up on this device the server doesn't know about yet —
  // reactively re-queried by Dexie the instant a sale is queued or its sync
  // status changes, so every report below updates the moment a cashier
  // completes a sale, offline or on, with no polling or network round trip.
  const unsyncedSales = useLiveQuery(
    () => localDb.pendingSales.where("syncStatus").anyOf("pending", "error").toArray(),
    [],
    []
  );
  // Cost isn't on PendingSaleItem (checkout only knows retail price), so
  // COGS-dependent overlays (Profit, P&L, Analytics) look it up here from the
  // same local product cache Checkout uses — see lib/sync.ts's
  // refreshProductCache().
  const productCost = useLiveQuery(
    async () => new Map((await localDb.products.toArray()).filter((p) => p.cost != null).map((p) => [p.id, p.cost as number])),
    [],
    new Map<string, number>()
  );

  const periodSales = useMemo(() => {
    const { from, to } = periodRange(period, customFrom, customTo);
    return filterSalesByRange(unsyncedSales, from, to);
  }, [unsyncedSales, period, customFrom, customTo]);

  const displayProfitLoss = useMemo(
    () => (profitLoss ? overlayProfitLoss(profitLoss, periodSales, productCost) : null),
    [profitLoss, periodSales, productCost]
  );
  const displayAnalytics = useMemo(
    () => (analytics ? overlayAnalytics(analytics, periodSales, productCost) : null),
    [analytics, periodSales, productCost]
  );
  const displaySales = useMemo(() => (sales ? overlaySalesSummary(sales, periodSales) : null), [sales, periodSales]);
  const displayProfit = useMemo(
    () => (profit ? overlayProfit(profit, periodSales, productCost) : null),
    [profit, periodSales, productCost]
  );
  // Inventory is a point-in-time stock snapshot, not date-ranged — every
  // unsynced sale (regardless of when it was rung up) has already decremented
  // *current* stock, so it uses the full unsynced list, not periodSales.
  const displayInventory = useMemo(
    () => (inventory ? overlayInventory(inventory, unsyncedSales) : null),
    [inventory, unsyncedSales]
  );
  const displayFinance = useMemo(() => (finance ? overlayFinance(finance, periodSales) : null), [finance, periodSales]);
  const displayCustomers = useMemo(() => (customers ? overlayCustomers(customers, periodSales) : null), [customers, periodSales]);
  const displayEmployees = useMemo(
    () => (employees ? overlayEmployeePerformance(employees, periodSales, currentUser) : null),
    [employees, periodSales, currentUser]
  );

  const unsyncedCountForTab = tab === "Inventory" ? unsyncedSales.length : periodSales.length;

  function rangeQuery() {
    const { from, to } = periodRange(period, customFrom, customTo);
    const params = new URLSearchParams();
    if (from) params.set("from", from.toISOString());
    if (to) params.set("to", to.toISOString());
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  // A date-ranged report's actual request URL embeds `to: now()`, which
  // differs by a few milliseconds on every call — using that raw URL as the
  // cache key would mean it never hits the entry it just wrote. The cache key
  // instead identifies the report by which *period* is selected (stable
  // across repeated visits to the same period), separate from the exact
  // request URL sent over the wire.
  function reportCacheKey(reportPath: string): string {
    const periodKey = period === "Custom" ? `${customFrom || "open"}_${customTo || "open"}` : period;
    return `${reportPath}::${periodKey}`;
  }

  // Tries the network first and falls back to this device's last successful
  // response for this report+period when offline (see lib/cachedFetch.ts), so
  // every report tab keeps showing its most recent figures instead of going
  // blank.
  async function loadReport<T>(path: string, cacheKey: string, setter: (data: T) => void, cancelledRef: { current: boolean }) {
    try {
      const res = await getCached<T>(path, cacheKey);
      if (cancelledRef.current) return;
      setter(res.data);
      setStale(res.stale);
      setCachedAt(res.cachedAt);
      setLoadError(false);
      setPermissionError(false);
    } catch (err) {
      if (cancelledRef.current) return;
      // Reaching this page at all already requires VIEW_REPORTS (see
      // Sidebar's nav gating), so a 403 here only happens if that
      // permission was revoked mid-session — worth a distinct message
      // rather than the misleading "you're offline" one.
      if (err instanceof ApiError && err.status === 403) {
        setPermissionError(true);
      } else {
        setLoadError(true);
      }
    }
  }

  useEffect(() => {
    if (tab !== "P&L") return;
    const cancelledRef = { current: false };
    const load = () => {
      void loadReport(`/api/reports/profit-loss${rangeQuery()}`, reportCacheKey("/api/reports/profit-loss"), setProfitLoss, cancelledRef);
      void loadReport(`/api/reports/analytics${rangeQuery()}`, reportCacheKey("/api/reports/analytics"), setAnalytics, cancelledRef);
    };
    load();
    // Re-fetch the moment connectivity returns, so a report left open
    // through an outage catches up without a manual refresh. Also re-fetch
    // once a sync batch actually confirms — see the matching comment in
    // Dashboard.tsx for why "online" alone isn't enough.
    window.addEventListener("online", load);
    window.addEventListener(SALES_SYNCED_EVENT, load);
    return () => {
      cancelledRef.current = true;
      window.removeEventListener("online", load);
      window.removeEventListener(SALES_SYNCED_EVENT, load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period, customFrom, customTo]);

  useEffect(() => {
    if (tab === "P&L") return;
    const cancelledRef = { current: false };
    const load = () => {
      switch (tab) {
        case "Sales":
          void loadReport(`/api/reports/sales-summary${rangeQuery()}`, reportCacheKey("/api/reports/sales-summary"), setSales, cancelledRef);
          break;
        case "Profit":
          void loadReport(`/api/reports/profit${rangeQuery()}`, reportCacheKey("/api/reports/profit"), setProfit, cancelledRef);
          break;
        case "Inventory":
          void loadReport("/api/reports/inventory", "/api/reports/inventory", setInventory, cancelledRef);
          break;
        case "Finance":
          void loadReport(`/api/reports/finance${rangeQuery()}`, reportCacheKey("/api/reports/finance"), setFinance, cancelledRef);
          break;
        case "Customers":
          void loadReport(`/api/reports/customers${rangeQuery()}`, reportCacheKey("/api/reports/customers"), setCustomers, cancelledRef);
          break;
        case "Suppliers":
          void loadReport("/api/reports/suppliers", "/api/reports/suppliers", setSuppliers, cancelledRef);
          break;
        case "Employees":
          void loadReport(
            `/api/reports/employee-performance${rangeQuery()}`,
            reportCacheKey("/api/reports/employee-performance"),
            setEmployees,
            cancelledRef
          );
          break;
      }
    };
    load();
    window.addEventListener("online", load);
    window.addEventListener(SALES_SYNCED_EVENT, load);
    return () => {
      cancelledRef.current = true;
      window.removeEventListener("online", load);
      window.removeEventListener(SALES_SYNCED_EVENT, load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period, customFrom, customTo]);

  useEffect(() => {
    setExpandedSaleId(null);
    if (!selectedEmployee) {
      setEmployeeSales([]);
      return;
    }
    let cancelled = false;
    setEmployeeSalesLoading(true);
    setEmployeeSalesError(null);
    const params = new URLSearchParams({ cashierId: selectedEmployee.cashierId });
    if (employeePaymentFilter) params.set("paymentMethod", employeePaymentFilter);
    api
      .get<SaleHistoryRow[]>(`/api/sales?${params.toString()}`)
      .then((rows) => {
        if (!cancelled) setEmployeeSales(rows);
      })
      .catch((err) => {
        if (!cancelled) setEmployeeSalesError(err instanceof ApiError ? err.message : "Couldn't load sales history");
      })
      .finally(() => {
        if (!cancelled) setEmployeeSalesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEmployee, employeePaymentFilter]);

  function downloadPnl() {
    if (!displayProfitLoss) return;
    const slug = period === "Custom" && customFrom && customTo ? `${customFrom}_to_${customTo}` : period.toLowerCase().replace(/\s+/g, "-");
    downloadCsv(`profit-and-loss-${slug}.csv`, ["Line", "Amount (KSh)"], [
      ["Net Sales", displayProfitLoss.netSales],
      ["Cost of Goods Sold", -displayProfitLoss.cogs],
      ["Gross Profit", displayProfitLoss.grossProfit],
      ["Other Income", displayProfitLoss.otherIncome],
      ...displayProfitLoss.expensesByCategory.map((e): [string, number] => [`Expense: ${e.category}`, -e.amount]),
      ["Total Expenses", -displayProfitLoss.totalExpenses],
      ["Net Profit", displayProfitLoss.netProfit],
    ]);
  }

  const showDateRange = tab !== "Inventory" && tab !== "Suppliers";

  return (
    <>
      <Topbar title="Reports" subtitle="P&L, sales, profit, inventory, finance, customers, suppliers, employees" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === t ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {permissionError && (
          <div className="text-sm font-medium text-brand-warn">
            You don't have permission to view reports anymore — ask an admin to grant Reports access.
          </div>
        )}
        {!permissionError && loadError && (
          <div className="text-sm font-medium text-brand-warn">
            Couldn't load this report — you're offline and no cached data is available on this device yet.
          </div>
        )}
        {!permissionError && !loadError && stale && (
          <div className="rounded-lg bg-brand-warnBg px-3 py-2 text-sm font-medium text-brand-warn">
            Offline — showing figures from {cachedAt ? new Date(cachedAt).toLocaleString("en-KE") : "the last time this device was online"}.
            Will update automatically once you're back online.
          </div>
        )}
        {!permissionError && !loadError && tab !== "Suppliers" && unsyncedCountForTab > 0 && (
          <div className="rounded-lg bg-brand-accent/10 px-3 py-2 text-sm font-medium text-brand-accentText">
            Includes {unsyncedCountForTab} sale{unsyncedCountForTab === 1 ? "" : "s"} made on this device that{" "}
            {unsyncedCountForTab === 1 ? "hasn't" : "haven't"} synced yet — figures are estimates until they do.
          </div>
        )}

        {showDateRange && (
          <DateRangeControl
            period={period}
            onPeriodChange={setPeriod}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
          />
        )}
        {!showDateRange && (
          <div className="text-xs text-brand-inkMuted">Live snapshot — not scoped to a date range.</div>
        )}

        {tab === "P&L" && (
          <>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={downloadPnl} disabled={!displayProfitLoss}>
                Download CSV
              </Button>
            </div>

            <AnalyticsDashboard data={displayAnalytics} periodText={periodLabel(period, customFrom, customTo)} />

            <Card>
              <div className="mb-1 font-display text-[15px] font-bold text-brand-ink">
                Profit & Loss — {periodLabel(period, customFrom, customTo)}
              </div>
              <div className="mb-4 text-xs text-brand-inkMuted">{displayProfitLoss?.transactionCount ?? 0} transactions in this period</div>
              <div className="flex flex-col divide-y divide-brand-border/60">
                <Row label="Net Sales" value={displayProfitLoss?.netSales} />
                <Row label="Cost of Goods Sold" value={displayProfitLoss ? -displayProfitLoss.cogs : undefined} />
                <Row label="Gross Profit" value={displayProfitLoss?.grossProfit} bold />
                <Row label="Other Income" value={displayProfitLoss?.otherIncome} />
                {displayProfitLoss?.expensesByCategory.map((e) => (
                  <Row key={e.category} label={`Expense — ${e.category}`} value={-e.amount} indent />
                ))}
                <Row label="Total Expenses" value={displayProfitLoss ? -displayProfitLoss.totalExpenses : undefined} />
                <Row label="Net Profit" value={displayProfitLoss?.netProfit} bold accent />
              </div>
            </Card>
          </>
        )}

        {tab === "Sales" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!displaySales}
                onClick={() =>
                  displaySales &&
                  downloadCsv(
                    "sales-top-products.csv",
                    ["Product", "Qty Sold", "Revenue (KSh)"],
                    displaySales.topProducts.map((p) => [p.name, p._sum.quantity ?? 0, p._sum.lineTotal ?? 0])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Total Revenue</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(displaySales?.totals._sum.total ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Transactions</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{displaySales?.totals._count ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Tax Collected</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(displaySales?.totals._sum.taxTotal ?? 0)}</div>
              </Card>
            </div>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Sales by payment method</div>
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="grid grid-cols-[1.4fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                    <span>METHOD</span>
                    <span>SALES</span>
                    <span>AMOUNT</span>
                  </div>
                  {displaySales?.byPaymentMethod.map((row) => (
                    <div key={row.paymentMethod} className="grid grid-cols-[1.4fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-sm">
                      <span className="font-semibold text-brand-ink">{row.paymentMethod}</span>
                      <span className="text-brand-inkMuted">{row._count} sales</span>
                      <span className="font-semibold">{currencyFmt.format(row._sum.total ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Top products</div>
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                    <span>PRODUCT</span>
                    <span>QTY SOLD</span>
                    <span>REVENUE</span>
                  </div>
                  {displaySales?.topProducts.map((p) => (
                    <div key={p.productId} className="grid grid-cols-[2fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-sm">
                      <span className="font-semibold text-brand-ink">{p.name}</span>
                      <span className="text-brand-inkMuted">{p._sum.quantity ?? 0} sold</span>
                      <span className="font-semibold">{currencyFmt.format(p._sum.lineTotal ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </>
        )}

        {tab === "Profit" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!displayProfit}
                onClick={() =>
                  displayProfit &&
                  downloadCsv(
                    "profit-by-product.csv",
                    ["Product", "Revenue (KSh)", "Cost (KSh)", "Profit (KSh)"],
                    displayProfit.byProduct.map((p) => [p.name, p.revenue, p.cost, p.profit])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Revenue</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(displayProfit?.revenue ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Cost of Goods Sold</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(displayProfit?.cogs ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Gross Profit</div>
                <div className="font-display text-2xl font-bold text-brand-accentText">{currencyFmt.format(displayProfit?.grossProfit ?? 0)}</div>
              </Card>
            </div>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Profit by product</div>
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                    <span>PRODUCT</span>
                    <span>REVENUE</span>
                    <span>PROFIT</span>
                  </div>
                  {displayProfit?.byProduct
                    .sort((a, b) => b.profit - a.profit)
                    .map((p) => (
                      <div key={p.productId} className="grid grid-cols-[2fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-sm">
                        <span className="font-semibold text-brand-ink">{p.name}</span>
                        <span className="text-brand-inkMuted">{currencyFmt.format(p.revenue)}</span>
                        <span className="font-semibold text-brand-accentText">{currencyFmt.format(p.profit)}</span>
                      </div>
                    ))}
                </div>
              </div>
            </Card>
          </>
        )}

        {tab === "Inventory" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!displayInventory}
                onClick={() =>
                  displayInventory &&
                  downloadCsv(
                    "inventory-valuation.csv",
                    ["Product", "SKU", "Stock Qty", "Unit Price (KSh)", "Value (KSh)"],
                    displayInventory.products.map((p) => [p.name, p.sku, p.stockQty, Number(p.price), p.stockQty * Number(p.price)])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Products</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{displayInventory?.productCount ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Units in stock</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{displayInventory?.totalUnits ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Retail Value</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(displayInventory?.retailValue ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Potential Profit</div>
                <div className="font-display text-2xl font-bold text-brand-accentText">
                  {currencyFmt.format(displayInventory?.potentialProfit ?? 0)}
                </div>
              </Card>
            </div>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Stock valuation</div>
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                    <span>PRODUCT</span>
                    <span>STOCK</span>
                    <span>VALUE</span>
                  </div>
                  {displayInventory?.products.map((p) => (
                    <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-sm">
                      <span className="font-semibold text-brand-ink">{p.name}</span>
                      <span className="text-brand-inkMuted">{p.stockQty} units</span>
                      <span className="font-semibold">{currencyFmt.format(p.stockQty * Number(p.price))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </>
        )}

        {tab === "Finance" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!displayFinance}
                onClick={() =>
                  displayFinance &&
                  downloadCsv(
                    "finance-summary.csv",
                    ["Line", "Amount (KSh)"],
                    [
                      ["Sales Revenue", displayFinance.revenue],
                      ["Other Income", displayFinance.otherIncome],
                      ["Approved Expenses", displayFinance.expenses],
                      ["Net Cash Flow", displayFinance.netCashFlow],
                      ["Credit Outstanding", displayFinance.creditOutstanding],
                    ]
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Sales Revenue</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(displayFinance?.revenue ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Other Income</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(displayFinance?.otherIncome ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Approved Expenses</div>
                <div className="font-display text-2xl font-bold text-brand-warn">{currencyFmt.format(displayFinance?.expenses ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Net Cash Flow</div>
                <div className="font-display text-2xl font-bold text-brand-accentText">{currencyFmt.format(displayFinance?.netCashFlow ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Credit Outstanding</div>
                <div className="font-display text-2xl font-bold text-brand-warn">
                  {currencyFmt.format(displayFinance?.creditOutstanding ?? 0)}
                </div>
              </Card>
            </div>
          </>
        )}

        {tab === "Customers" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!displayCustomers}
                onClick={() =>
                  displayCustomers &&
                  downloadCsv(
                    "top-customers.csv",
                    ["Customer", "Orders", "Total Spent (KSh)"],
                    displayCustomers.topCustomers.map((c) => [c.name, c.orderCount, c.totalSpent])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Total Customers</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{displayCustomers?.totalCustomers ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Credit Outstanding</div>
                <div className="font-display text-2xl font-bold text-brand-warn">
                  {currencyFmt.format(displayCustomers?.creditOutstanding ?? 0)}
                </div>
              </Card>
            </div>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Top customers</div>
              {displayCustomers && displayCustomers.topCustomers.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="min-w-[420px]">
                    <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                      <span>CUSTOMER</span>
                      <span>ORDERS</span>
                      <span>TOTAL SPENT</span>
                    </div>
                    {displayCustomers.topCustomers.map((c) => (
                      <div key={c.customerId} className="grid grid-cols-[2fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-sm">
                        <span className="font-semibold text-brand-ink">{c.name}</span>
                        <span className="text-brand-inkMuted">{c.orderCount} orders</span>
                        <span className="font-semibold">{currencyFmt.format(c.totalSpent)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {displayCustomers && displayCustomers.topCustomers.length === 0 && (
                <div className="text-sm text-brand-inkMuted">No customer sales in this period.</div>
              )}
            </Card>
          </>
        )}

        {tab === "Suppliers" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!suppliers}
                onClick={() =>
                  suppliers &&
                  downloadCsv(
                    "supplier-balances.csv",
                    ["Supplier", "Balance Owed (KSh)"],
                    suppliers.suppliers.map((s) => [s.name, Number(s.balance)])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <Card>
              <div className="text-[12.5px] font-semibold text-brand-inkMuted">Total Owed to Suppliers</div>
              <div className="font-display text-2xl font-bold text-brand-warn">{currencyFmt.format(suppliers?.totalOwed ?? 0)}</div>
            </Card>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">By supplier</div>
              {suppliers?.suppliers.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-brand-border/60 py-2 text-sm">
                  <span className="font-semibold text-brand-ink">{s.name}</span>
                  <span className={`font-semibold ${Number(s.balance) > 0 ? "text-brand-warn" : "text-brand-accentText"}`}>
                    {currencyFmt.format(Number(s.balance))}
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}

        {tab === "Employees" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!displayEmployees}
                onClick={() =>
                  displayEmployees &&
                  downloadCsv(
                    "employee-performance.csv",
                    ["Employee", "Transactions", "Total Sales (KSh)"],
                    displayEmployees.map((e) => [e.name, e.transactionCount, e.totalSales])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Sales by employee</div>
              {displayEmployees && displayEmployees.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="min-w-[420px]">
                    <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                      <span>EMPLOYEE</span>
                      <span>SALES</span>
                      <span>TOTAL SALES</span>
                    </div>
                    {displayEmployees.map((e) => (
                      <button
                        key={e.cashierId}
                        onClick={() => {
                          setSelectedEmployee({ cashierId: e.cashierId, name: e.name });
                          setEmployeePaymentFilter("");
                        }}
                        className={`grid w-full grid-cols-[2fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-left text-sm hover:bg-brand-bg ${
                          selectedEmployee?.cashierId === e.cashierId ? "bg-brand-bg" : ""
                        }`}
                      >
                        <span className="font-semibold text-brand-ink">{e.name}</span>
                        <span className="text-brand-inkMuted">{e.transactionCount} sales</span>
                        <span className="font-semibold">{currencyFmt.format(e.totalSales)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {displayEmployees && displayEmployees.length === 0 && (
                <div className="text-sm text-brand-inkMuted">No sales recorded in this period.</div>
              )}
              <div className="pt-3 text-xs text-brand-inkMuted">Tap an employee to see their complete sales history below.</div>
            </Card>

            {selectedEmployee && (
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-[15px] font-bold text-brand-ink">Sales history</div>
                    <div className="text-xs text-brand-inkMuted">{selectedEmployee.name} · complete history, not limited to the period above</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {salesByDay.length > 0 && (
                      <input
                        type="date"
                        value={selectedDayKey ?? ""}
                        min={salesByDay[salesByDay.length - 1]?.dayKey}
                        max={salesByDay[0]?.dayKey}
                        onChange={(e) => setSelectedDayKey(e.target.value || null)}
                        aria-label="Pick a date"
                        className="rounded-lg border border-brand-border px-3 py-2 text-sm"
                      />
                    )}
                    <select
                      value={employeePaymentFilter}
                      onChange={(e) => setEmployeePaymentFilter(e.target.value as PaymentMethod | "")}
                      className="rounded-lg border border-brand-border px-3 py-2 text-sm"
                    >
                      <option value="">All payment methods</option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {PAYMENT_METHOD_LABELS[m]}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setSelectedEmployee(null)}
                      aria-label="Close sales history"
                      className="text-sm text-brand-inkMuted hover:text-brand-ink"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {employeeSalesError && <div className="text-sm font-medium text-brand-warn">{employeeSalesError}</div>}
                {!employeeSalesError && employeeSalesLoading && <div className="text-sm text-brand-inkMuted">Loading…</div>}
                {!employeeSalesError && !employeeSalesLoading && activeDay && (
                  <div className="overflow-x-auto">
                    <div className="min-w-[600px]">
                      <div className="mb-1.5 flex items-baseline gap-2 rounded-md bg-brand-bg px-2 py-1.5">
                        <span className="text-[12.5px] font-bold text-brand-ink">{activeDay.dayLabel}</span>
                        <span className="text-[11px] text-brand-inkMuted">
                          {activeDay.sales.length} sale{activeDay.sales.length === 1 ? "" : "s"} ·{" "}
                          {currencyFmt.format(activeDay.sales.reduce((sum, s) => sum + Number(s.total), 0))}
                        </span>
                      </div>
                      <div className="grid grid-cols-[0.7fr_0.7fr_0.9fr_1.1fr_0.9fr] gap-2 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                        <span>TIME</span>
                        <span>ITEMS</span>
                        <span>TOTAL</span>
                        <span>PAYMENT</span>
                        <span>STATUS</span>
                      </div>
                      {activeDay.sales.map((s) => {
                        const createdAt = new Date(s.createdAt);
                        const expanded = expandedSaleId === s.id;
                        return (
                          <div key={s.id} className="border-b border-brand-border/60">
                            <button
                              onClick={() => setExpandedSaleId(expanded ? null : s.id)}
                              aria-expanded={expanded}
                              className={`grid w-full grid-cols-[0.7fr_0.7fr_0.9fr_1.1fr_0.9fr] items-center gap-2 py-2.5 text-left text-sm hover:bg-brand-bg ${
                                expanded ? "bg-brand-bg" : ""
                              }`}
                            >
                              <span className="text-brand-inkMuted">{createdAt.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" })}</span>
                              <span>{s.items.reduce((n, i) => n + i.quantity, 0)}</span>
                              <span className="font-semibold text-brand-ink">{currencyFmt.format(Number(s.total))}</span>
                              <span className="text-brand-inkMuted">
                                {PAYMENT_METHOD_LABELS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod}
                              </span>
                              <span className="w-fit rounded-full bg-brand-accent/20 px-2.5 py-1 text-[11.5px] font-bold text-brand-accentText">
                                {s.status}
                              </span>
                            </button>
                            {expanded && (
                              <div className="mb-2 rounded-lg bg-brand-bg px-3 py-3 text-sm">
                                <div className="mb-2 text-xs font-semibold text-brand-inkMuted">
                                  Sold to <span className="text-brand-ink">{s.customer?.name ?? "Walk-in customer (no name recorded)"}</span>
                                </div>
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
                {!employeeSalesError && !employeeSalesLoading && !activeDay && (
                  <div className="py-6 text-sm text-brand-inkMuted">
                    {employeeSales.length === 0
                      ? `No sales${employeePaymentFilter ? ` paid by ${PAYMENT_METHOD_LABELS[employeePaymentFilter]}` : ""} yet.`
                      : `No sales${employeePaymentFilter ? ` paid by ${PAYMENT_METHOD_LABELS[employeePaymentFilter]}` : ""} on ${
                          selectedDayKey ? formatDayKey(selectedDayKey) : "this date"
                        }.`}
                  </div>
                )}
                {!employeeSalesError && !employeeSalesLoading && activeDay && (
                  <div className="text-xs text-brand-inkMuted">Tap a sale to see the items sold and which customer it went to.</div>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}

function DateRangeControl({
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STANDARD_PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onPeriodChange(p)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${period === p ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}
        >
          {p}
        </button>
      ))}
      <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${period === "Custom" ? "bg-brand-accentDeep" : "bg-brand-bg"}`}>
        <input
          type="date"
          value={customFrom}
          onChange={(e) => {
            onCustomFromChange(e.target.value);
            onPeriodChange("Custom");
          }}
          className={`bg-transparent text-xs font-semibold outline-none ${period === "Custom" ? "text-white" : "text-brand-ink"}`}
        />
        <span className={`text-xs ${period === "Custom" ? "text-white/80" : "text-brand-inkMuted"}`}>to</span>
        <input
          type="date"
          value={customTo}
          onChange={(e) => {
            onCustomToChange(e.target.value);
            onPeriodChange("Custom");
          }}
          className={`bg-transparent text-xs font-semibold outline-none ${period === "Custom" ? "text-white" : "text-brand-ink"}`}
        />
      </div>
    </div>
  );
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function AnalyticsDashboard({ data, periodText }: { data: AnalyticsReport | null; periodText: string }) {
  const c = data?.current;
  const p = data?.previous;
  const revenueDelta = c && p ? pctChange(c.revenue, p.revenue) : null;
  const expensesDelta = c && p ? pctChange(c.expenses, p.expenses) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label="Revenue"
          value={compactCurrencyFmt.format(c?.revenue ?? 0)}
          fullValue={currencyFmt.format(c?.revenue ?? 0)}
          delta={revenueDelta}
          deltaGoodDirection="up"
        />
        <StatTile
          label="Expenses"
          value={compactCurrencyFmt.format(c?.expenses ?? 0)}
          fullValue={currencyFmt.format(c?.expenses ?? 0)}
          delta={expensesDelta}
          deltaGoodDirection="down"
        />
        <StatTile label="Gross Profit" value={compactCurrencyFmt.format(c?.grossProfit ?? 0)} fullValue={currencyFmt.format(c?.grossProfit ?? 0)} />
        <StatTile label="Net Profit" value={compactCurrencyFmt.format(c?.netProfit ?? 0)} fullValue={currencyFmt.format(c?.netProfit ?? 0)} />
        <StatTile label="Gross Margin" value={`${(c?.grossMarginPct ?? 0).toFixed(1)}%`} />
        <StatTile label="Net Margin" value={`${(c?.netMarginPct ?? 0).toFixed(1)}%`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="mb-1 font-display text-[15px] font-bold text-brand-ink">Revenue Trend</div>
          <div className="mb-3 text-xs text-brand-inkMuted">{periodText}</div>
          <TrendLineChart points={data?.trend ?? []} granularity={data?.granularity ?? "day"} />
        </Card>
        <Card className="flex flex-col">
          <div className="mb-1 font-display text-[15px] font-bold text-brand-ink">Top 5 Products by Revenue</div>
          <div className="mb-3 text-xs text-brand-inkMuted">{periodText}</div>
          <HorizontalBarChart data={data?.topProducts.map((p) => ({ label: p.name, value: p.revenue })) ?? []} color={CHART_COLORS.sales} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="flex flex-col">
          <div className="mb-1 font-display text-[15px] font-bold text-brand-ink">Top 5 Expenses by Category</div>
          <div className="mb-3 text-xs text-brand-inkMuted">{periodText}</div>
          <HorizontalBarChart
            data={data?.topExpenseCategories.map((e) => ({ label: e.category, value: e.amount })) ?? []}
            color={CHART_COLORS.expenses}
          />
        </Card>
        <Card>
          <div className="mb-1 font-display text-[15px] font-bold text-brand-ink">Income vs Expenses</div>
          <div className="mb-3 text-xs text-brand-inkMuted">{periodText}</div>
          <ComboChart points={data?.trend ?? []} granularity={data?.granularity ?? "day"} />
        </Card>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  fullValue,
  delta,
  deltaGoodDirection = "up",
}: {
  label: string;
  value: string;
  fullValue?: string;
  delta?: number | null;
  deltaGoodDirection?: "up" | "down";
}) {
  const isGood = delta == null ? null : deltaGoodDirection === "up" ? delta >= 0 : delta <= 0;
  return (
    <Card className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold text-brand-inkMuted">{label}</span>
      <span className="truncate font-display text-xl font-bold text-brand-ink sm:text-2xl" title={fullValue}>
        {value}
      </span>
      {delta != null && (
        <span className={`flex items-center gap-1 text-[11px] font-semibold ${isGood ? "text-brand-accentText" : "text-brand-warn"}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {Math.abs(delta).toFixed(1)}% vs prior period
        </span>
      )}
    </Card>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-inkMuted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function TrendLineChart({ points, granularity }: { points: TimeseriesPoint[]; granularity: "day" | "month" }) {
  if (points.length === 0) return <div className="py-10 text-center text-sm text-brand-inkMuted">No data for this period.</div>;

  const width = 640;
  const height = 200;
  const padTop = 26;
  const padBottom = 22;
  const padX = 8;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const values = points.map((p) => p.sales);
  const max = Math.max(...values, 1);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const xFor = (i: number) => padX + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yFor = (v: number) => padTop + innerH - ((v - min) / range) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.sales)}`).join(" ");
  const areaPath = `${linePath} L ${xFor(points.length - 1)} ${padTop + innerH} L ${xFor(0)} ${padTop + innerH} Z`;
  const avgY = yFor(avg);
  const last = points[points.length - 1];
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className={points.length > 14 ? "min-w-[720px]" : "w-full"} style={{ height: 200 }}>
          <line x1={padX} y1={avgY} x2={width - padX} y2={avgY} stroke={AVG_LINE} strokeWidth={1} strokeDasharray="4 4" />
          <text x={width - padX} y={avgY - 5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
            avg {compactCurrencyFmt.format(avg)}
          </text>
          <path d={areaPath} fill={CHART_COLORS.sales} opacity={0.08} stroke="none" />
          <path d={linePath} fill="none" stroke={CHART_COLORS.sales} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={p.label} cx={xFor(i)} cy={yFor(p.sales)} r={9} fill="transparent">
              <title>{`${formatBucketLabel(p.label, granularity)}: ${currencyFmt.format(p.sales)}`}</title>
            </circle>
          ))}
          <circle cx={xFor(points.length - 1)} cy={yFor(last.sales)} r={4} fill={CHART_COLORS.sales} stroke={SURFACE} strokeWidth={2} />
          <text x={xFor(points.length - 1)} y={yFor(last.sales) - 10} textAnchor="end" fontSize={11} fontWeight={600} fill={INK}>
            {compactCurrencyFmt.format(last.sales)}
          </text>
        </svg>
      </div>
      <div className="mt-1 flex px-2 text-[10px] text-brand-inkMuted">
        {points.map((p, i) => (
          <span key={p.label} className="flex-1 truncate text-center">
            {i === 0 || i === points.length - 1 || i % labelStep === 0 ? formatBucketLabel(p.label, granularity) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function ComboChart({ points, granularity }: { points: TimeseriesPoint[]; granularity: "day" | "month" }) {
  if (points.length === 0) return <div className="py-10 text-center text-sm text-brand-inkMuted">No data for this period.</div>;

  const width = 640;
  const height = 200;
  const padTop = 16;
  const padBottom = 22;
  const innerH = height - padTop - padBottom;

  const allValues = points.flatMap((p) => [p.sales, p.expenses, p.profit]);
  const max = Math.max(...allValues, 1);
  const min = Math.min(0, ...allValues);
  const range = max - min || 1;
  const yFor = (v: number) => padTop + innerH - ((v - min) / range) * innerH;
  const zeroY = yFor(0);

  const n = points.length;
  const slotW = width / n;
  const barW = Math.min(slotW * 0.3, 20);
  const gap = 2;
  const xFor = (i: number) => i * slotW + slotW / 2;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4">
        <LegendSwatch color={CHART_COLORS.sales} label="Sales" />
        <LegendSwatch color={CHART_COLORS.expenses} label="Expenses" />
        <LegendSwatch color={CHART_COLORS.profit} label="Profit" />
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className={n > 10 ? "min-w-[720px]" : "w-full"} style={{ height: 200 }}>
          <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={GRID} strokeWidth={1} />
          {points.map((p, i) => {
            const cx = xFor(i);
            const salesTop = Math.min(yFor(p.sales), zeroY);
            const salesH = Math.max(Math.abs(yFor(p.sales) - zeroY), p.sales === 0 ? 0 : 2);
            const expTop = Math.min(yFor(p.expenses), zeroY);
            const expH = Math.max(Math.abs(yFor(p.expenses) - zeroY), p.expenses === 0 ? 0 : 2);
            return (
              <g key={p.label}>
                <rect x={cx - barW - gap / 2} y={salesTop} width={barW} height={salesH} rx={3} fill={CHART_COLORS.sales}>
                  <title>{`Sales — ${formatBucketLabel(p.label, granularity)}: ${currencyFmt.format(p.sales)}`}</title>
                </rect>
                <rect x={cx + gap / 2} y={expTop} width={barW} height={expH} rx={3} fill={CHART_COLORS.expenses}>
                  <title>{`Expenses — ${formatBucketLabel(p.label, granularity)}: ${currencyFmt.format(p.expenses)}`}</title>
                </rect>
              </g>
            );
          })}
          <path
            d={points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.profit)}`).join(" ")}
            fill="none"
            stroke={CHART_COLORS.profit}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <circle key={p.label} cx={xFor(i)} cy={yFor(p.profit)} r={4} fill={CHART_COLORS.profit} stroke={SURFACE} strokeWidth={2}>
              <title>{`Profit — ${formatBucketLabel(p.label, granularity)}: ${currencyFmt.format(p.profit)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="mt-1 flex px-1 text-[10px] text-brand-inkMuted">
        {points.map((p) => (
          <span key={p.label} className="flex-1 truncate text-center">
            {formatBucketLabel(p.label, granularity)}
          </span>
        ))}
      </div>
    </div>
  );
}

function HorizontalBarChart({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  if (data.length === 0) return <div className="py-6 text-sm text-brand-inkMuted">No data for this period.</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2.5">
          <span className="w-24 shrink-0 truncate text-xs text-brand-inkMuted sm:w-28" title={d.label}>
            {d.label}
          </span>
          <div className="h-5 min-w-0 flex-1 rounded-full bg-brand-bg">
            <div
              className="h-5 rounded-full transition-[width]"
              style={{ width: `${Math.max((d.value / max) * 100, 4)}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs font-semibold text-brand-ink">{currencyFmt.format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, bold, accent, indent }: { label: string; value?: number; bold?: boolean; accent?: boolean; indent?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2.5 text-sm ${indent ? "pl-4" : ""}`}>
      <span className={bold ? "font-bold text-brand-ink" : "text-brand-inkMuted"}>{label}</span>
      <span className={`font-semibold ${accent ? "text-brand-accentText" : bold ? "text-brand-ink" : ""}`}>
        {value === undefined ? "—" : currencyFmt.format(value)}
      </span>
    </div>
  );
}
