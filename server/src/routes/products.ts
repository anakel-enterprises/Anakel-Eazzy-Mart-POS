import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

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
  wholesalePrice: z.number().positive().optional(),
  vipPrice: z.number().positive().optional(),
  cost: z.number().nonnegative().optional(),
  stockQty: z.number().int().nonnegative().default(0),
  lowStockThreshold: z.number().int().nonnegative().default(5),
  imageUrl: z.string().optional(),
  // Set when a product is created offline — lets a retried sync (e.g. after
  // a dropped response to a create that actually succeeded) return the
  // already-created product instead of failing on the unique SKU/clientId
  // constraint or creating a duplicate. See clientId on Sale for the same
  // pattern.
  clientId: z.string().optional(),
});

productsRouter.post(
  "/",
  requirePermission("MANAGE_PRODUCTS"),
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);

    if (data.clientId) {
      const existing = await prisma.product.findUnique({ where: { clientId: data.clientId } });
      if (existing && existing.storeId === req.auth!.storeId) {
        res.status(200).json(existing);
        return;
      }
    }

    const product = await prisma.product.create({
      data: { ...data, storeId: req.auth!.storeId },
    });
    res.status(201).json(product);
  })
);

productsRouter.put(
  "/:id",
  requirePermission("MANAGE_PRODUCTS"),
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
  requirePermission("MANAGE_PRODUCTS"),
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

function slugifySku(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "ITEM";
}

function generateUniqueSku(name: string, taken: Set<string>): string {
  const base = slugifySku(name);
  let sku = base;
  let n = 2;
  while (taken.has(sku.toLowerCase())) {
    sku = `${base}-${n}`;
    n++;
  }
  return sku;
}

const importRowSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  price: z.number().positive(),
  cost: z.number().nonnegative().optional(),
  stockQty: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
});

const importSchema = z.object({ rows: z.array(importRowSchema).min(1).max(2000) });

// Bulk import from a spreadsheet (parsed client-side, sent as structured
// rows). Upserts by SKU: a row whose SKU already exists updates that
// product's name/price/cost/category; a new SKU (or a missing one, which
// gets auto-generated the same way the Add Product form does) creates a
// fresh product. Stock quantity is only set on create, never on update —
// re-importing a price list shouldn't silently overwrite stock counts that
// have since moved via sales or adjustments in this app.
productsRouter.post(
  "/import",
  requirePermission("MANAGE_PRODUCTS"),
  asyncHandler(async (req, res) => {
    const { rows } = importSchema.parse(req.body);
    const storeId = req.auth!.storeId;

    const [existingCategories, existingProducts] = await Promise.all([
      prisma.category.findMany({ where: { storeId } }),
      prisma.product.findMany({ where: { storeId }, select: { id: true, sku: true } }),
    ]);
    const categoryIdByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]));
    const productIdBySku = new Map(existingProducts.map((p) => [p.sku.toLowerCase(), p.id]));
    const takenSkus = new Set(existingProducts.map((p) => p.sku.toLowerCase()));

    let created = 0;
    let updated = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        let categoryId: string | undefined;
        if (row.category?.trim()) {
          const key = row.category.trim().toLowerCase();
          categoryId = categoryIdByName.get(key);
          if (!categoryId) {
            const category = await prisma.category.create({ data: { name: row.category.trim(), storeId } });
            categoryIdByName.set(key, category.id);
            categoryId = category.id;
          }
        }

        const sku = row.sku?.trim() || generateUniqueSku(row.name, takenSkus);
        const skuKey = sku.toLowerCase();
        const existingId = productIdBySku.get(skuKey);

        if (existingId) {
          await prisma.product.update({
            where: { id: existingId },
            data: {
              name: row.name,
              barcode: row.barcode || undefined,
              categoryId,
              price: row.price,
              cost: row.cost,
              lowStockThreshold: row.lowStockThreshold,
            },
          });
          updated++;
        } else {
          const product = await prisma.product.create({
            data: {
              storeId,
              name: row.name,
              sku,
              barcode: row.barcode || undefined,
              categoryId,
              price: row.price,
              cost: row.cost,
              stockQty: row.stockQty ?? 0,
              lowStockThreshold: row.lowStockThreshold ?? 5,
            },
          });
          productIdBySku.set(skuKey, product.id);
          takenSkus.add(skuKey);
          created++;
        }
      } catch (err) {
        errors.push({ row: i + 1, reason: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    res.json({ created, updated, errors });
  })
);

const adjustmentSchema = z.object({
  quantityDelta: z.number().int().refine((v) => v !== 0, "quantityDelta cannot be 0"),
  reason: z.enum(["RECEIVED_STOCK", "DAMAGE", "THEFT_LOSS", "RECOUNT", "MANUAL_CORRECTION"]),
  notes: z.string().optional(),
  // Set when an adjustment is queued offline — unlike the product PUT above,
  // this increments stockQty rather than overwriting it, so a retried sync
  // (after a dropped response to a POST that actually succeeded) would
  // otherwise double-apply the delta. See clientId on Sale for the pattern.
  clientId: z.string().optional(),
});

productsRouter.post(
  "/:id/adjustments",
  requirePermission("MANAGE_PRODUCTS"),
  asyncHandler(async (req, res) => {
    const data = adjustmentSchema.parse(req.body);

    if (data.clientId) {
      const existing = await prisma.stockAdjustment.findUnique({ where: { clientId: data.clientId } });
      if (existing && existing.storeId === req.auth!.storeId) {
        res.status(200).json(existing);
        return;
      }
    }

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
          clientId: data.clientId,
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
