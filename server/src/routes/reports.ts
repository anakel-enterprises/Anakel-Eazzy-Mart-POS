import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission("VIEW_REPORTS"));

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

reportsRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const today = startOfDay(new Date());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);

    const [todaySales, weekSales, lowStock, recentSales] = await Promise.all([
      prisma.sale.aggregate({
        where: { storeId, status: "COMPLETED", createdAt: { gte: today } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.sale.findMany({
        where: { storeId, status: "COMPLETED", createdAt: { gte: weekAgo } },
        select: { total: true, createdAt: true },
      }),
      prisma.$queryRaw<
        { id: string; name: string; sku: string; stockQty: number; lowStockThreshold: number }[]
      >(Prisma.sql`
        SELECT id, name, sku, "stockQty", "lowStockThreshold"
        FROM "Product"
        WHERE "storeId" = ${storeId} AND active = true AND "stockQty" <= "lowStockThreshold"
        ORDER BY "stockQty" ASC
        LIMIT 10
      `),
      prisma.sale.findMany({
        where: { storeId, status: "COMPLETED" },
        include: { items: true, cashier: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

    const dayBuckets: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekAgo);
      d.setDate(d.getDate() + i);
      dayBuckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const sale of weekSales) {
      const key = sale.createdAt.toISOString().slice(0, 10);
      if (key in dayBuckets) dayBuckets[key] += Number(sale.total);
    }

    res.json({
      todaysSalesTotal: todaySales._sum.total ?? 0,
      todaysTransactionCount: todaySales._count,
      weeklySales: Object.entries(dayBuckets).map(([date, total]) => ({ date, total })),
      lowStock,
      recentSales,
    });
  })
);

reportsRouter.get(
  "/sales-summary",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const storeId = req.auth!.storeId;

    const where = {
      storeId,
      status: "COMPLETED" as const,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(String(from)) } : {}),
              ...(to ? { lte: new Date(String(to)) } : {}),
            },
          }
        : {}),
    };

    const [totals, byPaymentMethod, topProducts] = await Promise.all([
      prisma.sale.aggregate({ where, _sum: { subtotal: true, taxTotal: true, total: true }, _count: true }),
      prisma.sale.groupBy({ by: ["paymentMethod"], where, _sum: { total: true }, _count: true }),
      prisma.saleItem.groupBy({
        by: ["productId", "name"],
        where: { sale: where },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10,
      }),
    ]);

    res.json({ totals, byPaymentMethod, topProducts });
  })
);

function dateRangeWhere(from: unknown, to: unknown) {
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { gte: new Date(String(from)) } : {}),
      ...(to ? { lte: new Date(String(to)) } : {}),
    },
  };
}

reportsRouter.get(
  "/profit",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const { from, to } = req.query;

    const items = await prisma.saleItem.findMany({
      where: { sale: { storeId, status: "COMPLETED", ...dateRangeWhere(from, to) } },
      include: { product: { select: { cost: true, name: true } } },
    });

    let revenue = new Prisma.Decimal(0);
    let cogs = new Prisma.Decimal(0);
    const byProduct = new Map<string, { name: string; revenue: Prisma.Decimal; cost: Prisma.Decimal }>();

    for (const item of items) {
      revenue = revenue.add(item.lineTotal);
      const unitCost = item.product.cost ?? new Prisma.Decimal(0);
      const itemCost = unitCost.mul(item.quantity);
      cogs = cogs.add(itemCost);

      const entry = byProduct.get(item.productId) ?? {
        name: item.product.name,
        revenue: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
      };
      entry.revenue = entry.revenue.add(item.lineTotal);
      entry.cost = entry.cost.add(itemCost);
      byProduct.set(item.productId, entry);
    }

    res.json({
      revenue,
      cogs,
      grossProfit: revenue.sub(cogs),
      byProduct: Array.from(byProduct.entries()).map(([productId, v]) => ({
        productId,
        name: v.name,
        revenue: v.revenue,
        cost: v.cost,
        profit: v.revenue.sub(v.cost),
      })),
    });
  })
);

