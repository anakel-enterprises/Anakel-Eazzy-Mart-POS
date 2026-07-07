import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    const where: Record<string, unknown> = { storeId: req.auth!.storeId };
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
      where: { storeId: req.auth!.storeId, creditBalance: { gt: 0 } },
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
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  type: z.enum(["RETAIL", "WHOLESALE", "VIP"]).default("RETAIL"),
  creditLimit: z.number().nonnegative().default(0),
});

customersRouter.post(
  "/",
  requireRole("ADMIN", "MANAGER", "CASHIER"),
  asyncHandler(async (req, res) => {
    const data = customerSchema.parse(req.body);
    const customer = await prisma.customer.create({
      data: { ...data, storeId: req.auth!.storeId },
    });
    res.status(201).json(customer);
  })
);

customersRouter.put(
  "/:id",
  requireRole("ADMIN", "MANAGER", "CASHIER"),
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

const paymentSchema = z.object({
  amount: z.number().positive(),
  notes: z.string().optional(),
});

customersRouter.post(
  "/:id/payments",
  requireRole("ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER"),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);
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
          notes: data.notes,
          recordedById: req.auth!.userId,
        },
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
