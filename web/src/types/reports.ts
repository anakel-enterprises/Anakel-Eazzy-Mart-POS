// Shapes returned by /api/reports/*. Shared between the pages that fetch
// them (Dashboard, Reports) and lib/offlineStats.ts, which overlays locally
// queued-but-unsynced sales on top of them — keeping one definition here
// means the overlay code can't silently drift out of sync with what the
// pages actually render.

export interface DashboardData {
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

export interface SalesSummary {
  totals: { _sum: { subtotal: number | null; taxTotal: number | null; total: number | null }; _count: number };
  byPaymentMethod: { paymentMethod: string; _sum: { total: number | null }; _count: number }[];
  topProducts: { productId: string; name: string; _sum: { quantity: number | null; lineTotal: number | null } }[];
}

export interface ProfitReport {
  revenue: number;
  cogs: number;
  grossProfit: number;
  byProduct: { productId: string; name: string; revenue: number; cost: number; profit: number }[];
}

export interface InventoryReport {
  productCount: number;
  totalUnits: number;
  retailValue: number;
  costValue: number;
  potentialProfit: number;
  products: { id: string; name: string; sku: string; stockQty: number; price: number; cost: number | null }[];
}

export interface FinanceReport {
  revenue: number;
  expenses: number;
  otherIncome: number;
  netCashFlow: number;
  creditOutstanding: number;
}

export interface CustomersReport {
  totalCustomers: number;
  creditOutstanding: number;
  topCustomers: { customerId: string; name: string; totalSpent: number; orderCount: number }[];
}

export interface SuppliersReport {
  totalOwed: number;
  suppliers: { id: string; name: string; balance: number }[];
}

export interface EmployeeRow {
  cashierId: string;
  name: string;
  totalSales: number;
  transactionCount: number;
}

export interface ProfitLossReport {
  transactionCount: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  otherIncome: number;
  expensesByCategory: { category: string; amount: number }[];
  totalExpenses: number;
  netProfit: number;
}

export interface TimeseriesPoint {
  label: string;
  sales: number;
  expenses: number;
  profit: number;
}

export interface PeriodTotals {
  revenue: number;
  expenses: number;
  cogs: number;
  grossProfit: number;
  otherIncome: number;
  netProfit: number;
  grossMarginPct: number;
  netMarginPct: number;
}

export interface AnalyticsReport {
  current: PeriodTotals;
  previous: PeriodTotals | null;
  granularity: "day" | "month";
  trend: TimeseriesPoint[];
  topProducts: { name: string; revenue: number }[];
  topExpenseCategories: { category: string; amount: number }[];
}
