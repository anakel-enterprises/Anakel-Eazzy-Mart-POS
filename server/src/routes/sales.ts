import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const salesRouter = Router();
salesRouter.use(requireAuth);

const saleItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
});

const createSaleSchema = z.object({
  clientId: z.string().min(1),
  items: z.array(saleItemSchema).min(1),
  paymentMethod: z.enum(["CASH", "MPESA", "CARD", "BANK", "SPLIT", "CREDIT"]),
  amountTendered: z.number().nonnegative().optional(),
  status: z.enum(["HELD", "COMPLETED"]).default("COMPLETED"),
  createdAt: z.string().datetime().optional(),
});

// Idempotent on clientId so a sale queued offline and retried on sync never
// gets double-counted or double-decrements stock.
salesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSaleSchema.parse(req.body);

    const existing = await prisma.sale.findUnique({
      where: { clientId: data.clientId },
      include: { items: true },
    });
    if (existing) {
      res.status(200).json(existing);
      return;
    }

    const store = await prisma.store.findUniqueOrThrow({ where: { id: req.auth!.storeId } });
    const openSession = await prisma.cashRegisterSession.findFirst({
      where: { storeId: req.auth!.storeId, cashierId: req.auth!.userId, status: "OPEN" },
    });

    const productIds = data.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, storeId: req.auth!.storeId },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of data.items) {
      if (!productMap.has(item.productId)) {
        res.status(400).json({ error: `Unknown product ${item.productId}` });
        return;
      }
    }

    const lineItems = data.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const lineTotal = product.price.mul(item.quantity);
      return {
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal,
      };
    });

    const subtotal = lineItems.reduce((sum, li) => sum.add(li.lineTotal), new Prisma.Decimal(0));
    const taxTotal = data.status === "COMPLETED" ? subtotal.mul(store.taxRate).div(100) : new Prisma.Decimal(0);
    const total = subtotal.add(taxTotal);
    const amountTendered = data.amountTendered != null ? new Prisma.Decimal(data.amountTendered) : null;
    const changeDue = amountTendered ? amountTendered.sub(total) : null;

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          storeId: req.auth!.storeId,
          cashierId: req.auth!.userId,
          registerSessionId: openSession?.id,
          clientId: data.clientId,
          status: data.status,
          subtotal,
          taxTotal,
          total,
          amountTendered: amountTendered ?? undefined,
          changeDue: changeDue ?? undefined,
          paymentMethod: data.paymentMethod,
          createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
          items: { create: lineItems },
        },
        include: { items: true },
      });

      if (data.status === "COMPLETED") {
        for (const item of data.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: { decrement: item.quantity } },
          });
        }
      }

      return created;
    });

    res.status(201).json(sale);
  })
);

salesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, limit } = req.query;
    const sales = await prisma.sale.findMany({
      where: {
        storeId: req.auth!.storeId,
        ...(typeof status === "string" ? { status: status as never } : {}),
      },
      include: { items: true, cashier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: typeof limit === "string" ? Number(limit) : 50,
    });
    res.json(sales);
  })
);

salesRouter.get(
  "/held",
  asyncHandler(async (req, res) => {
    const sales = await prisma.sale.findMany({
      where: { storeId: req.auth!.storeId, status: "HELD" },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(sales);
  })
);
