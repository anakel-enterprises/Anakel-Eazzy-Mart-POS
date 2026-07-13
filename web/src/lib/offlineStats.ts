import type { PendingSale } from "../db/localDb";
import type {
  AnalyticsReport,
  CustomersReport,
  DashboardData,
  EmployeeRow,
  FinanceReport,
  InventoryReport,
  ProfitLossReport,
  ProfitReport,
  SalesSummary,
} from "../types/reports";

// Overlays sales rung up on this device but not yet confirmed synced on top
// of a server-fetched (or cache-fallback) report snapshot, so Dashboard and
// every Reports tab reflect a sale the instant it's completed — offline or
// on — rather than only after the next successful sync. Every function here
// is a pure transform: snapshot + local sales in, adjusted snapshot out.
//
// Important limits, inherent to computing this before the server has
// actually processed the sale (same reason Checkout's own on-screen total is
// labeled "estimated"):
//  - No promotion/coupon discount is known client-side, so a sale's
//    estimated value is simply sum(unitPrice * quantity) — the true total
//    may be lower once the sale syncs and the server applies any active
//    discount.
//  - Line prices are always the retail `unitPrice` cached at checkout time;
//    wholesale/VIP tiered pricing is resolved server-side, so a tiered
//    customer's estimate can run high until sync.
//  - Once a sale's syncStatus flips to "synced", it's the server's problem —
//    these overlays only ever look at "pending"/"error" sales, so a synced
//    sale is never double-counted against the next fresh server fetch.

function estimateSaleTotal(sale: PendingSale): number {
  return sale.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function estimateSaleCogs(sale: PendingSale, productCost: Map<string, number>): number {
  return sale.items.reduce((sum, item) => sum + (productCost.get(item.productId) ?? 0) * item.quantity, 0);
}

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const monthKey = (iso: string) => new Date(iso).toISOString().slice(0, 7);

export function filterSalesByRange(sales: PendingSale[], from?: Date, to?: Date): PendingSale[] {
  if (!from && !to) return sales;
  return sales.filter((s) => {
    const t = new Date(s.createdAt).getTime();
    if (from && t < from.getTime()) return false;
    if (to && t > to.getTime()) return false;
    return true;
  });
}

export function overlayDashboard(
  data: DashboardData,
  unsyncedSales: PendingSale[],
  currentUser: { id: string; name: string }
): DashboardData {
  if (unsyncedSales.length === 0) return data;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let todaysSalesTotal = data.todaysSalesTotal;
  let todaysTransactionCount = data.todaysTransactionCount;
  const weeklyMap = new Map(data.weeklySales.map((d) => [d.date, d.total]));
  const stockDelta = new Map<string, number>();
  const extraRecent: DashboardData["recentSales"] = [];

  for (const sale of unsyncedSales) {
    const total = estimateSaleTotal(sale);
    const createdAt = new Date(sale.createdAt);
    if (createdAt >= today) {
      todaysSalesTotal += total;
      todaysTransactionCount += 1;
    }
    const key = dayKey(sale.createdAt);
    if (weeklyMap.has(key)) weeklyMap.set(key, (weeklyMap.get(key) ?? 0) + total);

    for (const item of sale.items) {
      stockDelta.set(item.productId, (stockDelta.get(item.productId) ?? 0) + item.quantity);
    }

    extraRecent.push({
      id: sale.clientId,
      total,
      paymentMethod: sale.paymentMethod,
      status: "COMPLETED",
      items: sale.items.map((i) => ({ quantity: i.quantity })),
      cashier: { name: currentUser.name || "You" },
      createdAt: sale.createdAt,
    });
  }

  const recentSales = [...extraRecent, ...data.recentSales]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  // Only adjusts stock for products already present in the snapshot — the
  // server only returns the top 10 lowest-stock items, so a product that's
  // dropped below its threshold purely from an offline sale won't appear
  // here until the next successful fetch. Re-sorting after the adjustment at
  // least keeps the already-visible items correctly ordered.
  const lowStock = data.lowStock
    .map((p) => {
      const sold = stockDelta.get(p.id);
      return sold ? { ...p, stockQty: p.stockQty - sold } : p;
    })
    .sort((a, b) => a.stockQty - b.stockQty);

  return {
    todaysSalesTotal,
    todaysTransactionCount,
    weeklySales: data.weeklySales.map((d) => ({ date: d.date, total: weeklyMap.get(d.date) ?? d.total })),
    lowStock,
    recentSales,
  };
}

export function overlaySalesSummary(data: SalesSummary, sales: PendingSale[]): SalesSummary {
  if (sales.length === 0) return data;

  let subtotal = data.totals._sum.subtotal ?? 0;
  let total = data.totals._sum.total ?? 0;
  let count = data.totals._count;

  const byMethod = new Map(data.byPaymentMethod.map((m) => [m.paymentMethod, { total: m._sum.total ?? 0, count: m._count }]));
  const byProduct = new Map(
    data.topProducts.map((p) => [p.productId, { name: p.name, quantity: p._sum.quantity ?? 0, lineTotal: p._sum.lineTotal ?? 0 }])
  );

  for (const sale of sales) {
    const saleTotal = estimateSaleTotal(sale);
    subtotal += saleTotal;
    total += saleTotal;
    count += 1;

    const methodEntry = byMethod.get(sale.paymentMethod) ?? { total: 0, count: 0 };
    methodEntry.total += saleTotal;
    methodEntry.count += 1;
    byMethod.set(sale.paymentMethod, methodEntry);

    for (const item of sale.items) {
      const entry = byProduct.get(item.productId) ?? { name: item.name, quantity: 0, lineTotal: 0 };
      entry.quantity += item.quantity;
      entry.lineTotal += item.unitPrice * item.quantity;
      byProduct.set(item.productId, entry);
    }
  }

  const topProducts = Array.from(byProduct.entries())
    .map(([productId, v]) => ({ productId, name: v.name, _sum: { quantity: v.quantity, lineTotal: v.lineTotal } }))
    .sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0))
    .slice(0, 10);

  return {
    totals: { _sum: { subtotal, taxTotal: data.totals._sum.taxTotal ?? 0, total }, _count: count },
    byPaymentMethod: Array.from(byMethod.entries()).map(([paymentMethod, v]) => ({ paymentMethod, _sum: { total: v.total }, _count: v.count })),
    topProducts,
  };
}

