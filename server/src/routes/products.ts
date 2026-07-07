import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, lowStock } = req.query;
    const where: Record<string, unknown> = { storeId: req.auth!.storeId, active: true };

    if (typeof q === "string" && q.trim()) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { name: "asc" },
    });

    const filtered =
      lowStock === "true" ? products.filter((p) => p.stockQty <= p.lowStockThreshold) : products;

    res.json(filtered);
  })
);

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional(),
  categoryId: z.string().optional().nullable(),
  price: z.number().positive(),
  cost: z.number().nonnegative().optional(),
  stockQty: z.number().int().nonnegative().default(0),
  lowStockThreshold: z.number().int().nonnegative().default(5),
  imageUrl: z.string().optional(),
});

productsRouter.post(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({
      data: { ...data, storeId: req.auth!.storeId },
    });
    res.status(201).json(product);
  })
);

productsRouter.put(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = productSchema.partial().parse(req.body);
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const product = await prisma.product.update({ where: { id: existing.id }, data });
    res.json(product);
  })
);

productsRouter.delete(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    await prisma.product.update({ where: { id: existing.id }, data: { active: false } });
    res.status(204).end();
  })
);

const adjustmentSchema = z.object({
  quantityDelta: z.number().int().refine((v) => v !== 0, "quantityDelta cannot be 0"),
  reason: z.enum(["RECEIVED_STOCK", "DAMAGE", "THEFT_LOSS", "RECOUNT", "MANUAL_CORRECTION"]),
  notes: z.string().optional(),
});

productsRouter.post(
  "/:id/adjustments",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = adjustmentSchema.parse(req.body);
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const [adjustment] = await prisma.$transaction([
      prisma.stockAdjustment.create({
        data: {
          storeId: req.auth!.storeId,
          productId: product.id,
          userId: req.auth!.userId,
          reason: data.reason,
          quantityDelta: data.quantityDelta,
          notes: data.notes,
        },
      }),
      prisma.product.update({
        where: { id: product.id },
        data: { stockQty: { increment: data.quantityDelta } },
      }),
    ]);

    res.status(201).json(adjustment);
  })
);

productsRouter.get(
  "/:id/adjustments",
  asyncHandler(async (req, res) => {
    const adjustments = await prisma.stockAdjustment.findMany({
      where: { productId: req.params.id, storeId: req.auth!.storeId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    });
    res.json(adjustments);
  })
);