// A proper Profit & Loss statement for an arbitrary period (day/week/month,
// or any custom from/to). Unlike /profit, revenue here is net of discounts
// (subtotal - discountTotal) since that's what actually counts as sales
// revenue on a P&L — tax collected on behalf of the government isn't revenue
// either, so it's excluded too.
reportsRouter.get(
  "/profit-loss",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const { from, to } = req.query;
    const range = dateRangeWhere(from, to);

    const [salesAgg, saleItems, incomeAgg, expenses] = await Promise.all([
      prisma.sale.aggregate({
        where: { storeId, status: "COMPLETED", ...range },
        _sum: { subtotal: true, discountTotal: true },
        _count: true,
      }),
      prisma.saleItem.findMany({
        where: { sale: { storeId, status: "COMPLETED", ...range } },
        select: { quantity: true, product: { select: { cost: true } } },
      }),
      prisma.income.aggregate({
        where: { storeId, ...(from || to ? { date: range.createdAt } : {}) },
        _sum: { amount: true },
      }),
      prisma.expense.findMany({
        where: { storeId, status: "APPROVED", ...(from || to ? { date: range.createdAt } : {}) },
        include: { category: true },
      }),
    ]);

    const netSales = (salesAgg._sum.subtotal ?? new Prisma.Decimal(0)).sub(
      salesAgg._sum.discountTotal ?? new Prisma.Decimal(0)
    );
    const cogs = saleItems.reduce(
      (sum, item) => sum.add((item.product.cost ?? new Prisma.Decimal(0)).mul(item.quantity)),
      new Prisma.Decimal(0)
    );
    const grossProfit = netSales.sub(cogs);
    const otherIncome = incomeAgg._sum.amount ?? new Prisma.Decimal(0);

    const expensesByCategory = new Map<string, Prisma.Decimal>();
    let totalExpenses = new Prisma.Decimal(0);
    for (const e of expenses) {
      totalExpenses = totalExpenses.add(e.amount);
      const key = e.category.name;
      expensesByCategory.set(key, (expensesByCategory.get(key) ?? new Prisma.Decimal(0)).add(e.amount));
    }

    const netProfit = grossProfit.add(otherIncome).sub(totalExpenses);

    res.json({
      transactionCount: salesAgg._count,
      netSales,
      cogs,
      grossProfit,
      otherIncome,
      expensesByCategory: Array.from(expensesByCategory.entries()).map(([category, amount]) => ({ category, amount })),
      totalExpenses,
      netProfit,
    });
  })
);

