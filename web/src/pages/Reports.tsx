import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

interface SalesSummary {
  totals: { _sum: { subtotal: number | null; taxTotal: number | null; total: number | null }; _count: number };
  byPaymentMethod: { paymentMethod: string; _sum: { total: number | null }; _count: number }[];
  topProducts: { productId: string; name: string; _sum: { quantity: number | null; lineTotal: number | null } }[];
}

interface ProfitReport {
  revenue: number;
  cogs: number;
  grossProfit: number;
  byProduct: { productId: string; name: string; revenue: number; cost: number; profit: number }[];
}

interface InventoryReport {
  productCount: number;
  totalUnits: number;
  retailValue: number;
  costValue: number;
  potentialProfit: number;
  products: { id: string; name: string; sku: string; stockQty: number; price: number; cost: number | null }[];
}

interface FinanceReport {
  revenue: number;
  expenses: number;
  otherIncome: number;
  netCashFlow: number;
  creditOutstanding: number;
}

interface CustomersReport {
  totalCustomers: number;
  creditOutstanding: number;
  topCustomers: { customerId: string; name: string; totalSpent: number; orderCount: number }[];
}

interface SuppliersReport {
  totalOwed: number;
  suppliers: { id: string; name: string; balance: number }[];
}

interface EmployeeRow {
  cashierId: string;
  name: string;
  totalSales: number;
  transactionCount: number;
}

interface ProfitLossReport {
  transactionCount: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  otherIncome: number;
  expensesByCategory: { category: string; amount: number }[];
  totalExpenses: number;
  netProfit: number;
}

interface TimeseriesPoint {
  label: string;
  sales: number;
  expenses: number;
  profit: number;
}

interface TimeseriesReport {
  granularity: "day" | "month";
  series: TimeseriesPoint[];
}

const CHART_METRICS = ["Sales", "Expenses", "Profit"] as const;
type ChartMetric = (typeof CHART_METRICS)[number];

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

const PERIODS = ["Today", "This Week", "This Month", "All Time"] as const;
type Period = (typeof PERIODS)[number];

function periodRange(period: Period): { from?: Date; to?: Date } {
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
  }
}