export function overlayProfit(data: ProfitReport, sales: PendingSale[], productCost: Map<string, number>): ProfitReport {
  if (sales.length === 0) return data;

  let revenue = data.revenue;
  let cogs = data.cogs;
  const byProduct = new Map(data.byProduct.map((p) => [p.productId, { name: p.name, revenue: p.revenue, cost: p.cost }]));

  for (const sale of sales) {
    for (const item of sale.items) {
      const lineRevenue = item.unitPrice * item.quantity;
      const lineCost = (productCost.get(item.productId) ?? 0) * item.quantity;
      revenue += lineRevenue;
      cogs += lineCost;

      const entry = byProduct.get(item.productId) ?? { name: item.name, revenue: 0, cost: 0 };
      entry.revenue += lineRevenue;
      entry.cost += lineCost;
      byProduct.set(item.productId, entry);
    }
  }

  return {
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    byProduct: Array.from(byProduct.entries()).map(([productId, v]) => ({
      productId,
      name: v.name,
      revenue: v.revenue,
      cost: v.cost,
      profit: v.revenue - v.cost,
    })),
  };
}

export function overlayProfitLoss(data: ProfitLossReport, sales: PendingSale[], productCost: Map<string, number>): ProfitLossReport {
  if (sales.length === 0) return data;

  let netSalesDelta = 0;
  let cogsDelta = 0;
  for (const sale of sales) {
    netSalesDelta += estimateSaleTotal(sale);
    cogsDelta += estimateSaleCogs(sale, productCost);
  }

  const netSales = data.netSales + netSalesDelta;
  const cogs = data.cogs + cogsDelta;
  const grossProfit = netSales - cogs;
  const netProfit = grossProfit + data.otherIncome - data.totalExpenses;

  return {
    ...data,
    transactionCount: data.transactionCount + sales.length,
    netSales,
    cogs,
    grossProfit,
    netProfit,
  };
}

