import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

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