// Everything the P&L dashboard's charts need for one date range, in a
// single call: a day/month-bucketed trend series, top 5 products and
// expense categories, and (when both from/to are given) the immediately
// preceding period of equal length for the "vs last period" stat deltas.
reportsRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const { from, to } = req.query;
    const range = dateRangeWhere(from, to);

    const rangeTo = to ? new Date(String(to)) : new Date();
    const rangeFrom = from ? new Date(String(from)) : new Date(0);
    const spanMs = rangeTo.getTime() - rangeFrom.getTime();
    const spanDays = Math.max(1, Math.ceil(spanMs / (24 * 60 * 60 * 1000)));
    const granularity: "day" | "month" = spanDays <= 62 ? "day" : "month";
    const bucketKey = (d: Date) => (granularity === "day" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7));

    async function periodTotals(periodRange: ReturnType<typeof dateRangeWhere>, dateFilterActive: boolean) {
      const [salesAgg, saleItems, expensesAgg, incomeAgg] = await Promise.all([
        prisma.sale.aggregate({
          where: { storeId, status: "COMPLETED", ...periodRange },
          _sum: { subtotal: true, discountTotal: true },
        }),
        prisma.saleItem.findMany({
          where: { sale: { storeId, status: "COMPLETED", ...periodRange } },
          select: { quantity: true, product: { select: { cost: true } } },
        }),
        prisma.expense.aggregate({
          where: { storeId, status: "APPROVED", ...(dateFilterActive ? { date: periodRange.createdAt } : {}) },
          _sum: { amount: true },
        }),
        prisma.income.aggregate({
          where: { storeId, ...(dateFilterActive ? { date: periodRange.createdAt } : {}) },
          _sum: { amount: true },
        }),
      ]);
      const revenue = Number(salesAgg._sum.subtotal ?? 0) - Number(salesAgg._sum.discountTotal ?? 0);
      const cogs = saleItems.reduce((sum, i) => sum + Number(i.product.cost ?? 0) * i.quantity, 0);
      const expenses = Number(expensesAgg._sum.amount ?? 0);
      const otherIncome = Number(incomeAgg._sum.amount ?? 0);
      const grossProfit = revenue - cogs;
      const netProfit = grossProfit + otherIncome - expenses;
      return { revenue, expenses, cogs, grossProfit, otherIncome, netProfit };
    }

    const [current, previous, sales, saleItems, expenseRows, incomeRows] = await Promise.all([
      periodTotals(range, !!(from || to)),
      from && to
        ? periodTotals(
            dateRangeWhere(new Date(rangeFrom.getTime() - spanMs).toISOString(), new Date(rangeFrom.getTime() - 1).toISOString()),
            true
          )
        : Promise.resolve(null),
      prisma.sale.findMany({
        where: { storeId, status: "COMPLETED", ...range },
        select: { createdAt: true, subtotal: true, discountTotal: true },
      }),
      prisma.saleItem.findMany({
        where: { sale: { storeId, status: "COMPLETED", ...range } },
        select: { name: true, quantity: true, lineTotal: true, product: { select: { cost: true } }, sale: { select: { createdAt: true } } },
      }),
      prisma.expense.findMany({
        where: { storeId, status: "APPROVED", ...(from || to ? { date: range.createdAt } : {}) },
        include: { category: true },
      }),
      prisma.income.findMany({
        where: { storeId, ...(from || to ? { date: range.createdAt } : {}) },
        select: { date: true, amount: true },
      }),
    ]);

    // Trend series
    const buckets = new Map<string, { sales: number; cogs: number; expenses: number; income: number }>();
    function bucket(key: string) {
      let b = buckets.get(key);
      if (!b) {
        b = { sales: 0, cogs: 0, expenses: 0, income: 0 };
        buckets.set(key, b);
      }
      return b;
    }
    for (const s of sales) bucket(bucketKey(s.createdAt)).sales += Number(s.subtotal) - Number(s.discountTotal);
    for (const item of saleItems) bucket(bucketKey(item.sale.createdAt)).cogs += Number(item.product.cost ?? 0) * item.quantity;
    for (const e of expenseRows) bucket(bucketKey(e.date)).expenses += Number(e.amount);
    for (const i of incomeRows) bucket(bucketKey(i.date)).income += Number(i.amount);
    const trend = Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, b]) => ({ label, sales: b.sales, expenses: b.expenses, profit: b.sales - b.cogs + b.income - b.expenses }));

    // Top 5 products by revenue
    const byProduct = new Map<string, number>();
    for (const item of saleItems) byProduct.set(item.name, (byProduct.get(item.name) ?? 0) + Number(item.lineTotal));
    const topProducts = Array.from(byProduct.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, revenue]) => ({ name, revenue }));

    // Top 5 expense categories
    const byCategory = new Map<string, number>();
    for (const e of expenseRows) byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0) + Number(e.amount));
    const topExpenseCategories = Array.from(byCategory.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, amount]) => ({ category, amount }));

    function withMargins(t: { revenue: number; expenses: number; cogs: number; grossProfit: number; otherIncome: number; netProfit: number }) {
      return {
        ...t,
        grossMarginPct: t.revenue > 0 ? (t.grossProfit / t.revenue) * 100 : 0,
        netMarginPct: t.revenue > 0 ? (t.netProfit / t.revenue) * 100 : 0,
      };
    }

    res.json({
      current: withMargins(current),
      previous: previous ? withMargins(previous) : null,
      granularity,
      trend,
      topProducts,
      topExpenseCategories,
    });
  })
);