export function Reports() {
  const [tab, setTab] = useState<Tab>("P&L");
  const [period, setPeriod] = useState<Period>("Today");
  const [profitLoss, setProfitLoss] = useState<ProfitLossReport | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [inventory, setInventory] = useState<InventoryReport | null>(null);
  const [finance, setFinance] = useState<FinanceReport | null>(null);
  const [customers, setCustomers] = useState<CustomersReport | null>(null);
  const [suppliers, setSuppliers] = useState<SuppliersReport | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesReport | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("Sales");

  function rangeQuery() {
    const { from, to } = periodRange(period);
    const params = new URLSearchParams();
    if (from) params.set("from", from.toISOString());
    if (to) params.set("to", to.toISOString());
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  useEffect(() => {
    if (tab !== "P&L") return;
    void api.get<ProfitLossReport>(`/api/reports/profit-loss${rangeQuery()}`).then(setProfitLoss);
    void api.get<TimeseriesReport>(`/api/reports/timeseries${rangeQuery()}`).then(setTimeseries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period]);

  useEffect(() => {
    switch (tab) {
      case "Sales":
        if (!sales) void api.get<SalesSummary>("/api/reports/sales-summary").then(setSales);
        break;
      case "Profit":
        if (!profit) void api.get<ProfitReport>("/api/reports/profit").then(setProfit);
        break;
      case "Inventory":
        if (!inventory) void api.get<InventoryReport>("/api/reports/inventory").then(setInventory);
        break;
      case "Finance":
        if (!finance) void api.get<FinanceReport>("/api/reports/finance").then(setFinance);
        break;
      case "Customers":
        if (!customers) void api.get<CustomersReport>("/api/reports/customers").then(setCustomers);
        break;
      case "Suppliers":
        if (!suppliers) void api.get<SuppliersReport>("/api/reports/suppliers").then(setSuppliers);
        break;
      case "Employees":
        if (!employees) void api.get<EmployeeRow[]>("/api/reports/employee-performance").then(setEmployees);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function downloadPnl() {
    if (!profitLoss) return;
    downloadCsv(`profit-and-loss-${period.toLowerCase().replace(" ", "-")}.csv`, ["Line", "Amount (KSh)"], [
      ["Net Sales", profitLoss.netSales],
      ["Cost of Goods Sold", -profitLoss.cogs],
      ["Gross Profit", profitLoss.grossProfit],
      ["Other Income", profitLoss.otherIncome],
      ...profitLoss.expensesByCategory.map((e): [string, number] => [`Expense: ${e.category}`, -e.amount]),
      ["Total Expenses", -profitLoss.totalExpenses],
      ["Net Profit", profitLoss.netProfit],
    ]);
  }

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

        {tab === "P&L" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${period === p ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Button variant="secondary" onClick={downloadPnl} disabled={!profitLoss}>
                Download CSV
              </Button>
            </div>

            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="font-display text-[15px] font-bold text-brand-ink">{chartMetric} trend — {period}</span>
                <div className="flex flex-wrap gap-2">
                  {CHART_METRICS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setChartMetric(m)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${chartMetric === m ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <ReportChart metric={chartMetric} data={timeseries} />
            </Card>

            <Card>
              <div className="mb-1 font-display text-[15px] font-bold text-brand-ink">Profit & Loss — {period}</div>
              <div className="mb-4 text-xs text-brand-inkMuted">{profitLoss?.transactionCount ?? 0} transactions in this period</div>
              <div className="flex flex-col divide-y divide-brand-border/60">
                <Row label="Net Sales" value={profitLoss?.netSales} />
                <Row label="Cost of Goods Sold" value={profitLoss ? -profitLoss.cogs : undefined} />
                <Row label="Gross Profit" value={profitLoss?.grossProfit} bold />
                <Row label="Other Income" value={profitLoss?.otherIncome} />
                {profitLoss?.expensesByCategory.map((e) => (
                  <Row key={e.category} label={`Expense — ${e.category}`} value={-e.amount} indent />
                ))}
                <Row label="Total Expenses" value={profitLoss ? -profitLoss.totalExpenses : undefined} />
                <Row label="Net Profit" value={profitLoss?.netProfit} bold accent />
              </div>
            </Card>
          </>
        )}

        {tab === "Sales" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!sales}
                onClick={() =>
                  sales &&
                  downloadCsv(
                    "sales-top-products.csv",
                    ["Product", "Qty Sold", "Revenue (KSh)"],
                    sales.topProducts.map((p) => [p.name, p._sum.quantity ?? 0, p._sum.lineTotal ?? 0])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Total Revenue</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(sales?.totals._sum.total ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Transactions</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{sales?.totals._count ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Tax Collected</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(sales?.totals._sum.taxTotal ?? 0)}</div>
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
                  {sales?.byPaymentMethod.map((row) => (
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
                  {sales?.topProducts.map((p) => (
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
                disabled={!profit}
                onClick={() =>
                  profit &&
                  downloadCsv(
                    "profit-by-product.csv",
                    ["Product", "Revenue (KSh)", "Cost (KSh)", "Profit (KSh)"],
                    profit.byProduct.map((p) => [p.name, p.revenue, p.cost, p.profit])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Revenue</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(profit?.revenue ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Cost of Goods Sold</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(profit?.cogs ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Gross Profit</div>
                <div className="font-display text-2xl font-bold text-brand-accentText">{currencyFmt.format(profit?.grossProfit ?? 0)}</div>
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
                  {profit?.byProduct
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
                disabled={!inventory}
                onClick={() =>
                  inventory &&
                  downloadCsv(
                    "inventory-valuation.csv",
                    ["Product", "SKU", "Stock Qty", "Unit Price (KSh)", "Value (KSh)"],
                    inventory.products.map((p) => [p.name, p.sku, p.stockQty, Number(p.price), p.stockQty * Number(p.price)])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Products</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{inventory?.productCount ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Units in stock</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{inventory?.totalUnits ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Retail Value</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(inventory?.retailValue ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Potential Profit</div>
                <div className="font-display text-2xl font-bold text-brand-accentText">{currencyFmt.format(inventory?.potentialProfit ?? 0)}</div>
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
                  {inventory?.products.map((p) => (
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
                disabled={!finance}
                onClick={() =>
                  finance &&
                  downloadCsv(
                    "finance-summary.csv",
                    ["Line", "Amount (KSh)"],
                    [
                      ["Sales Revenue", finance.revenue],
                      ["Other Income", finance.otherIncome],
                      ["Approved Expenses", finance.expenses],
                      ["Net Cash Flow", finance.netCashFlow],
                      ["Credit Outstanding", finance.creditOutstanding],
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
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(finance?.revenue ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Other Income</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{currencyFmt.format(finance?.otherIncome ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Approved Expenses</div>
                <div className="font-display text-2xl font-bold text-brand-warn">{currencyFmt.format(finance?.expenses ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Net Cash Flow</div>
                <div className="font-display text-2xl font-bold text-brand-accentText">{currencyFmt.format(finance?.netCashFlow ?? 0)}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Credit Outstanding</div>
                <div className="font-display text-2xl font-bold text-brand-warn">{currencyFmt.format(finance?.creditOutstanding ?? 0)}</div>
              </Card>
            </div>
          </>
        )}

        {tab === "Customers" && (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={!customers}
                onClick={() =>
                  customers &&
                  downloadCsv(
                    "top-customers.csv",
                    ["Customer", "Orders", "Total Spent (KSh)"],
                    customers.topCustomers.map((c) => [c.name, c.orderCount, c.totalSpent])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Total Customers</div>
                <div className="font-display text-2xl font-bold text-brand-ink">{customers?.totalCustomers ?? 0}</div>
              </Card>
              <Card>
                <div className="text-[12.5px] font-semibold text-brand-inkMuted">Credit Outstanding</div>
                <div className="font-display text-2xl font-bold text-brand-warn">{currencyFmt.format(customers?.creditOutstanding ?? 0)}</div>
              </Card>
            </div>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Top customers</div>
              {customers && customers.topCustomers.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="min-w-[420px]">
                    <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                      <span>CUSTOMER</span>
                      <span>ORDERS</span>
                      <span>TOTAL SPENT</span>
                    </div>
                    {customers.topCustomers.map((c) => (
                      <div key={c.customerId} className="grid grid-cols-[2fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-sm">
                        <span className="font-semibold text-brand-ink">{c.name}</span>
                        <span className="text-brand-inkMuted">{c.orderCount} orders</span>
                        <span className="font-semibold">{currencyFmt.format(c.totalSpent)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {customers && customers.topCustomers.length === 0 && <div className="text-sm text-brand-inkMuted">No customer sales yet.</div>}
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
                disabled={!employees}
                onClick={() =>
                  employees &&
                  downloadCsv(
                    "employee-performance.csv",
                    ["Employee", "Transactions", "Total Sales (KSh)"],
                    employees.map((e) => [e.name, e.transactionCount, e.totalSales])
                  )
                }
              >
                Download CSV
              </Button>
            </div>
            <Card>
              <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Sales by employee</div>
              {employees && employees.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="min-w-[420px]">
                    <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                      <span>EMPLOYEE</span>
                      <span>SALES</span>
                      <span>TOTAL SALES</span>
                    </div>
                    {employees.map((e) => (
                      <div key={e.cashierId} className="grid grid-cols-[2fr_1fr_1fr] items-center border-b border-brand-border/60 py-2 text-sm">
                        <span className="font-semibold text-brand-ink">{e.name}</span>
                        <span className="text-brand-inkMuted">{e.transactionCount} sales</span>
                        <span className="font-semibold">{currencyFmt.format(e.totalSales)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {employees && employees.length === 0 && <div className="text-sm text-brand-inkMuted">No sales recorded yet.</div>}
            </Card>
          </>
        )}
      </div>
    </>
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

const CHART_BAR_HEIGHT = 140;

function ReportChart({ metric, data }: { metric: ChartMetric; data: TimeseriesReport | null }) {
  const key = metric.toLowerCase() as "sales" | "expenses" | "profit";
  const series = data?.series ?? [];
  const total = series.reduce((sum, pt) => sum + pt[key], 0);
  const maxAbs = Math.max(...series.map((pt) => Math.abs(pt[key])), 1);
  const hasNegative = series.some((pt) => pt[key] < 0);

  return (
    <div>
      <div className="mb-3 text-xl font-bold text-brand-ink">
        {currencyFmt.format(total)} <span className="text-xs font-normal text-brand-inkMuted">total {metric.toLowerCase()}</span>
      </div>
      {series.length === 0 ? (
        <div className="py-10 text-center text-sm text-brand-inkMuted">No data for this period.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className={`flex items-stretch gap-2 px-1 ${series.length > 10 ? "min-w-[720px]" : ""}`} style={{ height: CHART_BAR_HEIGHT + 24 }}>
            {series.map((pt) => {
              const value = pt[key];
              const barHeight = Math.max((Math.abs(value) / maxAbs) * (CHART_BAR_HEIGHT / (hasNegative ? 2 : 1)), value === 0 ? 0 : 3);
              const barColor = value < 0 ? "bg-brand-warn" : "bg-gradient-to-b from-brand-accent to-brand-accentDeep";
              return (
                <div key={pt.label} className="flex min-w-[28px] flex-1 flex-col items-center">
                  <div className="flex w-full flex-1 flex-col justify-end">
                    {value >= 0 && <div className={`mx-auto w-full max-w-[26px] rounded-t-md ${barColor}`} style={{ height: barHeight }} />}
                  </div>
                  {hasNegative && (
                    <div className="flex w-full flex-1 flex-col justify-start">
                      {value < 0 && <div className={`mx-auto w-full max-w-[26px] rounded-b-md ${barColor}`} style={{ height: barHeight }} />}
                    </div>
                  )}
                  <span className="mt-1.5 whitespace-nowrap text-[10px] text-brand-inkMuted">
                    {formatBucketLabel(pt.label, data!.granularity)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
