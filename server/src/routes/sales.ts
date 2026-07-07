import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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
  customerId: z.string().optional(),
  couponCode: z.string().optional(),
  creditDueDate: z.string().datetime().optional(),
});

const DEFAULT_CREDIT_DAYS = 30;

// Idempotent on clientId so a sale queued offline and retried on sync never
// gets double-counted or double-decrements stock.
salesRouter.post(
  "/",
  requireRole("ADMIN", "MANAGER", "CASHIER"),
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

    if (data.paymentMethod === "CREDIT" && !data.customerId) {
      res.status(400).json({ error: "A customer is required for credit sales" });
      return;
    }

    const store = await prisma.store.findUniqueOrThrow({ where: { id: req.auth!.storeId } });
    const openSession = await prisma.cashRegisterSession.findFirst({
      where: { storeId: req.auth!.storeId, cashierId: req.auth!.userId, status: "OPEN" },
    });

    const customer = data.customerId
      ? await prisma.customer.findFirst({ where: { id: data.customerId, storeId: req.auth!.storeId } })
      : null;
    if (data.customerId && !customer) {
      res.status(400).json({ error: "Unknown customer" });
      return;
    }

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

    // Wholesale/VIP customers get their tiered price when the product has one set.
    const unitPriceFor = (product: (typeof products)[number]) => {
      if (customer?.type === "WHOLESALE" && product.wholesalePrice) return product.wholesalePrice;
      if (customer?.type === "VIP" && product.vipPrice) return product.vipPrice;
      return product.price;
    };

    const lineItems = data.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unitPrice = unitPriceFor(product);
      const lineTotal = unitPrice.mul(item.quantity);
      return {
        productId: product.id,
        name: product.name,
        unitPrice,
        quantity: item.quantity,
        lineTotal,
      };
    });

    const subtotal = lineItems.reduce((sum, li) => sum.add(li.lineTotal), new Prisma.Decimal(0));

    const now = new Date();
    const activePromotions =
      data.status === "COMPLETED"
        ? await prisma.promotion.findMany({
            where: { storeId: req.auth!.storeId, active: true, startDate: { lte: now }, endDate: { gte: now } },
          })
        : [];

    let promotionDiscount = new Prisma.Decimal(0);
    for (const promo of activePromotions) {
      if (promo.productId) {
        const line = lineItems.find((li) => li.productId === promo.productId);
        if (!line) continue;
        if (promo.type === "PERCENTAGE_DISCOUNT" && promo.discountPercent) {
          promotionDiscount = promotionDiscount.add(line.lineTotal.mul(promo.discountPercent).div(100));
        } else if (promo.type === "FIXED_DISCOUNT" && promo.discountAmount) {
          promotionDiscount = promotionDiscount.add(
            Prisma.Decimal.min(promo.discountAmount.mul(line.quantity), line.lineTotal)
          );
        } else if (promo.type === "BOGO") {
          const freeUnits = Math.floor(line.quantity / 2);
          promotionDiscount = promotionDiscount.add(line.unitPrice.mul(freeUnits));
        }
      } else {
        if (promo.type === "PERCENTAGE_DISCOUNT" && promo.discountPercent) {
          promotionDiscount = promotionDiscount.add(subtotal.mul(promo.discountPercent).div(100));
        } else if (promo.type === "FIXED_DISCOUNT" && promo.discountAmount) {
          promotionDiscount = promotionDiscount.add(Prisma.Decimal.min(promo.discountAmount, subtotal));
        }
      }
    }

    let coupon = null;
    let couponDiscount = new Prisma.Decimal(0);
    if (data.couponCode) {
      coupon = await prisma.coupon.findFirst({
        where: { storeId: req.auth!.storeId, code: data.couponCode, active: true },
      });
      const expired = coupon?.expiresAt && coupon.expiresAt < now;
      const exhausted = coupon?.usageLimit != null && coupon.timesUsed >= coupon.usageLimit;
      if (!coupon || expired || exhausted) {
        res.status(400).json({ error: "Invalid or expired coupon" });
        return;
      }
      couponDiscount =
        coupon.discountType === "PERCENTAGE" ? subtotal.mul(coupon.discountValue).div(100) : Prisma.Decimal.min(coupon.discountValue, subtotal);
    }

    const discountTotal = Prisma.Decimal.min(promotionDiscount.add(couponDiscount), subtotal);
    const taxableAmount = subtotal.sub(discountTotal);
    const taxTotal = data.status === "COMPLETED" ? taxableAmount.mul(store.taxRate).div(100) : new Prisma.Decimal(0);
    const total = taxableAmount.add(taxTotal);
    const amountTendered = data.amountTendered != null ? new Prisma.Decimal(data.amountTendered) : null;
    const changeDue = amountTendered ? amountTendered.sub(total) : null;

    if (data.paymentMethod === "CREDIT" && customer && customer.creditLimit.gt(0)) {
      const projectedBalance = customer.creditBalance.add(total);
      if (projectedBalance.gt(customer.creditLimit)) {
        res.status(400).json({ error: "This sale would exceed the customer's credit limit" });
        return;
      }
    }

    const creditDueDate =
      data.paymentMethod === "CREDIT"
        ? data.creditDueDate
          ? new Date(data.creditDueDate)
          : new Date(now.getTime() + DEFAULT_CREDIT_DAYS * 24 * 60 * 60 * 1000)
        : undefined;

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          storeId: req.auth!.storeId,
          cashierId: req.auth!.userId,
          registerSessionId: openSession?.id,
          customerId: customer?.id,
          couponId: coupon?.id,
          clientId: data.clientId,
          status: data.status,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          amountTendered: amountTendered ?? undefined,
          changeDue: changeDue ?? undefined,
          paymentMethod: data.paymentMethod,
          creditDueDate,
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
        if (coupon) {
          await tx.coupon.update({ where: { id: coupon.id }, data: { timesUsed: { increment: 1 } } });
        }
        if (data.paymentMethod === "CREDIT" && customer) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { creditBalance: { increment: total } },
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
