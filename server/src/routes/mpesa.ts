import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { initiateStkPush, normalizePhone, MpesaApiError, MpesaConfigError, type StkCallbackBody } from "../lib/mpesa.js";

export const mpesaRouter = Router();

const stkPushSchema = z.object({
  phone: z.string().min(9),
  amount: z.number().positive(),
});

// Sends the STK push and records a PENDING MpesaTransaction the checkout
// screen can poll. Requires connectivity by nature — there's no offline path
// for a live M-Pesa payment.
mpesaRouter.post(
  "/stk-push",
  requireAuth,
  requirePermission("MAKE_SALES"),
  asyncHandler(async (req, res) => {
    const data = stkPushSchema.parse(req.body);

    let phone: string;
    try {
      phone = normalizePhone(data.phone);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid phone number" });
      return;
    }

    try {
      const result = await initiateStkPush({
        phone,
        amount: data.amount,
        accountReference: "EazzyMart",
        transactionDesc: "POS Sale",
      });

      const transaction = await prisma.mpesaTransaction.create({
        data: {
          storeId: req.auth!.storeId,
          cashierId: req.auth!.userId,
          phone,
          amount: data.amount,
          merchantRequestId: result.merchantRequestId,
          checkoutRequestId: result.checkoutRequestId,
        },
      });

      res.status(201).json({
        checkoutRequestId: transaction.checkoutRequestId,
        merchantRequestId: transaction.merchantRequestId,
        customerMessage: result.customerMessage,
      });
    } catch (err) {
      if (err instanceof MpesaConfigError) {
        res.status(503).json({ error: err.message });
        return;
      }
      if (err instanceof MpesaApiError) {
        res.status(502).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

// Polled by the checkout screen every few seconds while waiting for the
// customer to act on the STK prompt.
mpesaRouter.get(
  "/stk-push/:checkoutRequestId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const transaction = await prisma.mpesaTransaction.findFirst({
      where: { checkoutRequestId: req.params.checkoutRequestId, storeId: req.auth!.storeId },
    });
    if (!transaction) {
      res.status(404).json({ error: "M-Pesa transaction not found" });
      return;
    }
    res.json({
      status: transaction.status,
      mpesaReceiptNumber: transaction.mpesaReceiptNumber,
      resultDesc: transaction.resultDesc,
      amount: transaction.amount,
      phone: transaction.phone,
    });
  })
);

// Public — Safaricom's servers call this directly and can't attach our JWT,
// so it's deliberately mounted without requireAuth. checkoutRequestId is an
// unguessable token Safaricom itself generated, which is what actually scopes
// this to a specific pending transaction. Always resolves 200 with the
// Daraja-expected ack body, even for an unrecognized/already-resolved
// transaction, so Safaricom doesn't read a non-200 as a delivery failure and
// keep retrying.
mpesaRouter.post(
  "/callback",
  asyncHandler(async (req, res) => {
    const ack = { ResultCode: 0, ResultDesc: "Accepted" };
    const callback = (req.body as StkCallbackBody)?.Body?.stkCallback;

    if (!callback?.CheckoutRequestID) {
      res.json(ack);
      return;
    }

    const transaction = await prisma.mpesaTransaction.findUnique({
      where: { checkoutRequestId: callback.CheckoutRequestID },
    });
    if (!transaction || transaction.status !== "PENDING") {
      res.json(ack);
      return;
    }

    if (callback.ResultCode === 0) {
      const items = callback.CallbackMetadata?.Item ?? [];
      const receipt = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;
      await prisma.mpesaTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "SUCCESS",
          resultCode: callback.ResultCode,
          resultDesc: callback.ResultDesc,
          mpesaReceiptNumber: receipt != null ? String(receipt) : null,
        },
      });
    } else {
      // 1032 = the customer cancelled/declined the prompt on their phone;
      // anything else is a generic failure (timeout, insufficient funds, ...).
      await prisma.mpesaTransaction.update({
        where: { id: transaction.id },
        data: {
          status: callback.ResultCode === 1032 ? "CANCELLED" : "FAILED",
          resultCode: callback.ResultCode,
          resultDesc: callback.ResultDesc,
        },
      });
    }

    res.json(ack);
  })
);
