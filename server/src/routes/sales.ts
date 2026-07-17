import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const salesRouter = Router();
salesRouter.use(requireAuth);

const saleItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
});

const splitPaymentSchema = z.object({
  method: z.enum(["CASH", "MPESA", "CARD", "BANK"]),
  amount: z.number().positive(),
});

const createSaleSchema = z.object({
  clientId: z.string().min(1),
  items: z.array(saleItemSchema).min(1),
  paymentMethod: z.enum(["CASH", "MPESA_MANUAL", "MPESA", "CARD", "BANK", "SPLIT", "CREDIT"]),
  amountTendered: z.number().nonnegative().optional(),
  status: z.enum(["HELD", "COMPLETED"]).default("COMPLETED"),
  createdAt: z.string().datetime().optional(),
  customerId: z.string().optional(),
  couponCode: z.string().optional(),
  creditDueDate: z.string().datetime().optional(),
  splitPayments: z.array(splitPaymentSchema).optional(),
  // Required for a standalone MPESA (STK push) sale — proves a real STK
  // push actually succeeded for this amount before the sale is allowed to
  // complete. Not used for MPESA_MANUAL, which (like CASH/CARD/BANK) is
  // just a cashier-asserted amount, nor for SPLIT's MPESA leg, same reason.
  mpesaCheckoutRequestId: z.string().optional(),
});

const ROUNDING_TOLERANCE = 0.01;

const DEFAULT_CREDIT_DAYS = 30;

// Idempotent on clientId so a sale queued offline and retried on sync never
// gets double-counted or double-decrements stock.
salesRouter.post(
  "/",
  requirePermission("MAKE_SALES"),
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

    if (data.paymentMethod === "SPLIT" && (!data.splitPayments || data.splitPayments.length < 2)) {
      res.status(400).json({ error: "Split payments need at least two payment methods" });
      return;
    }

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
    // Tax charging was removed — it was overcharging customers. Sales are
    // untaxed; `taxTotal` stays zero for every new sale.
    const taxTotal = new Prisma.Decimal(0);
    const total = taxableAmount.add(taxTotal);
    // Split amounts only need to *cover* the total, not match it exactly —
    // the client can't predict the exact tax/discount-inclusive total in
    // advance (tax and any active promotions/coupons are computed here),
    // so requiring an exact match would make split payment unusable. Same
    // tolerance-for-shortfall, allow-overage pattern as cash tendering.
    let splitAmountTendered: Prisma.Decimal | null = null;
    if (data.paymentMethod === "SPLIT" && data.status === "COMPLETED") {
      const splitSum = data.splitPayments!.reduce((sum, p) => sum + p.amount, 0);
      if (splitSum - Number(total) < -ROUNDING_TOLERANCE) {
        res.status(400).json({
          error: `Split payments (${splitSum.toFixed(2)}) don't cover the total (${total.toFixed(2)})`,
          total: total.toFixed(2),
        });
        return;
      }
      splitAmountTendered = new Prisma.Decimal(splitSum);
    }

    const amountTendered =
      splitAmountTendered ?? (data.amountTendered != null ? new Prisma.Decimal(data.amountTendered) : null);
    const changeDue = amountTendered ? amountTendered.sub(total) : null;

    if (data.paymentMethod === "CREDIT" && customer && customer.creditLimit.gt(0)) {
      const projectedBalance = customer.creditBalance.add(total);
      if (projectedBalance.gt(customer.creditLimit)) {
        res.status(400).json({ error: "This sale would exceed the customer's credit limit" });
        return;
      }
    }

    // A standalone MPESA sale must point at an STK push that Safaricom's
    // callback has already confirmed SUCCESS for this exact store, not yet
    // consumed by another sale, and covering the total — same shortfall
    // tolerance as split payments, since the push amount is quoted before
    // any promotion/coupon this request applies is known.
    let mpesaTransaction = null;
    if (data.paymentMethod === "MPESA" && data.status === "COMPLETED") {
      if (!data.mpesaCheckoutRequestId) {
        res.status(400).json({ error: "Missing M-Pesa checkout request" });
        return;
      }
      mpesaTransaction = await prisma.mpesaTransaction.findFirst({
        where: { checkoutRequestId: data.mpesaCheckoutRequestId, storeId: req.auth!.storeId },
      });
      if (!mpesaTransaction || mpesaTransaction.status !== "SUCCESS") {
        res.status(400).json({ error: "M-Pesa payment has not been confirmed yet" });
        return;
      }
      if (mpesaTransaction.saleId) {
        res.status(400).json({ error: "This M-Pesa payment has already been used for another sale" });
        return;
      }
      if (Number(mpesaTransaction.amount) - Number(total) < -ROUNDING_TOLERANCE) {
        res.status(400).json({
          error: `The M-Pesa payment (${mpesaTransaction.amount.toFixed(2)}) doesn't cover the total (${total.toFixed(2)})`,
          total: total.toFixed(2),
        });
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
          mpesaReceiptNumber: mpesaTransaction?.mpesaReceiptNumber,
          createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
          items: { create: lineItems },
          splitPayments:
            data.paymentMethod === "SPLIT" && data.status === "COMPLETED"
              ? { create: data.splitPayments!.map((p) => ({ method: p.method, amount: p.amount })) }
              : undefined,
        },
        include: { items: true, splitPayments: true },
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
        if (mpesaTransaction) {
          await tx.mpesaTransaction.update({
            where: { id: mpesaTransaction.id },
            data: { saleId: created.id },
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
    const { status, limit, cashierId, paymentMethod } = req.query;
    const sales = await prisma.sale.findMany({
      where: {
        storeId: req.auth!.storeId,
        ...(typeof status === "string" ? { status: status as never } : {}),
        ...(typeof cashierId === "string" ? { cashierId } : {}),
        ...(typeof paymentMethod === "string" ? { paymentMethod: paymentMethod as never } : {}),
      },
      include: { items: true, cashier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      // Scoped to one cashier (an employee's sales history), an explicit
      // limit aside, is meant to be complete rather than truncated at the
      // same default cap used for an unscoped "recent sales" list elsewhere.
      take: typeof limit === "string" ? Number(limit) : cashierId ? undefined : 50,
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