reportsRouter.get(
  "/inventory",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const products = await prisma.product.findMany({
      where: { storeId, active: true },
      select: { id: true, name: true, sku: true, stockQty: true, price: true, cost: true },
    });

    let retailValue = new Prisma.Decimal(0);
    let costValue = new Prisma.Decimal(0);
    for (const p of products) {
      retailValue = retailValue.add(p.price.mul(p.stockQty));
      costValue = costValue.add((p.cost ?? new Prisma.Decimal(0)).mul(p.stockQty));
    }

    res.json({
      productCount: products.length,
      totalUnits: products.reduce((sum, p) => sum + p.stockQty, 0),
      retailValue,
      costValue,
      potentialProfit: retailValue.sub(costValue),
      products,
    });
  })
);

reportsRouter.get(
  "/finance",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const { from, to } = req.query;
    const range = dateRangeWhere(from, to);

    const [salesTotal, expensesTotal, incomeTotal, creditOutstanding] = await Promise.all([
      prisma.sale.aggregate({ where: { storeId, status: "COMPLETED", ...range }, _sum: { total: true } }),
      prisma.expense.aggregate({
        where: { storeId, status: "APPROVED", ...(from || to ? { date: range.createdAt } : {}) },
        _sum: { amount: true },
      }),
      prisma.income.aggregate({
        where: { storeId, ...(from || to ? { date: range.createdAt } : {}) },
        _sum: { amount: true },
      }),
      prisma.customer.aggregate({ where: { storeId }, _sum: { creditBalance: true } }),
    ]);

    const revenue = salesTotal._sum.total ?? new Prisma.Decimal(0);
    const expenses = expensesTotal._sum.amount ?? new Prisma.Decimal(0);
    const otherIncome = incomeTotal._sum.amount ?? new Prisma.Decimal(0);

    res.json({
      revenue,
      expenses,
      otherIncome,
      netCashFlow: new Prisma.Decimal(revenue).add(otherIncome).sub(expenses),
      creditOutstanding: creditOutstanding._sum.creditBalance ?? 0,
    });
  })
);

reportsRouter.get(
  "/customers",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const { from, to } = req.query;
    const range = dateRangeWhere(from, to);
    const [totalCustomers, creditOutstanding, topCustomers] = await Promise.all([
      prisma.customer.count({ where: { storeId } }),
      prisma.customer.aggregate({ where: { storeId }, _sum: { creditBalance: true } }),
      prisma.sale.groupBy({
        by: ["customerId"],
        where: { storeId, status: "COMPLETED", customerId: { not: null }, ...range },
        _sum: { total: true },
        _count: true,
        orderBy: { _sum: { total: "desc" } },
        take: 10,
      }),
    ]);

    const customerIds = topCustomers.map((c) => c.customerId).filter((id): id is string => !!id);
    const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } } });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    res.json({
      totalCustomers,
      creditOutstanding: creditOutstanding._sum.creditBalance ?? 0,
      topCustomers: topCustomers.map((c) => ({
        customerId: c.customerId,
        name: c.customerId ? customerMap.get(c.customerId)?.name : "Unknown",
        totalSpent: c._sum.total,
        orderCount: c._count,
      })),
    });
  })
);

reportsRouter.get(
  "/suppliers",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const [totalOwed, suppliers] = await Promise.all([
      prisma.supplier.aggregate({ where: { storeId }, _sum: { balance: true } }),
      prisma.supplier.findMany({ where: { storeId }, orderBy: { balance: "desc" } }),
    ]);
    res.json({ totalOwed: totalOwed._sum.balance ?? 0, suppliers });
  })
);

reportsRouter.get(
  "/employee-performance",
  asyncHandler(async (req, res) => {
    const storeId = req.auth!.storeId;
    const { from, to } = req.query;
    const range = dateRangeWhere(from, to);

    const grouped = await prisma.sale.groupBy({
      by: ["cashierId"],
      where: { storeId, status: "COMPLETED", ...range },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: "desc" } },
    });

    const userIds = grouped.map((g) => g.cashierId);
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    res.json(
      grouped.map((g) => ({
        cashierId: g.cashierId,
        name: userMap.get(g.cashierId) ?? "Unknown",
        totalSales: g._sum.total,
        transactionCount: g._count,
      }))
    );
  })
);
