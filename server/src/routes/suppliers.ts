import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

suppliersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const suppliers = await prisma.supplier.findMany({
      where: { storeId: req.auth!.storeId },
      orderBy: { name: "asc" },
    });
    res.json(suppliers);
  })
);

const supplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
});

suppliersRouter.post(
  "/",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const data = supplierSchema.parse(req.body);
    const supplier = await prisma.supplier.create({
      data: { ...data, storeId: req.auth!.storeId },
    });
    res.status(201).json(supplier);
  })
);

suppliersRouter.put(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const data = supplierSchema.partial().parse(req.body);
    const existing = await prisma.supplier.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data });
    res.json(supplier);
  })
);

const transactionSchema = z.object({
  type: z.enum(["PURCHASE", "PAYMENT"]),
  amount: z.number().positive(),
  description: z.string().optional(),
});

// A PURCHASE increases what the store owes the supplier; a PAYMENT reduces it.
suppliersRouter.post(
  "/:id/transactions",
  requireRole("ADMIN", "MANAGER", "STOREKEEPER", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    const data = transactionSchema.parse(req.body);
    const supplier = await prisma.supplier.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    const balanceDelta = data.type === "PURCHASE" ? data.amount : -data.amount;

    const [transaction] = await prisma.$transaction([
      prisma.supplierTransaction.create({
        data: {
          storeId: req.auth!.storeId,
          supplierId: supplier.id,
          type: data.type,
          amount: data.amount,
          description: data.description,
          recordedById: req.auth!.userId,
        },
      }),
      prisma.supplier.update({
        where: { id: supplier.id },
        data: { balance: { increment: new Prisma.Decimal(balanceDelta) } },
      }),
    ]);

    res.status(201).json(transaction);
  })
);

suppliersRouter.get(
  "/:id/transactions",
  asyncHandler(async (req, res) => {
    const transactions = await prisma.supplierTransaction.findMany({
      where: { supplierId: req.params.id, storeId: req.auth!.storeId },
      orderBy: { createdAt: "desc" },
      include: { recordedBy: { select: { name: true } } },
    });
    res.json(transactions);
  })
);
