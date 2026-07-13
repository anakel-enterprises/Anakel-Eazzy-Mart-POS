import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: req.auth!.storeId } });
    res.json(store);
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  currency: z.string().optional(),
});

settingsRouter.put(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const store = await prisma.store.update({ where: { id: req.auth!.storeId }, data });
    res.json(store);
  })
);

const resetDataSchema = z.object({ confirm: z.literal("DELETE") });

// Wipes every business record for a fresh start (e.g. clearing out seed/test
// data before going live) while keeping the two things that shouldn't ever
// be part of a "start over" reset: employee accounts and store settings.
// The delete order below exists because of FK RESTRICT constraints — e.g.
// Product can't be removed while a StockAdjustment or SaleItem still
// references it, so those go first. SaleItem/SalePayment aren't listed
// explicitly because they CASCADE off Sale automatically.
settingsRouter.post(
  "/reset-data",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    resetDataSchema.parse(req.body);
    const storeId = req.auth!.storeId;

    const deleted = await prisma.$transaction(
      async (tx) => {
        const mpesaTransactions = await tx.mpesaTransaction.deleteMany({ where: { storeId } });
        const sales = await tx.sale.deleteMany({ where: { storeId } });
        const stockAdjustments = await tx.stockAdjustment.deleteMany({ where: { storeId } });
        const registerSessions = await tx.cashRegisterSession.deleteMany({ where: { storeId } });
        const creditPayments = await tx.creditPayment.deleteMany({ where: { storeId } });
        const customers = await tx.customer.deleteMany({ where: { storeId } });
        const supplierTransactions = await tx.supplierTransaction.deleteMany({ where: { storeId } });
        const suppliers = await tx.supplier.deleteMany({ where: { storeId } });
        const expenses = await tx.expense.deleteMany({ where: { storeId } });
        const expenseCategories = await tx.expenseCategory.deleteMany({ where: { storeId } });
        const incomes = await tx.income.deleteMany({ where: { storeId } });
        const promotions = await tx.promotion.deleteMany({ where: { storeId } });
        const coupons = await tx.coupon.deleteMany({ where: { storeId } });
        const products = await tx.product.deleteMany({ where: { storeId } });
        const categories = await tx.category.deleteMany({ where: { storeId } });

        return {
          mpesaTransactions: mpesaTransactions.count,
          sales: sales.count,
          stockAdjustments: stockAdjustments.count,
          registerSessions: registerSessions.count,
          creditPayments: creditPayments.count,
          customers: customers.count,
          supplierTransactions: supplierTransactions.count,
          suppliers: suppliers.count,
          expenses: expenses.count,
          expenseCategories: expenseCategories.count,
          incomes: incomes.count,
          promotions: promotions.count,
          coupons: coupons.count,
          products: products.count,
          categories: categories.count,
        };
      },
      { timeout: 30_000 }
    );

    res.json({ deleted });
  })
);