export function overlayAnalytics(data: AnalyticsReport, sales: PendingSale[], productCost: Map<string, number>): AnalyticsReport {
  if (sales.length === 0) return data;

  let revenueDelta = 0;
  let cogsDelta = 0;
  const trendDelta = new Map<string, { sales: number; cogs: number }>();
  const productRevenueDelta = new Map<string, number>();

  for (const sale of sales) {
    const saleRevenue = estimateSaleTotal(sale);
    const saleCogs = estimateSaleCogs(sale, productCost);
    revenueDelta += saleRevenue;
    cogsDelta += saleCogs;

    const label = data.granularity === "month" ? monthKey(sale.createdAt) : dayKey(sale.createdAt);
    const bucket = trendDelta.get(label) ?? { sales: 0, cogs: 0 };
    bucket.sales += saleRevenue;
    bucket.cogs += saleCogs;
    trendDelta.set(label, bucket);

    for (const item of sale.items) {
      const lineRevenue = item.unitPrice * item.quantity;
      productRevenueDelta.set(item.name, (productRevenueDelta.get(item.name) ?? 0) + lineRevenue);
    }
  }

  const revenue = data.current.revenue + revenueDelta;
  const cogs = data.current.cogs + cogsDelta;
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit + data.current.otherIncome - data.current.expenses;
  const current = {
    ...data.current,
    revenue,
    cogs,
    grossProfit,
    netProfit,
    grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    netMarginPct: revenue > 0 ? (netProfit / revenue) * 100 : 0,
  };

  // Callers are expected to have already filtered `sales` to the selected
  // period (see Reports.tsx's periodSales), so every bucket computed above
  // legitimately belongs in this trend — including one the server's response
  // never created in the first place because there was no data for it yet
  // (e.g. the very first sale of the day has no "today" bucket to adjust,
  // only one to add).
  const trendMap = new Map(data.trend.map((p) => [p.label, { ...p }]));
  for (const [label, delta] of trendDelta) {
    const point = trendMap.get(label) ?? { label, sales: 0, expenses: 0, profit: 0 };
    point.sales += delta.sales;
    point.profit += delta.sales - delta.cogs;
    trendMap.set(label, point);
  }
  const trend = Array.from(trendMap.values()).sort((a, b) => (a.label < b.label ? -1 : 1));

  const topProductsMap = new Map(data.topProducts.map((p) => [p.name, p.revenue]));
  for (const [name, delta] of productRevenueDelta) {
    topProductsMap.set(name, (topProductsMap.get(name) ?? 0) + delta);
  }
  const topProducts = Array.from(topProductsMap.entries())
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return { ...data, current, trend, topProducts };
}

export function overlayInventory(data: InventoryReport, sales: PendingSale[]): InventoryReport {
  if (sales.length === 0) return data;

  const soldByProduct = new Map<string, number>();
  for (const sale of sales) {
    for (const item of sale.items) {
      soldByProduct.set(item.productId, (soldByProduct.get(item.productId) ?? 0) + item.quantity);
    }
  }
  if (soldByProduct.size === 0) return data;

  let retailValue = data.retailValue;
  let costValue = data.costValue;
  let totalUnits = data.totalUnits;

  const products = data.products.map((p) => {
    const sold = soldByProduct.get(p.id);
    if (!sold) return p;
    retailValue -= p.price * sold;
    costValue -= (p.cost ?? 0) * sold;
    totalUnits -= sold;
    return { ...p, stockQty: p.stockQty - sold };
  });

  return { ...data, totalUnits, retailValue, costValue, potentialProfit: retailValue - costValue, products };
}

export function overlayFinance(data: FinanceReport, sales: PendingSale[]): FinanceReport {
  if (sales.length === 0) return data;

  let revenueDelta = 0;
  let creditDelta = 0;
  for (const sale of sales) {
    const total = estimateSaleTotal(sale);
    revenueDelta += total;
    if (sale.paymentMethod === "CREDIT") creditDelta += total;
  }

  const revenue = data.revenue + revenueDelta;
  return {
    ...data,
    revenue,
    netCashFlow: revenue + data.otherIncome - data.expenses,
    creditOutstanding: data.creditOutstanding + creditDelta,
  };
}

export function overlayCustomers(data: CustomersReport, sales: PendingSale[]): CustomersReport {
  if (sales.length === 0) return data;

  let creditDelta = 0;
  const topMap = new Map(data.topCustomers.map((c) => [c.customerId, { name: c.name, totalSpent: c.totalSpent, orderCount: c.orderCount }]));

  for (const sale of sales) {
    const total = estimateSaleTotal(sale);
    if (sale.paymentMethod === "CREDIT") creditDelta += total;
    if (!sale.customerId) continue;
    const entry = topMap.get(sale.customerId) ?? { name: sale.customerName ?? "Unknown", totalSpent: 0, orderCount: 0 };
    entry.totalSpent += total;
    entry.orderCount += 1;
    topMap.set(sale.customerId, entry);
  }

  const topCustomers = Array.from(topMap.entries())
    .map(([customerId, v]) => ({ customerId, name: v.name, totalSpent: v.totalSpent, orderCount: v.orderCount }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  return { ...data, creditOutstanding: data.creditOutstanding + creditDelta, topCustomers };
}

export function overlayEmployeePerformance(
  data: EmployeeRow[],
  sales: PendingSale[],
  currentUser: { id: string; name: string }
): EmployeeRow[] {
  if (sales.length === 0 || !currentUser.id) return data;

  const totalDelta = sales.reduce((sum, s) => sum + estimateSaleTotal(s), 0);
  const existing = data.some((r) => r.cashierId === currentUser.id);
  const rows = data.map((r) =>
    r.cashierId === currentUser.id ? { ...r, totalSales: r.totalSales + totalDelta, transactionCount: r.transactionCount + sales.length } : r
  );
  if (!existing) {
    rows.push({ cashierId: currentUser.id, name: currentUser.name, totalSales: totalDelta, transactionCount: sales.length });
  }
  return rows.sort((a, b) => b.totalSales - a.totalSales);
}
