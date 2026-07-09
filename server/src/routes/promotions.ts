import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const promotionsRouter = Router();
promotionsRouter.use(requireAuth);

promotionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const promotions = await prisma.promotion.findMany({
      where: { storeId: req.auth!.storeId },
      orderBy: { startDate: "desc" },
    });
    res.json(promotions);
  })
);

const promotionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["PERCENTAGE_DISCOUNT", "FIXED_DISCOUNT", "BOGO"]),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().nonnegative().optional(),
  productId: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

promotionsRouter.post(
  "/",
  requirePermission("MANAGE_PROMOTIONS"),
  asyncHandler(async (req, res) => {
    const data = promotionSchema.parse(req.body);
    const promotion = await prisma.promotion.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        storeId: req.auth!.storeId,
      },
    });
    res.status(201).json(promotion);
  })
);

promotionsRouter.put(
  "/:id",
  requirePermission("MANAGE_PROMOTIONS"),
  asyncHandler(async (req, res) => {
    const data = promotionSchema.partial().parse(req.body);
    const existing = await prisma.promotion.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Promotion not found" });
      return;
    }
    const promotion = await prisma.promotion.update({
      where: { id: existing.id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    });
    res.json(promotion);
  })
);

promotionsRouter.delete(
  "/:id",
  requirePermission("MANAGE_PROMOTIONS"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.promotion.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Promotion not found" });
      return;
    }
    await prisma.promotion.update({ where: { id: existing.id }, data: { active: false } });
    res.status(204).end();
  })
);

export const couponsRouter = Router();
couponsRouter.use(requireAuth);

couponsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const coupons = await prisma.coupon.findMany({
      where: { storeId: req.auth!.storeId },
      orderBy: { createdAt: "desc" },
    });
    res.json(coupons);
  })
);

const couponSchema = z.object({
  code: z.string().min(1).toUpperCase(),
  discountType: z.enum(["PERCENTAGE", "FIXED"]),
  discountValue: z.number().positive(),
  expiresAt: z.string().datetime().optional(),
  usageLimit: z.number().int().positive().optional(),
});

couponsRouter.post(
  "/",
  requirePermission("MANAGE_PROMOTIONS"),
  asyncHandler(async (req, res) => {
    const data = couponSchema.parse(req.body);
    const coupon = await prisma.coupon.create({
      data: {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        storeId: req.auth!.storeId,
      },
    });
    res.status(201).json(coupon);
  })
);

couponsRouter.delete(
  "/:id",
  requirePermission("MANAGE_PROMOTIONS"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.coupon.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Coupon not found" });
      return;
    }
    await prisma.coupon.update({ where: { id: existing.id }, data: { active: false } });
    res.status(204).end();
  })
);
