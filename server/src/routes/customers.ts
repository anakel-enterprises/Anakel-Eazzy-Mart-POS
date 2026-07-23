import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    const where: Record<string, unknown> = { storeId: req.auth!.storeId, active: true };
    if (typeof q === "string" && q.trim()) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }
    const customers = await prisma.customer.findMany({ where, orderBy: { name: "asc" } });
    res.json(customers);
  })
);

// Customers currently owing money, with their oldest unpaid credit sale's due
// date so the UI can flag overdue accounts.
customersRouter.get(
  "/credit",
  asyncHandler(async (req, res) => {
    const customers = await prisma.customer.findMany({
      where: { storeId: req.auth!.storeId, active: true, creditBalance: { gt: 0 } },
      orderBy: { creditBalance: "desc" },
    });

    const withDueDates = await Promise.all(
      customers.map(async (c) => {
        const oldestCreditSale = await prisma.sale.findFirst({
          where: { customerId: c.id, paymentMethod: "CREDIT", status: "COMPLETED" },
          orderBy: { createdAt: "asc" },
          select: { creditDueDate: true },
        });
        return { ...c, oldestDueDate: oldestCreditSale?.creditDueDate ?? null };
      })
    );

    res.json(withDueDates);
  })
);

const customerSchema = z.object({
  // Lets a customer created offline (see Checkout's inline "add customer"
  // during a credit sale) retry a dropped-response POST without risking a
  // duplicate — same idempotency pattern as Sale/Product/StockAdjustment.
  clientId: z.string().min(1).optional(),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  type: z.enum(["RETAIL", "WHOLESALE", "VIP"]).default("RETAIL"),
  creditLimit: z.number().nonnegative().default(0),
});

customersRouter.post(
  "/",
  requirePermission("MANAGE_CUSTOMERS"),
  asyncHandler(async (req, res) => {
    const data = customerSchema.parse(req.body);

    if (data.clientId) {
      const existing = await prisma.customer.findUnique({ where: { clientId: data.clientId } });
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }

    const customer = await prisma.customer.create({
      data: { ...data, storeId: req.auth!.storeId },
    });
    res.status(201).json(customer);
  })
);

customersRouter.put(
  "/:id",
  requirePermission("MANAGE_CUSTOMERS"),
  asyncHandler(async (req, res) => {
    const data = customerSchema.partial().parse(req.body);
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const customer = await prisma.customer.update({ where: { id: existing.id }, data });
    res.json(customer);
  })
);

customersRouter.delete(
  "/:id",
  requirePermission("MANAGE_CUSTOMERS"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    // Deliberately no balance-must-be-zero guard: this section is where a
    // shop writes off a customer they've given up collecting from, so an
    // outstanding balance is an expected reason to delete, not a blocker.
    // Sale/payment history and the balance figure itself are untouched —
    // deleting just hides them from listings (see Product.active).
    await prisma.customer.update({ where: { id: existing.id }, data: { active: false } });
    res.status(204).end();
  })
);

const creditPaymentSplitSchema = z.object({
  method: z.enum(["CASH", "MPESA_MANUAL"]),
  amount: z.number().positive(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  // The three choices the "Record payment" modal offers — M-Pesa here means
  // the same cashier-asserted "already paid, just recording it" trust level
  // as a manual M-Pesa sale (MPESA_MANUAL), not an STK push.
  method: z.enum(["CASH", "MPESA_MANUAL", "SPLIT"]),
  notes: z.string().optional(),
  splitPayments: z.array(creditPaymentSplitSchema).optional(),
});

const PAYMENT_SPLIT_ROUNDING_TOLERANCE = 0.01;

customersRouter.post(
  "/:id/payments",
  requirePermission("MANAGE_CUSTOMERS"),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);

    if (data.method === "SPLIT") {
      if (!data.splitPayments || data.splitPayments.length < 2) {
        res.status(400).json({ error: "Split payments need at least two payment methods" });
        return;
      }
      const splitSum = data.splitPayments.reduce((sum, p) => sum + p.amount, 0);
      if (Math.abs(splitSum - data.amount) > PAYMENT_SPLIT_ROUNDING_TOLERANCE) {
        res.status(400).json({
          error: `Split amounts (${splitSum.toFixed(2)}) don't match the payment total (${data.amount.toFixed(2)})`,
        });
        return;
      }
    }

    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const [payment] = await prisma.$transaction([
      prisma.creditPayment.create({
        data: {
          storeId: req.auth!.storeId,
          customerId: customer.id,
          amount: data.amount,
          method: data.method,
          notes: data.notes,
          recordedById: req.auth!.userId,
          splits:
            data.method === "SPLIT"
              ? { create: data.splitPayments!.map((p) => ({ method: p.method, amount: p.amount })) }
              : undefined,
        },
        include: { splits: true },
      }),
      prisma.customer.update({
        where: { id: customer.id },
        data: { creditBalance: { decrement: new Prisma.Decimal(data.amount) } },
      }),
    ]);

    res.status(201).json(payment);
  })
);

customersRouter.get(
  "/:id/payments",
  asyncHandler(async (req, res) => {
    const payments = await prisma.creditPayment.findMany({
      where: { customerId: req.params.id, storeId: req.auth!.storeId },
      orderBy: { createdAt: "desc" },
      include: { recordedBy: { select: { name: true } } },
    });
    res.json(payments);
  })
);

// A customer's complete credit-sale history with line items — the
// drill-down behind "click a sale to see what was sold" on the Credit
// Sales page. Deliberately open beyond requireAuth (same as GET
// /:id/payments above), not gated behind VIEW_REPORTS/MANAGE_CUSTOMERS —
// any cashier who can see this customer owes money needs to be able to see
// what was actually sold to them, not just admins/managers.
customersRouter.get(
  "/:id/sales",
  asyncHandler(async (req, res) => {
    const sales = await prisma.sale.findMany({
      where: { storeId: req.auth!.storeId, customerId: req.params.id, paymentMethod: "CREDIT", status: "COMPLETED" },
      include: { items: true, cashier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(sales);
  })
);
